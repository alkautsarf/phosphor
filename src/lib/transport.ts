import { execSync } from "child_process";

let passthroughEnabled = false;

/**
 * Enable tmux DCS passthrough on the current pane.
 * Runs once per process — subsequent calls are no-ops.
 */
function enablePassthrough(): void {
  if (passthroughEnabled) return;
  try {
    execSync("tmux set -p allow-passthrough on", { stdio: "ignore" });
    passthroughEnabled = true;
  } catch {
    // tmux not available or set failed — silently continue
  }
}

/**
 * Wrap an escape sequence in tmux DCS passthrough.
 * Every \x1b in the payload is doubled to \x1b\x1b.
 */
function wrapDCS(sequence: string): string {
  const escaped = sequence.replace(/\x1b/g, "\x1b\x1b");
  return `\x1bPtmux;${escaped}\x1b\\`;
}

/**
 * Write Kitty transmit sequences (image data) to the terminal.
 * In tmux: wraps in DCS passthrough.
 * Outside tmux: writes directly to stdout.
 */
export function writeTransmit(chunks: string[], inTmux: boolean): void {
  if (inTmux) {
    enablePassthrough();
    const wrapped = chunks.map(wrapDCS).join("");
    process.stdout.write(wrapped);
  } else {
    process.stdout.write(chunks.join(""));
  }
}

/**
 * Write placeholder text to stdout.
 * This is regular text that flows through tmux normally.
 */
export function writePlaceholders(text: string): void {
  process.stdout.write(text);
}
