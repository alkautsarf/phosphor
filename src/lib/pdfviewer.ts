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
import { writeTransmit, writePlaceholders } from "./transport.js";
import {
  encodeVirtualWithId,
  randomImageId,
  clear as kittyClear,
} from "./protocols/kitty.js";
import { type PdfInfo, renderPage } from "./pdf.js";

export interface PdfViewerOptions {
  info: TerminalInfo;
  pdfInfo: PdfInfo;
  startPage?: number;
}

export async function viewPdf(
  path: string,
  opts: PdfViewerOptions,
): Promise<void> {
  const { info, pdfInfo } = opts;
  let currentPage = opts.startPage ?? 1;
  let currentImageId: number | null = null;
  let alive = true;

  const cell = getCellSize(info.tmux);

  const MIN_COLS = 20;
  const MIN_ROWS = 10;

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

  // Re-render on terminal resize
  process.on("SIGWINCH", () => {
    showPage(currentPage);
  });

  async function showPage(page: number): Promise<void> {
    const clamped = Math.max(1, Math.min(page, pdfInfo.pages));
    currentPage = clamped;

    const { term, maxCols, maxRows, maxPixelW, maxPixelH } = getDisplayBounds();

    // Check minimum size
    if (term.cols < MIN_COLS || term.rows < MIN_ROWS) {
      renderTooSmall();
      return;
    }

    // Render PDF at high enough DPI to fill the terminal
    const dpi = Math.max(300, Math.ceil(maxPixelW / 8.27));
    const pngBuf = renderPage(path, clamped, dpi);

    const decoded = await decode(pngBuf, maxPixelW, maxPixelH);
    const cols = Math.min(Math.ceil(decoded.width / cell.width), maxCols);
    const rows = Math.min(Math.ceil(decoded.height / cell.height), maxRows);

    // Delete old image before transmitting new one
    if (currentImageId !== null) {
      writeTransmit([kittyClear(currentImageId)], info.tmux);
    }

    const newId = randomImageId();
    const { transmit, placeholders } = encodeVirtualWithId(decoded.png, newId, cols, rows);
    writeTransmit(transmit, info.tmux);
    currentImageId = newId;

    // Draw centered
    process.stdout.write("\x1b[H\x1b[2J");
    const padLeft = Math.max(0, Math.floor((term.cols - cols) / 2));
    const padTop = Math.max(1, Math.floor((maxRows - rows) / 2) + 1);
    const lines = placeholders.split("\n");
    for (let i = 0; i < lines.length; i++) {
      moveCursor(padTop + i, padLeft + 1);
      process.stdout.write(lines[i]!);
    }

    renderStatusBar();
  }

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
      // Jump to page at percentage: 1=10%, 2=20%, ..., 9=90%
      const targetPage = Math.max(1, Math.round(pdfInfo.pages * (key.value / 10)));
      showPage(targetPage);
      return;
    }
  }

  onKeypress(handleKey);

  // Show first page
  await showPage(currentPage);

  // Wait until quit
  while (alive) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Cleanup
  if (currentImageId !== null) {
    writeTransmit([kittyClear(currentImageId)], info.tmux);
  }
  inputCleanup();
}
