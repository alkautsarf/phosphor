import { execSync } from "child_process";

export interface PdfInfo {
  pages: number;
}

export function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

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

function pdftocairoArgs(path: string, page: number, dpi: number): string[] {
  return [
    "pdftocairo",
    "-png",
    "-singlefile",
    "-f", String(page),
    "-l", String(page),
    "-r", String(dpi),
    path,
    "-",
  ];
}

const SPAWN_OPTS = { stdout: "pipe", stderr: "ignore", stdin: "ignore" } as const;

export async function renderPageAsync(
  path: string,
  page: number,
  dpi: number,
): Promise<Buffer> {
  const proc = Bun.spawn(pdftocairoArgs(path, page, dpi), SPAWN_OPTS);
  const [buf, exit] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    proc.exited,
  ]);
  if (exit !== 0) throw new Error(`pdftocairo exited with code ${exit}`);
  return Buffer.from(buf);
}

export function renderPage(path: string, page: number, dpi: number = 150): Buffer {
  const result = Bun.spawnSync(pdftocairoArgs(path, page, dpi), SPAWN_OPTS);
  if (result.exitCode !== 0) throw new Error(`pdftocairo failed (exit ${result.exitCode})`);
  return Buffer.from(result.stdout);
}
