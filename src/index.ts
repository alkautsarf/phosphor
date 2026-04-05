import { display, detect, getImageInfo, isPdf, getPdfInfo, viewPdf } from "./lib/phosphor.js";
import type { Protocol } from "./lib/detect.js";

process.on("SIGPIPE", () => process.exit(0));

function printUsage(): void {
  console.log(`phosphor — render images and view PDFs in your terminal

Usage:
  phosphor <file>                Display an image or open a PDF
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

Options:
  -w, --width <N>     Max width in terminal cells
  --height <N>        Max height in terminal cells
  -p, --protocol <P>  Force protocol: kitty, iterm2, sixel, halfblock
  --info              Show file and terminal info without rendering
  --page <N>          Open PDF at page N
  --version           Show version
  --help              Show this help`);
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
