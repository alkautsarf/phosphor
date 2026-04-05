/**
 * Encode a PNG buffer as an iTerm2 inline image escape sequence.
 * Format: OSC 1337 ; File=<params>:<base64> BEL
 */
export function encode(pngBuffer: Buffer): string[] {
  const b64 = pngBuffer.toString("base64");
  return [`\x1b]1337;File=size=${pngBuffer.length};inline=1;preserveAspectRatio=1:${b64}\x07`];
}
