import { display, detect, getImageInfo, isPdf, getPdfInfo, viewPdf, isMd, viewMd } from "./lib/phosphor.js";
import type { MdTheme } from "./lib/md.js";
import type { Protocol } from "./lib/detect.js";

process.on("SIGPIPE", () => process.exit(0));

function printUsage(): void {
  console.log(`phosphor — render images, PDFs, and markdown in your terminal

Usage:
  phosphor <file>                Display an image, PDF, or markdown
  phosphor <file> -w 60          Constrain width (cells)
  phosphor <file> --height 20    Constrain height (cells)
  phosphor <file> -p kitty       Force protocol (kitty|iterm2|sixel|halfblock)
  phosphor <file> --info         Show file info + detected protocol
  phosphor <file> --page 3       Open PDF at specific page
  cat image.png | phosphor       Read from stdin

PDF Controls:
  → / j / Space   Next page
  ← / k           Previous page
  1-9             Jump to 10%-90%
  q               Quit

Markdown Controls:
  ↓ / j           Scroll down
  ↑ / k           Scroll up
  Space           Page down
  gg              Go to top
  G               Go to end
  + / =           Zoom in
  - / _           Zoom out
  0               Jump to top
  1-9             Jump to 10%-90%
  q               Quit

Options:
  -w, --width <N>     Max width in terminal cells
  --height <N>        Max height in terminal cells
  -p, --protocol <P>  Force protocol: kitty, iterm2, sixel, halfblock
  --info              Show file and terminal info without rendering
  --page <N>          Open PDF at page N
  --dark              Dark theme for markdown
  --light             Light theme for markdown
  --transparent       Transparent background (for transparent terminals)
  --version           Show version
  --help              Show this help

Environment:
  PHOSPHOR_THEME      Default markdown theme: dark, light, transparent
                      Set in .zshrc: export PHOSPHOR_THEME=transparent`);
}

function parseArgs(argv: string[]) {
  const result = {
    file: null as string | null,
    width: undefined as number | undefined,
    height: undefined as number | undefined,
    protocol: undefined as Protocol | undefined,
    page: undefined as number | undefined,
    info: false,
    help: false,
    version: false,
    theme: undefined as "light" | "dark" | "transparent" | undefined,
  };

  const args = argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case "-w":
      case "--width":
        result.width = parseInt(args[++i] ?? "", 10);
        break;
      case "--height":
        result.height = parseInt(args[++i] ?? "", 10);
        break;
      case "-p":
      case "--protocol":
        result.protocol = args[++i] as Protocol;
        break;
      case "--page":
        result.page = parseInt(args[++i] ?? "1", 10);
        break;
      case "--info":
        result.info = true;
        break;
      case "--help":
        result.help = true;
        break;
      case "--light":
        result.theme = "light";
        break;
      case "--dark":
        result.theme = "dark";
        break;
      case "--transparent":
        result.theme = "transparent";
        break;
      case "--version":
        result.version = true;
        break;
      default:
        if (!arg.startsWith("-")) {
          result.file = arg;
        }
    }
  }

  return result;
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printUsage();
    return;
  }

  if (opts.version) {
    console.log("phosphor 0.2.0");
    return;
  }

  let input: Buffer | string;
  if (opts.file) {
    input = opts.file;
  } else if (!process.stdin.isTTY) {
    input = await readStdin();
  } else {
    printUsage();
    process.exit(1);
  }

  // PDF detection and viewing
  if (typeof input === "string" && isPdf(input)) {
    const pdfInfo = getPdfInfo(input);
    if (!pdfInfo) {
      console.error("phosphor: could not read PDF (is pdfinfo/poppler installed?)");
      process.exit(1);
    }

    if (opts.info) {
      const term = detect();
      console.log(`File:     ${opts.file}`);
      console.log(`Format:   PDF`);
      console.log(`Pages:    ${pdfInfo.pages}`);
      console.log(`Protocol: ${term.protocol}`);
      console.log(`Terminal: ${term.terminal ?? "unknown"}`);
      console.log(`tmux:     ${term.tmux}`);
      return;
    }

    const info = detect();
    await viewPdf(input, { info, pdfInfo, startPage: opts.page });
    return;
  }

  // Markdown detection and viewing
  if (typeof input === "string" && isMd(input)) {
    if (opts.info) {
      const term = detect();
      const { readFileSync } = await import("fs");
      const source = readFileSync(input, "utf-8");
      const lines = source.split("\n").length;
      console.log(`File:     ${opts.file}`);
      console.log(`Format:   Markdown`);
      console.log(`Lines:    ${lines}`);
      console.log(`Protocol: ${term.protocol}`);
      console.log(`Terminal: ${term.terminal ?? "unknown"}`);
      console.log(`tmux:     ${term.tmux}`);
      return;
    }

    const info = detect();
    const { resolve } = await import("path");
    await viewMd(resolve(input), { info, theme: opts.theme });
    return;
  }

  // Info mode for images
  if (opts.info) {
    const info = await getImageInfo(input);
    const term = detect();
    console.log(`Image:    ${opts.file ?? "(stdin)"}`);
    console.log(`Format:   ${info.format}`);
    console.log(`Size:     ${info.width}x${info.height}`);
    console.log(`Protocol: ${term.protocol}`);
    console.log(`Terminal: ${term.terminal ?? "unknown"}`);
    console.log(`tmux:     ${term.tmux}`);
    return;
  }

  // Static image display
  await display(input, {
    width: opts.width,
    height: opts.height,
    protocol: opts.protocol,
  });
}

main().catch((err: Error) => {
  console.error(`phosphor: ${err.message}`);
  process.exit(1);
});
