import { execSync } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface PdfInfo {
  pages: number;
}

/** Check if a file is a PDF by extension. */
export function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

/** Get PDF page count via pdfinfo. Returns null if not a PDF or pdfinfo unavailable. */
export function getPdfInfo(path: string): PdfInfo | null {
  try {
    const output = execSync(`pdfinfo '${path.replace(/'/g, "'\\''")}'`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    });
    const match = output.match(/Pages:\s+(\d+)/);
    if (match) {
      return { pages: parseInt(match[1]!, 10) };
    }
  } catch { /* not a PDF or pdfinfo not installed */ }
  return null;
}

/**
 * Render a specific PDF page to PNG via pdftocairo.
 * Returns the PNG buffer. Page is 1-indexed.
 */
export function renderPage(path: string, page: number, dpi: number = 150): Buffer {
  const tmpBase = join(tmpdir(), `phosphor-pdf-${Date.now()}`);
  const tmpPng = `${tmpBase}.png`;

  try {
    execSync(
      `pdftocairo -png -f ${page} -l ${page} -singlefile -r ${dpi} '${path.replace(/'/g, "'\\''")}' '${tmpBase}'`,
      { stdio: "ignore", timeout: 10000 },
    );
    return readFileSync(tmpPng);
  } finally {
    try { unlinkSync(tmpPng); } catch { /* ignore */ }
  }
}
