#!/usr/bin/env bun
/**
 * PDF render benchmark.
 *
 * Measures the cost of the page-transition pipeline used by the PDF viewer:
 *   pdftocairo (or alternative) → sharp decode → kitty-encode placeholders
 *
 * Usage:
 *   bun run bench/pdf-bench.ts <pdf> [opts]
 *     --pages N       number of pages to test (default 8)
 *     --renderer R    poppler | mupdf | pdfjs        (default poppler)
 *     --label STR     label for output (e.g. "phase-0")
 *     --max-w PX      terminal pixel width target    (default 1800)
 *     --max-h PX      terminal pixel height target   (default 1200)
 *     --dpi-floor PX  floor for pdftocairo DPI       (default 300; phase-2 sets 0)
 *
 * Workloads:
 *   1. cold-seq    : pages 1..N, each rendered fresh
 *   2. warm-revisit: pages 1..N twice; first pass cold, second from cache
 *   3. ping-pong   : 1,2,1,2,1,2 (worst case for non-cached impl)
 */

import { performance } from "node:perf_hooks";
import { getPdfInfo, renderPage } from "../src/lib/pdf.ts";
import { decode } from "../src/lib/decode.ts";
import { encodeVirtualWithId, randomImageId } from "../src/lib/protocols/kitty.ts";

interface Args {
  pdf: string;
  pages: number;
  renderer: "poppler" | "mupdf" | "pdfjs";
  label: string;
  maxW: number;
  maxH: number;
  dpiFloor: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = {
    pdf: "",
    pages: 8,
    renderer: "poppler",
    label: "unlabeled",
    maxW: 1800,
    maxH: 1200,
    dpiFloor: 300,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--pages") out.pages = parseInt(argv[++i]!, 10);
    else if (a === "--renderer") out.renderer = argv[++i] as Args["renderer"];
    else if (a === "--label") out.label = argv[++i]!;
    else if (a === "--max-w") out.maxW = parseInt(argv[++i]!, 10);
    else if (a === "--max-h") out.maxH = parseInt(argv[++i]!, 10);
    else if (a === "--dpi-floor") out.dpiFloor = parseInt(argv[++i]!, 10);
    else if (!a.startsWith("-")) out.pdf = a;
  }
  if (!out.pdf) {
    console.error("usage: pdf-bench <pdf> [--pages N] [--renderer poppler|mupdf|pdfjs] [--label X]");
    process.exit(1);
  }
  return out;
}

interface RenderFn {
  (page: number, dpi: number): Promise<Buffer> | Buffer;
}

async function getRenderer(args: Args): Promise<RenderFn> {
  if (args.renderer === "poppler") {
    return (page, dpi) => renderPage(args.pdf, page, dpi);
  }
  if (args.renderer === "mupdf") {
    const { renderPageMupdf, openMupdf } = await import("../src/lib/pdf-mupdf.ts");
    const doc = await openMupdf(args.pdf);
    return (page, dpi) => renderPageMupdf(doc, page, dpi);
  }
  if (args.renderer === "pdfjs") {
    const { renderPagePdfjs, openPdfjs } = await import("../src/lib/pdf-pdfjs.ts");
    const doc = await openPdfjs(args.pdf);
    return (page, dpi) => renderPagePdfjs(doc, page, dpi);
  }
  throw new Error(`unknown renderer ${args.renderer}`);
}

interface Sample {
  page: number;
  rasterMs: number;
  decodeMs: number;
  encodeMs: number;
  totalMs: number;
  cached: boolean;
}

interface CacheEntry {
  png: Buffer;
  width: number;
  height: number;
  imageId: number;
  cols: number;
  rows: number;
  placeholders: string;
}

const CELL_W = 10;
const CELL_H = 20;

