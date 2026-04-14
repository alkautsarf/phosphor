import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import type { TerminalInfo } from "./detect.js";
import type { Key } from "./input.js";
import {
  enterAltScreen,
  enterRawMode,
  onKeypress,
  cleanup as inputCleanup,
  hideCursor,
  moveCursor,
  clearLine,
} from "./input.js";
import { getCellSize } from "./cellsize.js";
import { getTerminalSize } from "./resize.js";
import { decode } from "./decode.js";
import { writeTransmit } from "./transport.js";
import {
  encodeVirtualWithId,
  randomImageId,
  clear as kittyClear,
} from "./protocols/kitty.js";
import {
  type ChunkedDocument,
  type MdTheme,
  createChunkedDocument,
  renderChunk,
  compositeViewport,
  detectTheme,
  setTheme,
} from "./md.js";

export interface MdViewerOptions {
  info: TerminalInfo;
  theme?: MdTheme;
}

const ZOOM_STEP = 0.15;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;

export async function viewMd(
  path: string,
  opts: MdViewerOptions,
): Promise<void> {
  const { info } = opts;
  let scrollY = 0;
  let currentImageId: number | null = null;
  let alive = true;
  let rendering = false;
  let lastGPress = 0;
  let zoomLevel = 1.0;

  const cell = getCellSize(info.tmux);
  const MIN_COLS = 20;
  const MIN_ROWS = 10;
  const SCROLL_ROWS = 3;
  const SCROLL_STEP = cell.height * SCROLL_ROWS;

  const source = readFileSync(path, "utf-8");
  const basePath = dirname(resolve(path));

  const term = getTerminalSize();
  const pageWidth = Math.min((term.cols - 2) * cell.width, 900);

  // ── Detect theme and create chunked document ──
  setTheme(opts.theme ?? detectTheme());

  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("  Rendering markdown...\r");

  const doc = createChunkedDocument(source, basePath, pageWidth);

  // Render all chunks upfront. Each chunk is ~50-100ms, so total is fast
  // (~4s for 39 chunks) and gives exact scroll positions from the start.
  for (let i = 0; i < doc.chunks.length; i++) {
    await renderChunk(doc, i);
    if (i % 5 === 0) {
      process.stdout.write(`\x1b[2K\r  Rendering markdown... ${Math.round((i / doc.chunks.length) * 100)}%`);
    }
  }
  process.stdout.write(`\x1b[2K\r`);

  enterAltScreen();
  hideCursor();
  enterRawMode();

  function viewportPixelH(): number {
    const t = getTerminalSize();
    return (t.rows - 2) * cell.height;
  }

  function maxScroll(): number {
    const scaled = zoomLevel !== 1.0 ? doc.totalHeight * zoomLevel : doc.totalHeight;
    return Math.max(0, scaled - viewportPixelH());
  }

  function scrollPercent(): number {
    const max = maxScroll();
    if (max <= 0) return 100;
    return Math.min(100, Math.round((scrollY / max) * 100));
  }

  function renderStatusBar(): void {
    const t = getTerminalSize();
    const fileName = path.split("/").pop() ?? path;
    const zoomStr = zoomLevel !== 1.0 ? `  ${Math.round(zoomLevel * 100)}%` : "";
    const rendered = doc.rendered.filter(Boolean).length;
    const total = doc.chunks.length;
    const loadStr = rendered < total ? `  [${rendered}/${total}]` : "";
    moveCursor(t.rows, 1);
    clearLine();
    process.stdout.write(
      `\x1b[2m ${fileName}  ${scrollPercent()}%${zoomStr}${loadStr}  ` +
      `[\u2191\u2193] scroll  [+/-] zoom  [gg/G] top/end  [q] quit\x1b[0m`,
    );
  }

  async function renderViewport(initial = false): Promise<void> {
    if (rendering) return;
    rendering = true;

    try {
      const t = getTerminalSize();
      const mc = t.cols - 2;
      const vpH = viewportPixelH();
      const maxDisplayRows = t.rows - 1;

      if (t.cols < MIN_COLS || t.rows < MIN_ROWS) {
        process.stdout.write("\x1b[H\x1b[2J");
        const msg = "Terminal too small";
        moveCursor(Math.floor(t.rows / 2), Math.max(1, Math.floor((t.cols - msg.length) / 2)));
        process.stdout.write(msg);
        return;
      }

      scrollY = Math.max(0, Math.min(scrollY, maxScroll()));

      // Compute the unzoomed scroll position for chunk lookup
      const docScrollY = zoomLevel !== 1.0 ? scrollY / zoomLevel : scrollY;
      const docVpH = zoomLevel !== 1.0 ? vpH / zoomLevel : vpH;

      // Composite visible chunks into viewport
      const viewportPng = await compositeViewport(doc, docScrollY, docVpH, zoomLevel);

      const decoded = await decode(viewportPng);
      const cols = Math.min(Math.ceil(decoded.width / cell.width), mc);
      const rows = Math.min(Math.ceil(decoded.height / cell.height), maxDisplayRows);

      // ── Flicker-free rendering ──
      const newId = randomImageId();
      const { transmit, placeholders } = encodeVirtualWithId(decoded.png, newId, cols, rows);
      writeTransmit(transmit, info.tmux);

      const padLeft = Math.max(0, Math.floor((t.cols - cols) / 2));
      const lines = placeholders.split("\n");

      if (initial) {
        process.stdout.write("\x1b[H\x1b[2J");
      }

      for (let i = 0; i < maxDisplayRows; i++) {
        moveCursor(1 + i, 1);
        if (i < lines.length) {
          process.stdout.write(
            " ".repeat(padLeft) + lines[i]! + " ".repeat(Math.max(0, t.cols - padLeft - cols)),
          );
        } else if (initial) {
          process.stdout.write(" ".repeat(t.cols));
        }
      }

      if (currentImageId !== null) {
        writeTransmit([kittyClear(currentImageId)], info.tmux);
      }
      currentImageId = newId;

      renderStatusBar();
    } finally {
      rendering = false;
    }

  }

  function handleKey(key: Key): void {
    if (key === "q" || key === "ctrl+c") {
      alive = false;
      return;
    }

    const max = maxScroll();
    const vpH = viewportPixelH();

    if (key === "right") {
      if (scrollY < max) {
        scrollY = Math.min(scrollY + SCROLL_STEP, max);
        renderViewport();
      }
      return;
    }
    if (key === "left") {
      if (scrollY > 0) {
        scrollY = Math.max(0, scrollY - SCROLL_STEP);
        renderViewport();
      }
      return;
    }
    if (key === "space") {
      if (scrollY < max) {
        scrollY = Math.min(scrollY + Math.floor(vpH * 0.8), max);
        renderViewport();
      }
      return;
    }

    if (key === "G") {
      scrollY = maxScroll();
      renderViewport();
      return;
    }
    if (key === "g") {
      const now = Date.now();
      if (now - lastGPress < 500) {
        scrollY = 0;
        renderViewport();
        lastGPress = 0;
      } else {
        lastGPress = now;
      }
      return;
    }

    if (key === "plus") {
      const newZoom = Math.round((zoomLevel + ZOOM_STEP) * 100) / 100;
      if (newZoom <= MAX_ZOOM) {
        const pct = maxScroll() > 0 ? scrollY / maxScroll() : 0;
        zoomLevel = newZoom;
        scrollY = Math.round(maxScroll() * pct);
        renderViewport(true);
      }
      return;
    }
    if (key === "minus") {
      const newZoom = Math.round((zoomLevel - ZOOM_STEP) * 100) / 100;
      if (newZoom >= MIN_ZOOM) {
        const pct = maxScroll() > 0 ? scrollY / maxScroll() : 0;
        zoomLevel = newZoom;
        scrollY = Math.round(maxScroll() * pct);
        renderViewport(true);
      }
      return;
    }

    if (typeof key === "object" && key.type === "digit") {
      if (key.value === 0) {
        scrollY = 0;
      } else {
        scrollY = Math.round(max * (key.value / 10));
      }
      renderViewport();
      return;
    }
  }

  onKeypress(handleKey);
  process.on("SIGWINCH", () => renderViewport(true));

  await renderViewport(true);

  while (alive) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  if (currentImageId !== null) {
    writeTransmit([kittyClear(currentImageId)], info.tmux);
  }
  inputCleanup();
}
