export type Key =
  | "space"
  | "q"
  | "right"
  | "left"
  | "ctrl+c"
  | { type: "digit"; value: number };

type KeyHandler = (key: Key) => void;

let rawModeActive = false;
let altScreenActive = false;
let handler: KeyHandler | null = null;

export function enterAltScreen(): void {
  if (altScreenActive) return;
  process.stdout.write("\x1b[?1049h\x1b[H\x1b[2J");
  altScreenActive = true;
}

export function exitAltScreen(): void {
  if (!altScreenActive) return;
  process.stdout.write("\x1b[?1049l");
  altScreenActive = false;
}

export function enterRawMode(): void {
  if (rawModeActive) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);
  rawModeActive = true;
}

export function exitRawMode(): void {
  if (!rawModeActive) return;
  process.stdin.removeListener("data", onData);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  rawModeActive = false;
}

export function onKeypress(cb: KeyHandler): void {
  handler = cb;
}

export function cleanup(): void {
  handler = null;
  exitRawMode();
  exitAltScreen();
  process.stdout.write("\x1b[?25h"); // show cursor
}

export function hideCursor(): void {
  process.stdout.write("\x1b[?25l");
}

export function moveCursor(row: number, col: number): void {
  process.stdout.write(`\x1b[${row};${col}H`);
}

export function clearLine(): void {
  process.stdout.write("\x1b[2K");
}

function onData(buf: Buffer): void {
  if (!handler) return;
  const seq = buf.toString();

  switch (seq) {
    case "\x03":      return handler("ctrl+c");
    case " ":         return handler("space");
    case "q":         return handler("q");
    case "j":
    case "l":
    case "\x1b[C":    return handler("right");
    case "k":
    case "h":
    case "\x1b[D":    return handler("left");
    case "\x1b[B":    return handler("right");  // down = next page
    case "\x1b[A":    return handler("left");   // up = prev page
  }

  if (seq.length === 1 && seq >= "0" && seq <= "9") {
    handler({ type: "digit", value: parseInt(seq, 10) });
  }
}
