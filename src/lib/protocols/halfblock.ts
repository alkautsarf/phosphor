/**
 * Render an image using Unicode half-block characters (▀) with 24-bit RGB.
 * Each cell represents 2 vertical pixels: top pixel as foreground, bottom as background.
 * Works in virtually any modern terminal.
 */
export function encode(
  rgba: Buffer,
  width: number,
  height: number,
): string[] {
  const lines: string[] = [];

  // Process 2 rows at a time (each terminal row = 2 pixel rows)
  for (let y = 0; y < height; y += 2) {
    let line = "";

    for (let x = 0; x < width; x++) {
      // Top pixel (foreground)
      const topIdx = (y * width + x) * 4;
      const tr = rgba[topIdx]!;
      const tg = rgba[topIdx + 1]!;
      const tb = rgba[topIdx + 2]!;

      // Bottom pixel (background) — may not exist if height is odd
      const bottomY = y + 1;
      if (bottomY < height) {
        const botIdx = (bottomY * width + x) * 4;
        const br = rgba[botIdx]!;
        const bg = rgba[botIdx + 1]!;
        const bb = rgba[botIdx + 2]!;

        // Upper half block: fg=top, bg=bottom
        line += `\x1b[38;2;${tr};${tg};${tb}m\x1b[48;2;${br};${bg};${bb}m\u2580`;
      } else {
        // Last odd row: just the top pixel
        line += `\x1b[38;2;${tr};${tg};${tb}m\u2580`;
      }
    }

    line += "\x1b[0m"; // Reset colors
    lines.push(line);
  }

  return [lines.join("\n")];
}
