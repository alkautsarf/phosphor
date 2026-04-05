import { execSync } from "child_process";

export interface CellSize {
  width: number;
  height: number;
}

let cached: CellSize | null = null;

/**
 * Query the actual cell pixel size from the terminal.
 * In tmux: sends CSI 16t via DCS passthrough through stdout,
 * reads response from stdin. Safe — never touches the client TTY directly.
 * Outside tmux: sends CSI 16t directly to stdout, reads from stdin.
 * Falls back to env var PHOSPHOR_CELL_SIZE=WxH or defaults.
 */
export function getCellSize(inTmux: boolean): CellSize {
  if (cached) return cached;

  // Check env var first
  const envSize = process.env.PHOSPHOR_CELL_SIZE;
  if (envSize) {
    const [w, h] = envSize.split("x").map(Number);
    if (w && h && w > 0 && h > 0) {
      cached = { width: w, height: h };
      return cached;
    }
  }

  // Try querying the terminal
  cached = queryViaDCS(inTmux) ?? { width: 10, height: 20 };
  return cached;
}

/**
 * Query cell size by sending CSI 16t and reading the response.
 * In tmux, wraps the query in DCS passthrough.
 * Uses a spawned subprocess to do raw terminal I/O safely.
 */
function queryViaDCS(inTmux: boolean): CellSize | null {
  // Build the query — CSI 16t requests cell size in pixels
  // Response: CSI 6 ; cell_height ; cell_width t
  const query = inTmux
    ? "\x1bPtmux;\x1b\x1b[16t\x1b\\"  // DCS-wrapped
    : "\x1b[16t";                        // direct

  try {
    // Use a subprocess that:
    // 1. Puts tty in raw mode (no echo, no line buffering)
    // 2. Sends the query to the tty
    // 3. Reads the response with a timeout
    // 4. Restores tty and prints the response
    // This avoids interfering with tmux's input loop because
    // it operates on /dev/tty (the process's controlling terminal = tmux PTY)
    const script = `
import sys, os, termios, select, tty

fd = os.open('/dev/tty', os.O_RDWR)
old = termios.tcgetattr(fd)
try:
    tty.setraw(fd)
    os.write(fd, b'${escapeForPython(query)}')
    # Read response with 1s timeout
    buf = b''
    while True:
        r, _, _ = select.select([fd], [], [], 1.0)
        if not r:
            break
        ch = os.read(fd, 1)
        buf += ch
        if ch == b't':
            break
finally:
    termios.tcsetattr(fd, termios.TCSAFLUSH, old)
    os.close(fd)

# Parse CSI 6 ; H ; W t
resp = buf.decode('ascii', errors='ignore')
import re
m = re.search(r'\\x1b\\[6;(\\d+);(\\d+)t', resp)
if m:
    print(f"{m.group(2)}x{m.group(1)}")
`;

    const result = execSync(`python3 -c ${shellEscape(script)}`, {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    const match = result.match(/^(\d+)x(\d+)$/);
    if (match) {
      const width = parseInt(match[1]!, 10);
      const height = parseInt(match[2]!, 10);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
  } catch {
    // Query failed — return null for fallback
  }

  return null;
}

/** Escape a string for embedding in a Python string literal. */
function escapeForPython(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\x1b/g, "\\x1b")
    .replace(/'/g, "\\'");
}

/** Shell-escape a string for use as a command argument. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
