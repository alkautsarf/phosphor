import { type Protocol, type TerminalInfo, detect } from "./detect.js";
import { type DecodedImage, decode, getImageInfo } from "./decode.js";
import { fitToTerminal, getTerminalSize } from "./resize.js";
import { getCellSize } from "./cellsize.js";
import {
  encodeDirect as kittyDirect,
  encodeVirtual as kittyVirtual,
  clear as kittyClear,
} from "./protocols/kitty.js";
import { encode as iterm2Encode } from "./protocols/iterm2.js";
import { encode as sixelEncode } from "./protocols/sixel.js";
import { encode as halfblockEncode } from "./protocols/halfblock.js";
import { writeTransmit, writePlaceholders } from "./transport.js";

export type { Protocol, TerminalInfo };

export interface DisplayOptions {
  /** Max width in terminal cells. */
  width?: number;
  /** Max height in terminal cells. */
  height?: number;
  /** Force a specific protocol. */
  protocol?: Protocol;
}

export interface Renderer {
  protocol: Protocol;
  tmux: boolean;
  terminal: string | null;
  display(input: Buffer | string, opts?: DisplayOptions): Promise<void>;
  clear(): void;
}

/**
 * Create a renderer with auto-detected terminal capabilities.
 */
export async function createRenderer(): Promise<Renderer> {
  const info = detect();

  return {
    protocol: info.protocol,
    tmux: info.tmux,
    terminal: info.terminal,

    async display(input: Buffer | string, opts?: DisplayOptions) {
      await renderImage(
        input,
        { ...opts, protocol: opts?.protocol ?? info.protocol },
        info,
      );
    },

    clear() {
      if (info.protocol === "kitty") {
        writeTransmit([kittyClear()], info.tmux);
      }
    },
  };
}

/**
 * Display an image in the terminal. Auto-detects protocol and tmux.
 */
export async function display(
  input: Buffer | string,
  opts?: DisplayOptions,
): Promise<void> {
  const info = detect();
  await renderImage(input, opts ?? {}, info);
}

async function renderImage(
  input: Buffer | string,
  opts: DisplayOptions,
  info: TerminalInfo,
): Promise<void> {
  const protocol = opts.protocol ?? info.protocol;

  const imageInfo = await getImageInfo(input);

  // Kitty protocol in tmux: use virtual Unicode placement
  if (protocol === "kitty" && info.tmux) {
    const cell = getCellSize(true);
    const term = getTerminalSize();
    const maxCols = opts.width ?? term.cols - 2;
    const maxRows = opts.height ?? Math.floor(term.rows * 0.75);
    const maxPixelW = maxCols * cell.width;
    const maxPixelH = maxRows * cell.height;

    // Only downscale if image exceeds terminal bounds
    const needsResize = imageInfo.width > maxPixelW || imageInfo.height > maxPixelH;
    const decoded = needsResize
      ? await decode(input, maxPixelW, maxPixelH)
      : await decode(input);

    const cols = Math.min(Math.ceil(decoded.width / cell.width), maxCols);
    const rows = Math.min(Math.ceil(decoded.height / cell.height), maxRows);

    const { transmit, placeholders } = kittyVirtual(decoded.png, cols, rows);
    writeTransmit(transmit, true);

    // Center horizontally
    const padLeft = Math.max(0, Math.floor((term.cols - cols) / 2));
    if (padLeft > 0) {
      const padding = " ".repeat(padLeft);
      const centered = placeholders.split("\n").map((line) => padding + line).join("\n");
      writePlaceholders(centered);
    } else {
      writePlaceholders(placeholders);
    }
    process.stdout.write("\n");
    return;
  }

  const fit = fitToTerminal(imageInfo.width, imageInfo.height, opts.width, opts.height);
  const decoded = await decode(input, fit.width, fit.height);

  if (protocol === "kitty") {
    writeTransmit(kittyDirect(decoded.png), false);
    process.stdout.write("\n");
    return;
  }

  if (protocol === "halfblock") {
    const term = getTerminalSize();
    const maxW = opts.width ?? term.cols - 2;
    const maxH = (opts.height ?? Math.floor(term.rows * 0.75)) * 2;
    const hbDecoded = await decode(input, maxW, maxH);
    process.stdout.write(halfblockEncode(hbDecoded.rgba, hbDecoded.width, hbDecoded.height).join(""));
    process.stdout.write("\n");
    return;
  }

  writeTransmit(encodeForProtocol(protocol, decoded), info.tmux);
  process.stdout.write("\n");
}

function encodeForProtocol(protocol: Protocol, image: DecodedImage): string[] {
  switch (protocol) {
    case "kitty":
      return kittyDirect(image.png);
    case "iterm2":
      return iterm2Encode(image.png);
    case "sixel":
      return sixelEncode(image.rgba, image.width, image.height);
    case "halfblock":
      return halfblockEncode(image.rgba, image.width, image.height);
  }
}

export { getImageInfo } from "./decode.js";
export { detect } from "./detect.js";
export { isPdf, getPdfInfo } from "./pdf.js";
export { viewPdf } from "./pdfviewer.js";
export { isMd } from "./md.js";
export { viewMd } from "./mdviewer.js";
