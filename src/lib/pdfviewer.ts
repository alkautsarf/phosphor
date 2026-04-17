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
import { type PdfInfo, renderPageAsync } from "./pdf.js";
import { openPdfjs, renderPagePdfjs, type PdfjsDoc } from "./pdf-pdfjs.js";

export interface PdfViewerOptions {
  info: TerminalInfo;
  pdfInfo: PdfInfo;
  startPage?: number;
}

interface CacheEntry {
  imageId: number;
  cols: number;
  rows: number;
  placeholders: string;
  width: number;
  height: number;
  termCols: number;
  termRows: number;
  dpi: number;
}

const MAX_CACHE = 12;
const PREFETCH_RADIUS = 2;

export async function viewPdf(
  path: string,
  opts: PdfViewerOptions,
): Promise<void> {
  const { info, pdfInfo } = opts;
  let currentPage = opts.startPage ?? 1;
  let alive = true;

  const cell = getCellSize(info.tmux);

  const MIN_COLS = 20;
  const MIN_ROWS = 10;

  const cache = new Map<number, CacheEntry>();
  const inFlight = new Map<number, Promise<CacheEntry | null>>();
  const prefetchScheduled = new Set<number>();

  // Try pdfjs first (in-process, no subprocess per page). Fall back to
  // pdftocairo if it fails (missing canvas backend, encrypted PDF, etc.).
  let pdfjsDoc: PdfjsDoc | null = null;
  try {
    pdfjsDoc = await openPdfjs(path);
  } catch {
    pdfjsDoc = null;
  }

  async function rasterize(page: number, dpi: number): Promise<Buffer> {
    if (pdfjsDoc) {
      try { return await renderPagePdfjs(pdfjsDoc, page, dpi); }
      catch { /* fall through to poppler */ }
    }
    return renderPageAsync(path, page, dpi);
  }

  enterAltScreen();
  hideCursor();
  enterRawMode();

  function getDisplayBounds() {
    const t = getTerminalSize();
    return {
      term: t,
      maxCols: t.cols - 2,
      maxRows: t.rows - 3,
      maxPixelW: (t.cols - 2) * cell.width,
      maxPixelH: (t.rows - 3) * cell.height,
    };
  }

  function renderTooSmall(): void {
    const t = getTerminalSize();
    process.stdout.write("\x1b[H\x1b[2J");
    const msg = "Terminal too small — resize to view PDF";
    const row = Math.max(1, Math.floor(t.rows / 2));
    const col = Math.max(1, Math.floor((t.cols - msg.length) / 2));
    moveCursor(row, col);
    process.stdout.write(msg);
  }

  function renderStatusBar(): void {
    const t = getTerminalSize();
    moveCursor(t.rows, 1);
    clearLine();
    process.stdout.write(
      ` Page ${currentPage}/${pdfInfo.pages}  [h/l or \u2190\u2192] prev/next  [1-9] jump  [q] quit`,
    );
  }

  function evictIfNeeded(): void {
    while (cache.size > MAX_CACHE) {
      // Skip the current page so we never evict what's on screen.
      let evictKey: number | null = null;
      for (const k of cache.keys()) {
        if (k !== currentPage) { evictKey = k; break; }
      }
      if (evictKey === null) return;
      const old = cache.get(evictKey)!;
      writeTransmit([kittyClear(old.imageId)], info.tmux);
      cache.delete(evictKey);
    }
  }

  function clearAllCache(): void {
    for (const e of cache.values()) {
      writeTransmit([kittyClear(e.imageId)], info.tmux);
    }
    cache.clear();
  }

  async function ensureRendered(page: number): Promise<CacheEntry | null> {
    const { term, maxCols, maxRows, maxPixelW, maxPixelH } = getDisplayBounds();
    if (term.cols < MIN_COLS || term.rows < MIN_ROWS) return null;

    // DPI tuned to fill the terminal's pixel width with modest headroom —
    // rasterising above terminal resolution just wastes work that decode()
    // immediately throws away on the subsequent resize.
    const dpi = Math.max(144, Math.min(300, Math.ceil((maxPixelW / 8.27) * 1.15)));

    const existing = cache.get(page);
    if (
      existing &&
      existing.termCols === term.cols &&
      existing.termRows === term.rows &&
      existing.dpi === dpi
    ) {
      cache.delete(page);
      cache.set(page, existing);
      return existing;
    }
    if (existing) {
      writeTransmit([kittyClear(existing.imageId)], info.tmux);
      cache.delete(page);
    }

    const pending = inFlight.get(page);
    if (pending) return pending;

    const job = (async (): Promise<CacheEntry | null> => {
      const pngBuf = await rasterize(page, dpi);
      const decoded = await decode(pngBuf, maxPixelW, maxPixelH);
      const cols = Math.min(Math.ceil(decoded.width / cell.width), maxCols);
      const rows = Math.min(Math.ceil(decoded.height / cell.height), maxRows);
      const id = randomImageId();
      const { transmit, placeholders } = encodeVirtualWithId(
        decoded.png,
        id,
        cols,
        rows,
      );
      writeTransmit(transmit, info.tmux);

      const entry: CacheEntry = {
        imageId: id,
        cols,
        rows,
        placeholders,
        width: decoded.width,
        height: decoded.height,
        termCols: term.cols,
        termRows: term.rows,
        dpi,
      };
      cache.set(page, entry);
      evictIfNeeded();
      return entry;
    })();

    inFlight.set(page, job);
    try {
      return await job;
    } finally {
      inFlight.delete(page);
    }
  }

  function schedulePrefetch(page: number): void {
    for (let delta = 1; delta <= PREFETCH_RADIUS; delta++) {
      for (const target of [page + delta, page - delta]) {
        if (target < 1 || target > pdfInfo.pages) continue;
        if (cache.has(target) || inFlight.has(target) || prefetchScheduled.has(target)) continue;
        prefetchScheduled.add(target);
        // Defer past the current microtask so the active page paints first.
        setTimeout(() => {
          prefetchScheduled.delete(target);
          if (!alive) return;
          ensureRendered(target).catch(() => {});
        }, 10);
      }
    }
  }

  function paint(entry: CacheEntry): void {
    const { term, maxRows } = getDisplayBounds();
    process.stdout.write("\x1b[H\x1b[2J");
    const padLeft = Math.max(0, Math.floor((term.cols - entry.cols) / 2));
    const padTop = Math.max(1, Math.floor((maxRows - entry.rows) / 2) + 1);
    const lines = entry.placeholders.split("\n");
    for (let i = 0; i < lines.length; i++) {
      moveCursor(padTop + i, padLeft + 1);
      process.stdout.write(lines[i]!);
    }
    renderStatusBar();
  }

  let showActive = false;

  async function showPage(page: number): Promise<void> {
    const clamped = Math.max(1, Math.min(page, pdfInfo.pages));
    currentPage = clamped;

    // Coalesce: if a render is already in progress, just update the target
    // and let the active loop pick it up. Avoids spawning a render per
    // keystroke when the user holds an arrow key.
    if (showActive) return;
    showActive = true;
    try {
      while (true) {
        const target = currentPage;
        const { term } = getDisplayBounds();
        if (term.cols < MIN_COLS || term.rows < MIN_ROWS) {
          renderTooSmall();
          return;
        }
        const entry = await ensureRendered(target);
        // While we awaited, a newer keypress may have moved currentPage.
        // If so, loop and render the new target instead of painting stale.
        if (currentPage !== target) continue;
        if (!entry) return;
        paint(entry);
        schedulePrefetch(target);
        return;
      }
    } finally {
      showActive = false;
    }
  }

  process.on("SIGWINCH", () => {
    clearAllCache();
    showPage(currentPage);
  });

  function handleKey(key: Key): void {
    if (key === "q" || key === "ctrl+c") {
      alive = false;
      return;
    }
    if (key === "right" || key === "space") {
      if (currentPage < pdfInfo.pages) showPage(currentPage + 1);
      return;
    }
    if (key === "left") {
      if (currentPage > 1) showPage(currentPage - 1);
      return;
    }
    if (typeof key === "object" && key.type === "digit" && key.value >= 1) {
      const targetPage = Math.max(1, Math.round(pdfInfo.pages * (key.value / 10)));
      showPage(targetPage);
      return;
    }
  }

  onKeypress(handleKey);

  await showPage(currentPage);

  while (alive) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  clearAllCache();
  inputCleanup();
}
