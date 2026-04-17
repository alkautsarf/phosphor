/**
 * In-process PDF rasterizer using pdfjs-dist + @napi-rs/canvas.
 *
 * Keeps the parsed document in memory so per-page renders skip subprocess
 * spawn + PDF parse cost on every keystroke.
 */
import { readFile } from "fs/promises";
import { createCanvas } from "@napi-rs/canvas";

let pdfjs: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as any;
  // pdfjs 5.x requires a worker source even server-side; point at the bundled file.
  const workerUrl = new URL(
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).href;
  (pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs!;
}

const MAX_PAGE_CACHE = 20;

export interface PdfjsDoc {
  doc: any;
  pageCount: number;
}

const pageCaches = new WeakMap<PdfjsDoc, Map<number, any>>();

export async function openPdfjs(path: string): Promise<PdfjsDoc> {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await readFile(path));
  const loadingTask = (lib as any).getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const handle: PdfjsDoc = { doc, pageCount: doc.numPages };
  pageCaches.set(handle, new Map());
  return handle;
}

export async function renderPagePdfjs(
  doc: PdfjsDoc,
  pageNum: number,
  dpi: number,
): Promise<Buffer> {
  const cache = pageCaches.get(doc)!;
  let page = cache.get(pageNum);
  if (!page) {
    page = await doc.doc.getPage(pageNum);
    cache.set(pageNum, page);
    while (cache.size > MAX_PAGE_CACHE) {
      const oldest = cache.keys().next().value as number;
      const stale = cache.get(oldest);
      stale?.cleanup?.();
      cache.delete(oldest);
    }
  }

  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");

  await page.render({
    canvasContext: ctx as any,
    viewport,
    canvas: canvas as any,
  }).promise;

  return canvas.toBuffer("image/png");
}
