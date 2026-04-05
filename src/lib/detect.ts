export type Protocol = "kitty" | "iterm2" | "sixel" | "halfblock";

export interface TerminalInfo {
  protocol: Protocol;
  tmux: boolean;
  terminal: string | null;
}

/** Detect if running inside tmux. */
export function isTmux(): boolean {
  return !!(
    process.env.TMUX ||
    process.env.TERM?.startsWith("tmux") ||
    process.env.TERM_PROGRAM === "tmux"
  );
}

/** Detect the outer terminal when inside tmux. */
function detectOuterTerminal(): string | null {
  // Inside tmux, TERM_PROGRAM is overwritten to "tmux".
  // Some terminals set their own env vars that survive tmux.
  if (process.env.GHOSTTY_RESOURCES_DIR) return "ghostty";
  if (process.env.KITTY_WINDOW_ID || process.env.KITTY_PID) return "kitty";
  if (process.env.WEZTERM_PANE) return "wezterm";

  // LC_TERMINAL survives tmux on some setups
  const lc = process.env.LC_TERMINAL?.toLowerCase();
  if (lc === "iterm2") return "iterm2";

  // TERM=xterm-ghostty is set by Ghostty even inside tmux
  if (process.env.TERM === "xterm-ghostty") return "ghostty";

  return null;
}

/** Detect the current terminal emulator. */
function detectTerminal(): string | null {
  const tp = process.env.TERM_PROGRAM?.toLowerCase();
  if (tp === "ghostty") return "ghostty";
  if (tp === "kitty") return "kitty";
  if (tp === "wezterm") return "wezterm";
  if (tp === "iterm.app") return "iterm2";
  if (tp === "rio") return "rio";
  if (tp === "warpterminal") return "warp";
  if (tp === "vscode") return "vscode";
  if (tp === "contour") return "contour";
  if (tp === "alacritty") return "alacritty";

  if (process.env.KITTY_WINDOW_ID || process.env.KITTY_PID) return "kitty";
  if (process.env.GHOSTTY_RESOURCES_DIR) return "ghostty";
  if (process.env.WEZTERM_PANE) return "wezterm";

  const term = process.env.TERM;
  if (term?.includes("kitty")) return "kitty";
  if (term === "xterm-ghostty") return "ghostty";
  if (term?.includes("alacritty")) return "alacritty";
  if (term?.startsWith("foot")) return "foot";

  if (process.env.KONSOLE_VERSION) return "konsole";
  if (process.env.WT_SESSION) return "windows-terminal";

  return null;
}

const KITTY_TERMINALS = new Set([
  "kitty",
  "ghostty",
  "wezterm",
  "rio",
  "warp",
  "contour",
]);

const ITERM2_TERMINALS = new Set(["iterm2", "wezterm", "mintty"]);

const SIXEL_TERMINALS = new Set([
  "wezterm",
  "foot",
  "mlterm",
  "mintty",
  "contour",
]);

/** Detect best supported protocol for the current terminal. */
function detectProtocol(terminal: string | null): Protocol {
  if (!terminal) return "halfblock";

  if (KITTY_TERMINALS.has(terminal)) return "kitty";

  // iTerm2 supports Kitty since 3.5 but more reliably via its own protocol
  if (ITERM2_TERMINALS.has(terminal)) return "iterm2";

  if (SIXEL_TERMINALS.has(terminal)) return "sixel";

  // Konsole has partial Kitty support since 22.04
  if (terminal === "konsole") {
    const ver = parseInt(process.env.KONSOLE_VERSION ?? "0", 10);
    if (ver >= 220400) return "kitty";
  }

  // VS Code terminal (xterm.js) supports Sixel since 1.80
  if (terminal === "vscode") return "sixel";

  return "halfblock";
}

/** Detect terminal capabilities: protocol, tmux status, terminal name. */
export function detect(): TerminalInfo {
  const inTmux = isTmux();
  const terminal = inTmux ? detectOuterTerminal() : detectTerminal();
  const protocol = detectProtocol(terminal);

  return { protocol, tmux: inTmux, terminal };
}