async function renderInto(
  cache: Map<number, CacheEntry>,
  inFlight: Map<number, Promise<CacheEntry>>,
  page: number,
  render: RenderFn,
  args: Args,
  dpi: number,
): Promise<CacheEntry> {
  const hit = cache.get(page);
  if (hit) return hit;
  const pending = inFlight.get(page);
  if (pending) return pending;
  const job = (async () => {
    const png = await render(page, dpi);
    const decoded = await decode(png, args.maxW, args.maxH);
    const cols = Math.min(Math.ceil(decoded.width / CELL_W), Math.floor(args.maxW / CELL_W));
    const rows = Math.min(Math.ceil(decoded.height / CELL_H), Math.floor(args.maxH / CELL_H));
    const id = randomImageId();
    const enc = encodeVirtualWithId(decoded.png, id, cols, rows);
    const entry: CacheEntry = {
      png: decoded.png,
      width: decoded.width,
      height: decoded.height,
      imageId: id,
      cols,
      rows,
      placeholders: enc.placeholders,
    };
    cache.set(page, entry);
    return entry;
  })();
  inFlight.set(page, job);
  try {
    return await job;
  } finally {
    inFlight.delete(page);
  }
}

async function runPrefetchWorkload(
  pages: number[],
  render: RenderFn,
  args: Args,
  thinkMs: number,
  prefetchRadius: number,
): Promise<Sample[]> {
  const cache = new Map<number, CacheEntry>();
  const inFlight = new Map<number, Promise<CacheEntry>>();
  const samples: Sample[] = [];
  const dpi = Math.max(args.dpiFloor, Math.ceil(args.maxW / 8.27));

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    const cached = cache.has(page);
    const t0 = performance.now();
    await renderInto(cache, inFlight, page, render, args, dpi);
    const totalMs = performance.now() - t0;
    samples.push({ page, rasterMs: 0, decodeMs: 0, encodeMs: 0, totalMs, cached });

    // Kick off prefetch for adjacent pages — fire & forget.
    for (let d = 1; d <= prefetchRadius; d++) {
      const next = pages[i + d];
      if (next !== undefined) {
        renderInto(cache, inFlight, next, render, args, dpi).catch(() => {});
      }
    }

    if (thinkMs > 0 && i < pages.length - 1) {
      await new Promise((r) => setTimeout(r, thinkMs));
    }
  }
  return samples;
}

async function runWorkload(
  pages: number[],
  render: RenderFn,
  args: Args,
  useCache: boolean,
): Promise<Sample[]> {
  const cache = new Map<number, CacheEntry>();
  const samples: Sample[] = [];
  const dpi = Math.max(args.dpiFloor, Math.ceil(args.maxW / 8.27));

  for (const page of pages) {
    const t0 = performance.now();
    let cached = false;
    let rasterMs = 0;
    let decodeMs = 0;
    let encodeMs = 0;

    if (useCache && cache.has(page)) {
      // Warm-hit path: just emit placeholders — measured separately.
      const entry = cache.get(page)!;
      const tEnc = performance.now();
      // Touch the placeholders string to avoid dead-code elimination.
      if (entry.placeholders.length < 0) throw new Error("dead");
      encodeMs = performance.now() - tEnc;
      cached = true;
    } else {
      const tR0 = performance.now();
      const png = await render(page, dpi);
      rasterMs = performance.now() - tR0;

      const tD0 = performance.now();
      const decoded = await decode(png, args.maxW, args.maxH);
      decodeMs = performance.now() - tD0;

      const tE0 = performance.now();
      const cols = Math.min(Math.ceil(decoded.width / CELL_W), Math.floor(args.maxW / CELL_W));
      const rows = Math.min(Math.ceil(decoded.height / CELL_H), Math.floor(args.maxH / CELL_H));
      const id = randomImageId();
      const enc = encodeVirtualWithId(decoded.png, id, cols, rows);
      encodeMs = performance.now() - tE0;

      if (useCache) {
        cache.set(page, {
          png: decoded.png,
          width: decoded.width,
          height: decoded.height,
          imageId: id,
          cols,
          rows,
          placeholders: enc.placeholders,
        });
      }
    }

    samples.push({
      page,
      rasterMs,
      decodeMs,
      encodeMs,
      totalMs: performance.now() - t0,
      cached,
    });
  }
  return samples;
}

function stats(samples: Sample[], filter?: (s: Sample) => boolean) {
  const xs = samples.filter(filter ?? (() => true)).map((s) => s.totalMs).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, avg: 0, p50: 0, p95: 0, min: 0, max: 0 };
  const avg = xs.reduce((s, x) => s + x, 0) / xs.length;
  const p = (q: number) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;
  return { n: xs.length, avg, p50: p(0.5), p95: p(0.95), min: xs[0]!, max: xs[xs.length - 1]! };
}

