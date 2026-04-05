const CHUNK_SIZE = 4096; // base64 characters per chunk

// Unicode placeholder for virtual placement (U+10EEEE)
const PLACEHOLDER = "\u{10EEEE}";

// Diacritics table for encoding row/column indices (first 60 entries — enough for most terminals)
const DIACRITICS = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f,
  0x0346, 0x034a, 0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0357,
  0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484,
  0x0485, 0x0486, 0x0487, 0x0592, 0x0593, 0x0594, 0x0595, 0x0597,
  0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1,
  0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611,
  0x0612, 0x0613, 0x0614, 0x0615,
];

function diacritic(index: number): string {
  return String.fromCodePoint(DIACRITICS[index % DIACRITICS.length]!);
}

/** Generate a random image ID (1 to 2^24-1) to avoid collisions between instances. */
function randomImageId(): number {
  return Math.floor(Math.random() * 0xfffffe) + 1;
}

/**
 * Encode a PNG buffer into Kitty graphics protocol escape sequences.
 * Uses direct display (a=T) — for use outside tmux.
 */
export function encodeDirect(pngBuffer: Buffer): string[] {
  const b64 = pngBuffer.toString("base64");
  const chunks: string[] = [];

  if (b64.length <= CHUNK_SIZE) {
    chunks.push(`\x1b_Ga=T,f=100,t=d,q=2,m=0;${b64}\x1b\\`);
    return chunks;
  }

  const totalChunks = Math.ceil(b64.length / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = b64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    const more = i === totalChunks - 1 ? 0 : 1;
    if (i === 0) {
      chunks.push(`\x1b_Ga=T,f=100,t=d,q=2,m=${more};${chunk}\x1b\\`);
    } else {
      chunks.push(`\x1b_Gm=${more},q=2;${chunk}\x1b\\`);
    }
  }
  return chunks;
}

/**
 * Encode a PNG buffer for Kitty virtual/Unicode placement.
 * Returns { transmit, placeholders } where:
 * - transmit: escape sequences to send image data (via DCS passthrough in tmux)
 * - placeholders: text lines with Unicode placeholders to write to stdout
 */
export function encodeVirtual(
  pngBuffer: Buffer,
  cols: number,
  rows: number,
): { transmit: string[]; placeholders: string } {
  const imageId = randomImageId();
  const b64 = pngBuffer.toString("base64");

  // Build transmit chunks with virtual placement enabled
  const transmit: string[] = [];
  if (b64.length <= CHUNK_SIZE) {
    transmit.push(
      `\x1b_Gq=2,i=${imageId},a=T,U=1,f=100,t=d,m=0;${b64}\x1b\\`,
    );
  } else {
    const totalChunks = Math.ceil(b64.length / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = b64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const more = i === totalChunks - 1 ? 0 : 1;
      if (i === 0) {
        transmit.push(
          `\x1b_Gq=2,i=${imageId},a=T,U=1,f=100,t=d,m=${more};${chunk}\x1b\\`,
        );
      } else {
        transmit.push(`\x1b_Gm=${more},q=2;${chunk}\x1b\\`);
      }
    }
  }

  // Encode image ID into foreground color bytes
  const idR = (imageId >> 16) & 0xff;
  const idG = (imageId >> 8) & 0xff;
  const idB = imageId & 0xff;
  const idExtra = (imageId >> 24) & 0xff;
  const fgColor = `\x1b[38;2;${idR};${idG};${idB}m`;
  const fgReset = `\x1b[39m`;

  // Build placeholder lines
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = fgColor;
    // First cell: placeholder + row diacritic + col(0) diacritic + msb diacritic
    line += PLACEHOLDER + diacritic(y) + diacritic(0) + diacritic(idExtra);
    // Remaining cells: bare placeholder (inherits row, auto-increments col)
    for (let x = 1; x < cols; x++) {
      line += PLACEHOLDER;
    }
    line += fgReset;
    lines.push(line);
  }

  return { transmit, placeholders: lines.join("\n") };
}

/** Generate a Kitty delete command for a specific image or all images. */
export function clear(imageId?: number): string {
  if (imageId !== undefined) {
    return `\x1b_Ga=d,d=I,i=${imageId},q=2;\x1b\\`;
  }
  return `\x1b_Ga=d,d=A,q=2;\x1b\\`;
}
