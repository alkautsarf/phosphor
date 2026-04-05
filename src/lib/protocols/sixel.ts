/**
 * Encode raw RGBA pixel data as Sixel escape sequences.
 * Sixel uses a 6-pixel-tall band system with a 256-color palette.
 *
 * This is a minimal pure-TS implementation — no external deps.
 */

/** Convert RGBA pixels to a quantized 256-color Sixel string. */
export function encode(
  rgba: Buffer,
  width: number,
  height: number,
): string[] {

  let sixel = "\x1bPq\n"; // DCS q — enter Sixel mode

  // Define color registers (6x6x6 cube)
  for (let i = 0; i < 216; i++) {
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    // Sixel uses percentages (0-100)
    const rp = Math.round((r / 5) * 100);
    const gp = Math.round((g / 5) * 100);
    const bp = Math.round((b / 5) * 100);
    sixel += `#${i};2;${rp};${gp};${bp}`;
  }

  // Process in 6-row bands
  for (let bandY = 0; bandY < height; bandY += 6) {
    // Group pixels by color to minimize color switches
    const colorBands = new Map<number, number[]>();

    for (let x = 0; x < width; x++) {
      for (let row = 0; row < 6; row++) {
        const y = bandY + row;
        if (y >= height) continue;

        const idx = (y * width + x) * 4;
        const r = rgba[idx]!;
        const g = rgba[idx + 1]!;
        const b = rgba[idx + 2]!;
        const a = rgba[idx + 3]!;

        if (a < 128) continue; // Skip transparent pixels

        const colorIdx = quantize(r, g, b);

        if (!colorBands.has(colorIdx)) {
          colorBands.set(colorIdx, new Array(width).fill(0));
        }
        colorBands.get(colorIdx)![x]! |= 1 << row;
      }
    }

    // Write each color's band
    let first = true;
    for (const [colorIdx, band] of colorBands) {
      if (!first) sixel += "$"; // Carriage return (same band)
      first = false;

      sixel += `#${colorIdx}`;

      // RLE-compress the band
      let i = 0;
      while (i < width) {
        const val = band[i]!;
        let count = 1;
        while (i + count < width && band[i + count] === val) count++;

        const char = String.fromCharCode(63 + val);
        if (count > 3) {
          sixel += `!${count}${char}`;
        } else {
          sixel += char.repeat(count);
        }
        i += count;
      }
    }

    sixel += "-"; // Next band (newline)
  }

  sixel += "\x1b\\"; // DCS terminator — exit Sixel mode

  return [sixel];
}

function quantize(r: number, g: number, b: number): number {
  const ri = Math.round((r / 255) * 5);
  const gi = Math.round((g / 255) * 5);
  const bi = Math.round((b / 255) * 5);
  return ri * 36 + gi * 6 + bi;
}