function fmt(n: number) {
  return n.toFixed(1).padStart(7);
}

async function main() {
  const args = parseArgs();
  const info = getPdfInfo(args.pdf);
  if (!info) {
    console.error("could not read PDF info");
    process.exit(1);
  }
  const N = Math.min(args.pages, info.pages);
  const seq = Array.from({ length: N }, (_, i) => i + 1);

  console.log(`# bench label=${args.label} renderer=${args.renderer} pdf=${args.pdf}`);
  console.log(`# pages=${N}/${info.pages}  maxW=${args.maxW}  maxH=${args.maxH}  dpiFloor=${args.dpiFloor}`);

  const render = await getRenderer(args);

  // Warm one render so subprocess/library JIT effects don't bias page 1.
  await render(1, Math.max(args.dpiFloor, Math.ceil(args.maxW / 8.27)));

  const cold = await runWorkload(seq, render, args, false);
  const warmRevisit = await runWorkload([...seq, ...seq], render, args, true);
  const pingPong = await runWorkload(
    Array.from({ length: 6 }, (_, i) => (i % 2) + 1),
    render,
    args,
    false,
  );
  const pingPongCached = await runWorkload(
    Array.from({ length: 6 }, (_, i) => (i % 2) + 1),
    render,
    args,
    true,
  );
  const prefetched = await runPrefetchWorkload(seq, render, args, 1500, 2);

  const c = stats(cold);
  const w1 = stats(warmRevisit, (s) => !s.cached);
  const w2 = stats(warmRevisit, (s) => s.cached);
  const pp = stats(pingPong);
  const ppc = stats(pingPongCached, (s) => s.cached);
  const pf = stats(prefetched);
  const pfHits = prefetched.filter((s) => s.cached).length;

  const breakdown = (s: Sample[]) => {
    const r = s.reduce((a, x) => a + x.rasterMs, 0) / s.length;
    const d = s.reduce((a, x) => a + x.decodeMs, 0) / s.length;
    const e = s.reduce((a, x) => a + x.encodeMs, 0) / s.length;
    return { r, d, e };
  };
  const cb = breakdown(cold);

  console.log("");
  console.log(`workload          n   avg(ms)  p50(ms)  p95(ms)  min(ms)  max(ms)`);
  console.log(`cold-sequential ${String(c.n).padStart(3)}  ${fmt(c.avg)} ${fmt(c.p50)} ${fmt(c.p95)} ${fmt(c.min)} ${fmt(c.max)}`);
  console.log(`warm-cold-pass  ${String(w1.n).padStart(3)}  ${fmt(w1.avg)} ${fmt(w1.p50)} ${fmt(w1.p95)} ${fmt(w1.min)} ${fmt(w1.max)}`);
  console.log(`warm-cache-hit  ${String(w2.n).padStart(3)}  ${fmt(w2.avg)} ${fmt(w2.p50)} ${fmt(w2.p95)} ${fmt(w2.min)} ${fmt(w2.max)}`);
  console.log(`pingpong-nocache${String(pp.n).padStart(3)}  ${fmt(pp.avg)} ${fmt(pp.p50)} ${fmt(pp.p95)} ${fmt(pp.min)} ${fmt(pp.max)}`);
  console.log(`pingpong-cached ${String(ppc.n).padStart(3)}  ${fmt(ppc.avg)} ${fmt(ppc.p50)} ${fmt(ppc.p95)} ${fmt(ppc.min)} ${fmt(ppc.max)}`);
  console.log(`prefetch-1.5s   ${String(pf.n).padStart(3)}  ${fmt(pf.avg)} ${fmt(pf.p50)} ${fmt(pf.p95)} ${fmt(pf.min)} ${fmt(pf.max)}    cache-hits=${pfHits}/${pf.n}`);
  console.log("");
  console.log(`cold breakdown (avg ms):  raster=${cb.r.toFixed(1)}  decode=${cb.d.toFixed(1)}  encode=${cb.e.toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
