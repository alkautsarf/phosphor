export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Default cell size in pixels (width x height).
 * Modern HiDPI terminals (Ghostty, Kitty, WezTerm) typically have
 * larger cell sizes than the classic 8x16. 14x28 is a reasonable
 * default for Retina/HiDPI displays at common font sizes.
 */
const DEFAULT_CELL_WIDTH = 14;
const DEFAULT_CELL_HEIGHT = 28;

/** Get terminal dimensions in cells. */
export function getTerminalSize(): TerminalSize {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * Compute pixel dimensions for an image that fits within the given cell constraints.
 * Preserves aspect ratio. Uses a 0.5 cell aspect ratio (cells are ~2x taller than wide).
 */
export function fitToTerminal(
  imgWidth: number,
  imgHeight: number,
  maxCols?: number,
  maxRows?: number,
): PixelSize {
  const term = getTerminalSize();
  const targetCols = maxCols ?? term.cols - 2; // leave margin
  const targetRows = maxRows ?? term.rows - 2;

  const maxPixelW = targetCols * DEFAULT_CELL_WIDTH;
  const maxPixelH = targetRows * DEFAULT_CELL_HEIGHT;

  let w = imgWidth;
  let h = imgHeight;

  // Scale down to fit width
  if (w > maxPixelW) {
    const ratio = maxPixelW / w;
    w = maxPixelW;
    h = Math.round(h * ratio);
  }

  // Scale down to fit height
  if (h > maxPixelH) {
    const ratio = maxPixelH / h;
    h = maxPixelH;
    w = Math.round(w * ratio);
  }

  return { width: Math.max(1, w), height: Math.max(1, h) };
}

/** Convert pixel dimensions to cell dimensions. */
export function pixelsToCells(width: number, height: number): { cols: number; rows: number } {
  return {
    cols: Math.ceil(width / DEFAULT_CELL_WIDTH),
    rows: Math.ceil(height / DEFAULT_CELL_HEIGHT),
  };
}

/**
 * Compute cell dimensions for displaying an image, filling available terminal width.
 * The terminal scales the image pixels to fit the placeholder cell grid.
 * Cell aspect ratio ~0.5 (cells are roughly twice as tall as wide).
 */
export function fitCells(
  imgWidth: number,
  imgHeight: number,
  maxCols?: number,
  maxRows?: number,
): { cols: number; rows: number } {
  const term = getTerminalSize();
  const targetCols = maxCols ?? term.cols - 2;
  const targetRows = maxRows ?? Math.floor(term.rows * 0.75);

  // Fill available width, compute rows from aspect ratio
  // Cell aspect ratio: each cell is ~2x taller than wide
  const cellAspect = 0.5; // width/height of a cell
  const imgAspect = imgWidth / imgHeight;

  let cols = targetCols;
  let rows = Math.round(cols / (imgAspect / cellAspect));

  // Constrain to max rows
  if (rows > targetRows) {
    rows = targetRows;
    cols = Math.round(rows * (imgAspect / cellAspect));
  }

  return { cols: Math.max(1, cols), rows: Math.max(1, rows) };
}
