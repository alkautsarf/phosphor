import { display, detect, getImageInfo } from "./lib/phosphor.js";
import type { Protocol } from "./lib/detect.js";

// Handle broken pipes gracefully
process.on("SIGPIPE", () => process.exit(0));

function printUsage(): void {
  console.log(`phosphor — render images in your terminal

Usage:
  phosphor <file>                Display an image
  phosphor <file> -w 60          Constrain width (cells)
  phosphor <file> -h 20          Constrain height (cells)
  phosphor <file> -p kitty       Force protocol (kitty|iterm2|sixel|halfblock)
  phosphor <file> --info         Show image info + detected protocol
  cat image.png | phosphor       Read from stdin

Options:
  -w, --width <N>     Max width in terminal cells
  -h, --height <N>    Max height in terminal cells
  -p, --protocol <P>  Force protocol: kitty, iterm2, sixel, halfblock
  --info              Show image and terminal info without rendering
  --version           Show version
  --help              Show this help`);
}

function parseArgs(argv: string[]): {
  file: string | null;
  width?: number;
  height?: number;
  protocol?: Protocol;
  info: boolean;
  help: boolean;
  version: boolean;
} {
  const result = {
    file: null as string | null,
    width: undefined as number | undefined,
    height: undefined as number | undefined,
    protocol: undefined as Protocol | undefined,
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
      case "-h":
      case "--height":
        result.height = parseInt(args[++i] ?? "", 10);
        break;
      case "-p":
      case "--protocol":
        result.protocol = args[++i] as Protocol;
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
    console.log("phosphor 0.1.0");
    return;
  }

  // Resolve input: file path or stdin
  let input: Buffer | string;
  if (opts.file) {
    input = opts.file;
  } else if (!process.stdin.isTTY) {
    input = await readStdin();
  } else {
    printUsage();
    process.exit(1);
  }

  // Info mode: show metadata without rendering
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
