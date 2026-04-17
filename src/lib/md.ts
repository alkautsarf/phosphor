import { readFileSync, existsSync } from "fs";
import { join, resolve, extname } from "path";
import { Lexer, type Token, type Tokens } from "marked";
import satori from "satori";
import sharp from "sharp";

type SatoriNode = {
  type: string;
  props: {
    style?: Record<string, any>;
    children?: (string | SatoriNode)[];
    src?: string;
    width?: number;
    height?: number;
    [key: string]: any;
  };
};

// ── Detection ──────────────────────────────────────────────────────

const MD_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);

export function isMd(input: string): boolean {
  const ext = extname(input).toLowerCase().replace(".", "");
  return MD_EXTENSIONS.has(ext);
}

// ── Font Loading ───────────────────────────────────────────────────

let fontsCache: { name: string; data: ArrayBuffer; weight: number; style: string }[] | null = null;

function loadFonts() {
  if (fontsCache) return fontsCache;

  // Resolve fonts dir relative to this source file
  const candidates = [
    join(import.meta.dir, "..", "fonts"),              // src/lib/ → src/fonts/
    join(import.meta.dir, "fonts"),                    // flat
    join(import.meta.dir, "src", "fonts"),             // bundled: index.js + src/fonts/
    join(import.meta.dir, "..", "src", "fonts"),       // dist/ → src/fonts/
    join(import.meta.dir, "..", "..", "src", "fonts"), // nested dist
  ];

  let fontsDir = "";
  for (const c of candidates) {
    if (existsSync(join(c, "Geist-Regular.otf"))) {
      fontsDir = c;
      break;
    }
  }
  if (!fontsDir) throw new Error("phosphor: could not find font files");

  const geistRegular = readFileSync(join(fontsDir, "Geist-Regular.otf"));
  const geistSemiBold = readFileSync(join(fontsDir, "Geist-SemiBold.otf"));
  const geistBold = readFileSync(join(fontsDir, "Geist-Bold.otf"));
  const geistMono = readFileSync(join(fontsDir, "GeistMono-Regular.otf"));

  fontsCache = [
    { name: "Geist", data: geistRegular.buffer as ArrayBuffer, weight: 400, style: "normal" },
    { name: "Geist", data: geistSemiBold.buffer as ArrayBuffer, weight: 600, style: "normal" },
    { name: "Geist", data: geistBold.buffer as ArrayBuffer, weight: 700, style: "normal" },
    { name: "Geist Mono", data: geistMono.buffer as ArrayBuffer, weight: 400, style: "normal" },
  ];
  return fontsCache;
}

// ── Color Palette ──────────────────────────────────────────────────

export type MdTheme = "light" | "dark" | "transparent";

interface Palette {
  bg: string;
  bgRgb: { r: number; g: number; b: number };
  text: string;
  textDim: string;
  heading1: string;
  heading2: string;
  heading3: string;
  heading4: string;
  link: string;
  codeBg: string;
  codeBorder: string;
  codeText: string;
  codeBlockBg: string;
  codeBlockText: string;
  codeBlockLangText: string;
  codeBlockLangBorder: string;
  quoteBorder: string;
  quoteBg: string;
  quoteText: string;
  hrColor: string;
  h1Underline: string;
  tableBorder: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  tableRowBg: string;
  tableAltRow: string;
  checkDone: string;
  checkTodo: string;
}

const LIGHT: Palette = {
  bg: "#ffffff",
  bgRgb: { r: 255, g: 255, b: 255 },
  text: "#1a1a2e",
  textDim: "#636e72",
  heading1: "#0f0f23",
  heading2: "#1e3a5f",
  heading3: "#2d5016",
  heading4: "#5c3d1e",
  link: "#2563eb",
  codeBg: "#f0f4f8",
  codeBorder: "#d8dee6",
  codeText: "#d63384",
  codeBlockBg: "#1e1e2e",
  codeBlockText: "#cdd6f4",
  codeBlockLangText: "#8899aa",
  codeBlockLangBorder: "#2a2a3e",
  quoteBorder: "#6366f1",
  quoteBg: "#f5f3ff",
  quoteText: "#4338ca",
  hrColor: "#e2e8f0",
  h1Underline: "#e2e8f0",
  tableBorder: "#e2e8f0",
  tableHeaderBg: "#f1f5f9",
  tableHeaderText: "#1a1a2e",
  tableRowBg: "#ffffff",
  tableAltRow: "#f8fafc",
  checkDone: "#22c55e",
  checkTodo: "#94a3b8",
};

const DARK: Palette = {
  bg: "#0d1117",
  bgRgb: { r: 13, g: 17, b: 23 },
  text: "#e2e8f0",
  textDim: "#94a3b8",
  heading1: "#f1f5f9",
  heading2: "#60a5fa",
  heading3: "#4ade80",
  heading4: "#c084fc",
  link: "#60a5fa",
  codeBg: "#1e293b",
  codeBorder: "#334155",
  codeText: "#fb923c",
  codeBlockBg: "#151d2b",
  codeBlockText: "#e2e8f0",
  codeBlockLangText: "#64748b",
  codeBlockLangBorder: "#1e293b",
  quoteBorder: "#818cf8",
  quoteBg: "#14172a",
  quoteText: "#a5b4fc",
  hrColor: "#1e293b",
  h1Underline: "#1e293b",
  tableBorder: "#293548",
  tableHeaderBg: "#151d2b",
  tableHeaderText: "#cbd5e1",
  tableRowBg: "#0d1117",
  tableAltRow: "#111827",
  checkDone: "#4ade80",
  checkTodo: "#475569",
};

const TRANSPARENT: Palette = {
  ...DARK,
  bg: "transparent",
  bgRgb: { r: 0, g: 0, b: 0 },
  // Brighter text for no-background readability
  text: "#f1f5f9",
  textDim: "#cbd5e1",
  tableHeaderText: "#e2e8f0",
  // Semi-transparent backgrounds so wallpaper bleeds through
  codeBlockBg: "#0d1117cc",
  quoteBg: "#14172acc",
  tableHeaderBg: "#0d1117cc",
  tableRowBg: "#0d1117aa",
  tableAltRow: "#111827aa",
  tableBorder: "#334155aa",
};

let C: Palette = LIGHT;
let isTransparent = false;

export function setTheme(theme: MdTheme): void {
  isTransparent = theme === "transparent";
  C = theme === "dark" ? DARK : theme === "transparent" ? TRANSPARENT : LIGHT;
}

export function detectTheme(): MdTheme {
  // Check PHOSPHOR_THEME env var first (user's persistent preference)
  const envTheme = process.env.PHOSPHOR_THEME?.toLowerCase();
  if (envTheme === "light" || envTheme === "dark" || envTheme === "transparent") {
    return envTheme;
  }

  // Fall back to terminal auto-detection
  const colorfgbg = process.env.COLORFGBG;
  if (colorfgbg) {
    const parts = colorfgbg.split(";");
    const bg = parseInt(parts[parts.length - 1] ?? "15", 10);
    if (bg < 8) return "dark";
  }

  return "dark";
}

// ── Satori Tree Builders ───────────────────────────────────────────

function div(style: Record<string, any>, children: (string | SatoriNode)[]): SatoriNode {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

function span(style: Record<string, any>, children: (string | SatoriNode)[]): SatoriNode {
  return { type: "span", props: { style, children } };
}

function renderInlineTokens(tokens: Token[], basePath: string): (string | SatoriNode)[] {
  const result: (string | SatoriNode)[] = [];

  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tok = t as Tokens.Text;
        if (tok.tokens) {
          result.push(...renderInlineTokens(tok.tokens, basePath));
        } else {
          result.push(tok.text);
        }
        break;
      }
      case "strong": {
        const tok = t as Tokens.Strong;
        result.push(span(
          { fontWeight: 700 },
          renderInlineTokens(tok.tokens, basePath),
        ));
        break;
      }
      case "em": {
        const tok = t as Tokens.Em;
        result.push(span(
          { fontStyle: "italic" },
          renderInlineTokens(tok.tokens, basePath),
        ));
        break;
      }
      case "codespan": {
        const tok = t as Tokens.Codespan;
        result.push(span(
          {
            fontFamily: "Geist Mono",
            fontSize: 13,
            backgroundColor: C.codeBg,
            color: C.codeText,
            padding: "2px 7px",
            borderRadius: 4,
            border: `1px solid ${C.codeBorder}`,
          },
          [tok.text],
        ));
        break;
      }
      case "link": {
        const tok = t as Tokens.Link;
        result.push(span(
          { color: C.link, textDecoration: "underline" },
          renderInlineTokens(tok.tokens, basePath),
        ));
        break;
      }
      case "del": {
        const tok = t as Tokens.Del;
        result.push(span(
          { textDecoration: "line-through", color: C.textDim },
          renderInlineTokens(tok.tokens, basePath),
        ));
        break;
      }
      case "image": {
        const tok = t as Tokens.Image;
        const imgNode = resolveImage(tok.href, tok.text, basePath);
        if (imgNode) result.push(imgNode);
        break;
      }
      case "br":
        result.push("\n");
        break;
      case "escape": {
        const tok = t as Tokens.Escape;
        result.push(tok.text);
        break;
      }
      default:
        if ("text" in t && typeof (t as any).text === "string") {
          result.push((t as any).text);
        }
    }
  }

  return result;
}

function resolveImage(href: string, alt: string, basePath: string): SatoriNode | null {
  // Skip remote URLs for now
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return span({ color: C.textDim, fontSize: 13 }, [`[image: ${alt || href}]`]);
  }

  const imgPath = resolve(basePath, href);
  if (!existsSync(imgPath)) {
    return span({ color: C.textDim, fontSize: 13 }, [`[missing: ${href}]`]);
  }

  try {
    const imgBuf = readFileSync(imgPath);
    const ext = extname(imgPath).toLowerCase();
    const mime = ext === ".png" ? "image/png"
      : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
      : ext === ".gif" ? "image/gif"
      : ext === ".webp" ? "image/webp"
      : ext === ".svg" ? "image/svg+xml"
      : "image/png";
    const dataUri = `data:${mime};base64,${imgBuf.toString("base64")}`;

    return {
      type: "img",
      props: {
        src: dataUri,
        width: 500,
        height: 300,
        style: {
          maxWidth: "100%",
          borderRadius: 8,
          marginTop: 8,
          marginBottom: 8,
        },
      },
    };
  } catch {
    return span({ color: C.textDim, fontSize: 13 }, [`[error loading: ${href}]`]);
  }
}

function renderBlockToken(token: Token, basePath: string): SatoriNode | null {
  switch (token.type) {
    case "heading": {
      const tok = token as Tokens.Heading;
      const sizes: Record<number, { fontSize: number; color: string; marginTop: number; marginBottom: number }> = {
        1: { fontSize: 36, color: C.heading1, marginTop: 0, marginBottom: 20 },
        2: { fontSize: 28, color: C.heading2, marginTop: 32, marginBottom: 16 },
        3: { fontSize: 22, color: C.heading3, marginTop: 28, marginBottom: 12 },
        4: { fontSize: 18, color: C.heading4, marginTop: 24, marginBottom: 10 },
        5: { fontSize: 16, color: C.heading4, marginTop: 20, marginBottom: 8 },
        6: { fontSize: 14, color: C.textDim, marginTop: 16, marginBottom: 8 },
      };
      const s = sizes[tok.depth] ?? sizes[3]!;

      const headingContent = div(
        {
          flexDirection: "row",
          flexWrap: "wrap",
          fontWeight: 700,
          fontSize: s.fontSize,
          color: s.color,
          marginTop: s.marginTop,
          marginBottom: s.marginBottom,
          lineHeight: 1.3,
        },
        renderInlineTokens(tok.tokens, basePath),
      );

      // H1 gets an underline
      if (tok.depth === 1) {
        return div(
          { flexDirection: "column" },
          [
            headingContent,
            div({
              height: 3,
              backgroundColor: C.h1Underline,
              marginBottom: 20,
              borderRadius: 2,
            }, []),
          ],
        );
      }

      return headingContent;
    }

    case "paragraph": {
      const tok = token as Tokens.Paragraph;
      // Check if paragraph contains only an image
      if (tok.tokens.length === 1 && tok.tokens[0]!.type === "image") {
        const imgTok = tok.tokens[0] as Tokens.Image;
        const imgNode = resolveImage(imgTok.href, imgTok.text, basePath);
        if (imgNode) {
          return div(
            {
              flexDirection: "column",
              alignItems: "center",
              marginTop: 12,
              marginBottom: 12,
            },
            [imgNode],
          );
        }
      }

      return div(
        {
          flexDirection: "row",
          flexWrap: "wrap",
          fontSize: 16,
          color: C.text,
          lineHeight: 1.7,
          marginBottom: 16,
        },
        renderInlineTokens(tok.tokens, basePath),
      );
    }

    case "code": {
      const tok = token as Tokens.Code;
      const lines = tok.text.split("\n");

      // Language label
      const header: SatoriNode[] = [];
      if (tok.lang) {
        header.push(div(
          {
            fontSize: 12,
            color: C.codeBlockLangText,
            padding: "6px 16px",
            borderBottom: `1px solid ${C.codeBlockLangBorder}`,
          },
          [tok.lang],
        ));
      }

      return div(
        {
          flexDirection: "column",
          backgroundColor: C.codeBlockBg,
          borderRadius: 10,
          marginBottom: 16,
          marginTop: 4,
          overflow: "hidden",
        },
        [
          ...header,
          div(
            {
              flexDirection: "column",
              padding: "14px 18px",
              fontFamily: "Geist Mono",
              fontSize: 13.5,
              color: C.codeBlockText,
              lineHeight: 1.6,
            },
            lines.map(line =>
              div({ flexDirection: "row" }, [line || " "])
            ),
          ),
        ],
      );
    }

    case "blockquote": {
      const tok = token as Tokens.Blockquote;
      const children = tok.tokens
        .map(t => renderBlockToken(t, basePath))
        .filter((n): n is SatoriNode => n !== null);

      return div(
        {
          flexDirection: "column",
          borderLeft: `4px solid ${C.quoteBorder}`,
          backgroundColor: C.quoteBg,
          padding: "12px 20px",
          marginBottom: 16,
          borderRadius: "0 8px 8px 0",
        },
        children.map(child => {
          // Override text color for blockquote children
          if (child.props.style) {
            child.props.style.color = C.quoteText;
            child.props.style.marginBottom = 4;
          }
          return child;
        }),
      );
    }

    case "list": {
      const tok = token as Tokens.List;
      return div(
        {
          flexDirection: "column",
          marginBottom: 16,
          paddingLeft: 8,
        },
        tok.items.map((item, i) => renderListItem(item, tok.ordered, tok.start ?? 1, i, basePath)),
      );
    }

    case "table": {
      const tok = token as Tokens.Table;
      return renderTable(tok, basePath);
    }

    case "hr":
      return div(
        {
          height: 2,
          backgroundColor: C.hrColor,
          marginTop: 28,
          marginBottom: 28,
          borderRadius: 1,
        },
        [],
      );

    case "space":
      return div({ height: 8 }, []);

    case "text": {
      // Block-level text (e.g. inside tight list items)
      const tok = token as Tokens.Text;
      if (tok.tokens) {
        return div(
          {
            flexDirection: "row",
            flexWrap: "wrap",
            fontSize: 16,
            color: C.text,
            lineHeight: 1.7,
          },
          renderInlineTokens(tok.tokens, basePath),
        );
      }
      return div(
        { fontSize: 16, color: C.text, lineHeight: 1.7 },
        [tok.text],
      );
    }

    case "html": {
      // Strip HTML tags, show text content
      const tok = token as Tokens.HTML;
      const text = tok.text.replace(/<[^>]*>/g, "").trim();
      if (!text) return null;
      return div(
        {
          fontSize: 16,
          color: C.textDim,
          marginBottom: 16,
        },
        [text],
      );
    }

    default:
      return null;
  }
}

function renderListItem(
  item: Tokens.ListItem,
  ordered: boolean,
  start: number,
  index: number,
  basePath: string,
): SatoriNode {
  const bullet = item.task
    ? (item.checked ? "[x] " : "[ ] ")
    : ordered
      ? `${start + index}. `
      : "\u2022 ";

  const bulletColor = item.task
    ? (item.checked ? C.checkDone : C.checkTodo)
    : C.textDim;

  const children = item.tokens
    .map(t => renderBlockToken(t, basePath))
    .filter((n): n is SatoriNode => n !== null);

  // Remove bottom margin from paragraphs inside list items
  for (const child of children) {
    if (child.props.style?.marginBottom) {
      child.props.style.marginBottom = 2;
    }
  }

  return div(
    {
      flexDirection: "row",
      marginBottom: 4,
      fontSize: 16,
      lineHeight: 1.7,
    },
    [
      div(
        {
          minWidth: ordered ? 28 : 20,
          color: bulletColor,
          fontWeight: 700,
          fontSize: 16,
          marginTop: 2,
        },
        [bullet],
      ),
      div(
        {
          flexDirection: "column",
          flex: 1,
          color: C.text,
        },
        children,
      ),
    ],
  );
}

function renderTable(token: Tokens.Table, basePath: string): SatoriNode {
  const headerRow = div(
    {
      flexDirection: "row",
      backgroundColor: C.tableHeaderBg,
      fontWeight: 600,
      fontSize: 13,
      color: C.tableHeaderText,
      letterSpacing: 0.3,
    },
    token.header.map((cell, i) =>
      div(
        {
          flex: 1,
          padding: "10px 16px",
          borderBottom: `2px solid ${C.tableBorder}`,
          borderRight: i < token.header.length - 1 ? `1px solid ${C.tableBorder}` : "none",
          textAlign: (token.align[i] as string) || "left",
        },
        renderInlineTokens(cell.tokens, basePath),
      )
    ),
  );

  const bodyRows = token.rows.map((row, rowIdx) =>
    div(
      {
        flexDirection: "row",
        fontSize: 14,
        backgroundColor: rowIdx % 2 === 0 ? C.tableRowBg : C.tableAltRow,
      },
      row.map((cell, i) =>
        div(
          {
            flex: 1,
            padding: "8px 14px",
            borderBottom: `1px solid ${C.tableBorder}`,
            borderRight: i < row.length - 1 ? `1px solid ${C.tableBorder}` : "none",
            textAlign: (token.align[i] as string) || "left",
            color: C.text,
          },
          renderInlineTokens(cell.tokens, basePath),
        )
      ),
    )
  );

  return div(
    {
      flexDirection: "column",
      border: `1px solid ${C.tableBorder}`,
      borderRadius: 8,
      overflow: "hidden",
      marginBottom: 16,
    },
    [headerRow, ...bodyRows],
  );
}

// ── Public API ─────────────────────────────────────────────────────

export function parseMd(source: string): Token[] {
  return new Lexer().lex(source);
}

function tokensToSatoriTree(
  tokens: Token[],
  basePath: string,
  width: number,
  padding: { top: number; bottom: number },
): SatoriNode {
  const children = tokens
    .map(t => renderBlockToken(t, basePath))
    .filter((n): n is SatoriNode => n !== null);

  return div(
    {
      flexDirection: "column",
      padding: `${padding.top}px 48px ${padding.bottom}px 48px`,
      backgroundColor: C.bg,
      fontFamily: "Geist",
      width: "100%",
    },
    children,
  );
}

// ── Height estimation ──────────────────────────────────────────────

function estimateTokenHeight(t: Token): number {
  switch (t.type) {
    case "heading": {
      const tok = t as Tokens.Heading;
      const sizes: Record<number, number> = { 1: 100, 2: 85, 3: 75, 4: 60, 5: 50, 6: 45 };
      return sizes[tok.depth] ?? 60;
    }
    case "paragraph": {
      const tok = t as Tokens.Paragraph;
      const chars = tok.raw.length;
      const lines = Math.max(1, Math.ceil(chars / 50));
      let h = lines * 30 + 20;
      for (const sub of tok.tokens) {
        if (sub.type === "image") h += 350;
      }
      return h;
    }
    case "text": {
      const tok = t as Tokens.Text;
      const lines = Math.max(1, Math.ceil(tok.raw.length / 50));
      return lines * 30 + 10;
    }
    case "code": {
      const tok = t as Tokens.Code;
      return tok.text.split("\n").length * 24 + 70;
    }
    case "blockquote": {
      const tok = t as Tokens.Blockquote;
      return tok.tokens.reduce((h, st) => h + estimateTokenHeight(st), 40);
    }
    case "list": {
      const tok = t as Tokens.List;
      let h = 20;
      for (const item of tok.items) {
        const lines = Math.max(1, Math.ceil(item.raw.length / 50));
        h += lines * 30 + 10;
      }
      return h;
    }
    case "table": {
      const tok = t as Tokens.Table;
      return (tok.rows.length + 1) * 45 + 24;
    }
    case "hr": return 60;
    case "space": return 12;
    default: return 40;
  }
}

// ── Chunked Document ───────────────────────────────────────────────

export interface ChunkDef {
  tokens: Token[];
  estimatedHeight: number;
  isFirst: boolean;
  isLast: boolean;
}

export interface RenderedChunk {
  png: Buffer;
  width: number;
  height: number;
}

export interface ChunkedDocument {
  chunks: ChunkDef[];
  rendered: (RenderedChunk | null)[];
  offsets: number[];
  totalHeight: number;
  width: number;
  basePath: string;
}

const CHUNK_HEIGHT_TARGET = 500;
const CHUNK_HEIGHT_MAX = 1200;
// Satori's layout cost grows super-linearly with node count. A 200-line code
// block becomes 200 row divs in one render — that hangs for tens of seconds.
// Splitting into smaller code tokens keeps each Satori call bounded.
const MAX_CODE_LINES_PER_TOKEN = 25;

function splitOversizedCodeTokens(tokens: Token[]): Token[] {
  let out: Token[] | null = null;
  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx]!;
    if (t.type !== "code") { out?.push(t); continue; }
    const tok = t as Tokens.Code;
    const lines = tok.text.split("\n");
    if (lines.length <= MAX_CODE_LINES_PER_TOKEN) { out?.push(t); continue; }
    if (!out) out = tokens.slice(0, idx);
    for (let i = 0; i < lines.length; i += MAX_CODE_LINES_PER_TOKEN) {
      const slice = lines.slice(i, i + MAX_CODE_LINES_PER_TOKEN).join("\n");
      out.push({
        ...tok,
        raw: slice,
        text: slice,
        // Only the first part keeps the language label so the visual stack
        // reads as one block, not N labelled boxes.
        lang: i === 0 ? tok.lang : "",
      });
    }
  }
  return out ?? tokens;
}

export function splitTokensIntoChunks(tokens: Token[]): Token[][] {
  tokens = splitOversizedCodeTokens(tokens);
  const groups: Token[][] = [];
  let current: Token[] = [];
  let currentH = 0;

  for (const t of tokens) {
    const h = estimateTokenHeight(t);

    // H1/H2 always start a new chunk
    if (t.type === "heading" && (t as Tokens.Heading).depth <= 2 && current.length > 0) {
      groups.push(current);
      current = [t];
      currentH = h;
      continue;
    }

    // HR is a natural break point
    if (t.type === "hr" && current.length > 0 && currentH >= CHUNK_HEIGHT_TARGET * 0.5) {
      current.push(t);
      groups.push(current);
      current = [];
      currentH = 0;
      continue;
    }

    current.push(t);
    currentH += h;

    // Split if accumulated height exceeds target (but never mid-element)
    if (currentH >= CHUNK_HEIGHT_TARGET) {
      groups.push(current);
      current = [];
      currentH = 0;
    }
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

export function createChunkedDocument(
  source: string,
  basePath: string,
  width: number,
): ChunkedDocument {
  const tokens = parseMd(source);
  const groups = splitTokensIntoChunks(tokens);

  const chunks: ChunkDef[] = groups.map((tokens, i) => ({
    tokens,
    estimatedHeight: tokens.reduce((h, t) => h + estimateTokenHeight(t), 0) + 40,
    isFirst: i === 0,
    isLast: i === groups.length - 1,
  }));

  const offsets: number[] = [];
  let y = 0;
  for (const chunk of chunks) {
    offsets.push(y);
    y += chunk.estimatedHeight;
  }

  return {
    chunks,
    rendered: new Array(chunks.length).fill(null),
    offsets,
    totalHeight: y,
    width,
    basePath,
  };
}

function recomputeOffsets(doc: ChunkedDocument): void {
  let y = 0;
  for (let i = 0; i < doc.chunks.length; i++) {
    doc.offsets[i] = y;
    y += doc.rendered[i]?.height ?? doc.chunks[i]!.estimatedHeight;
  }
  doc.totalHeight = y;
}

function getChunkHeight(doc: ChunkedDocument, i: number): number {
  return doc.rendered[i]?.height ?? doc.chunks[i]!.estimatedHeight;
}

/**
 * Find content bottom by scanning rows for non-background pixels.
 * Checks every 8th pixel per row (dense enough to catch small text like "MIT").
 */
function findContentBottom(width: number, height: number, data: Buffer): number {
  const step = Math.max(1, Math.floor(width / 100)); // ~100 samples per row

  if (isTransparent) {
    for (let y = height - 1; y >= 0; y--) {
      for (let x = 0; x < width; x += step) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3]! > 10) return Math.min(y + 30, height);
      }
    }
    return 100;
  }

  const { r: bgR, g: bgG, b: bgB } = C.bgRgb;
  const tolerance = 6;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const dr = Math.abs(data[offset]! - bgR);
      const dg = Math.abs(data[offset + 1]! - bgG);
      const db = Math.abs(data[offset + 2]! - bgB);
      if (dr > tolerance || dg > tolerance || db > tolerance) {
        return Math.min(y + 30, height); // 30px padding below last content
      }
    }
  }
  return 100;
}

export async function renderChunk(doc: ChunkedDocument, index: number): Promise<void> {
  if (doc.rendered[index]) return;

  const chunk = doc.chunks[index]!;
  const fonts = loadFonts();

  const tree = tokensToSatoriTree(chunk.tokens, doc.basePath, doc.width, {
    top: chunk.isFirst ? 40 : 8,
    bottom: chunk.isLast ? 40 : 8,
  });

  const maxHeight = Math.max(300, chunk.estimatedHeight * 3);

  const svg = await satori(tree as any, {
    width: doc.width,
    height: maxHeight,
    fonts: fonts as any,
  });

  let pipeline = sharp(Buffer.from(svg));
  if (!isTransparent) {
    pipeline = pipeline.flatten({ background: C.bgRgb });
  }
  const fullPng = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const actualH = findContentBottom(
    fullPng.info.width,
    fullPng.info.height,
    fullPng.data as unknown as Buffer,
  );

  // Trim to actual content
  const trimmed = await sharp(fullPng.data, {
    raw: { width: fullPng.info.width, height: fullPng.info.height, channels: 4 },
  })
    .extract({ left: 0, top: 0, width: doc.width, height: actualH })
    .png()
    .toBuffer();

  doc.rendered[index] = { png: trimmed, width: doc.width, height: actualH };
  recomputeOffsets(doc);
}

/**
 * Get indices of chunks visible in the viewport range [scrollY, scrollY + vpH].
 */
export function getVisibleChunkIndices(
  doc: ChunkedDocument,
  scrollY: number,
  vpH: number,
): number[] {
  const visible: number[] = [];
  const bottom = scrollY + vpH;
  for (let i = 0; i < doc.chunks.length; i++) {
    const chunkTop = doc.offsets[i]!;
    const chunkBottom = chunkTop + getChunkHeight(doc, i);
    if (chunkBottom > scrollY && chunkTop < bottom) {
      visible.push(i);
    }
    if (chunkTop >= bottom) break;
  }
  return visible;
}

/**
 * Composite visible chunks into a viewport-sized PNG.
 */
export async function compositeViewport(
  doc: ChunkedDocument,
  scrollY: number,
  vpH: number,
  zoomLevel: number,
): Promise<Buffer> {
  const visible = getVisibleChunkIndices(doc, scrollY, vpH);

  // Ensure all visible chunks are rendered
  for (const i of visible) {
    await renderChunk(doc, i);
  }

  const composites: { input: Buffer; top: number; left: number }[] = [];

  for (const i of visible) {
    const chunk = doc.rendered[i]!;
    const chunkTop = doc.offsets[i]!;
    const relTop = chunkTop - scrollY; // position relative to viewport

    if (zoomLevel !== 1.0) {
      const zW = Math.round(chunk.width * zoomLevel);
      const zH = Math.round(chunk.height * zoomLevel);
      const zoomed = await sharp(chunk.png).resize(zW, zH, { kernel: "lanczos3" }).png().toBuffer();
      const zRelTop = Math.round(relTop * zoomLevel);

      // Clip to viewport bounds
      const zVpH = Math.round(vpH * zoomLevel);
      if (zRelTop >= 0 && zRelTop + zH <= zVpH) {
        composites.push({ input: zoomed, top: zRelTop, left: 0 });
      } else {
        // Partial — extract visible portion
        const cropTop = Math.max(0, -zRelTop);
        const drawTop = Math.max(0, zRelTop);
        const cropH = Math.min(zH - cropTop, zVpH - drawTop);
        if (cropH > 0) {
          const cropped = await sharp(zoomed)
            .extract({ left: 0, top: cropTop, width: zW, height: cropH })
            .png().toBuffer();
          composites.push({ input: cropped, top: drawTop, left: 0 });
        }
      }
    } else {
      if (relTop >= 0 && relTop + chunk.height <= vpH) {
        // Fully visible
        composites.push({ input: chunk.png, top: relTop, left: 0 });
      } else {
        // Partially visible — extract the visible portion
        const cropTop = Math.max(0, -relTop);
        const drawTop = Math.max(0, relTop);
        const cropH = Math.min(chunk.height - cropTop, vpH - drawTop);
        if (cropH > 0) {
          const cropped = await sharp(chunk.png)
            .extract({ left: 0, top: cropTop, width: chunk.width, height: cropH })
            .png().toBuffer();
          composites.push({ input: cropped, top: drawTop, left: 0 });
        }
      }
    }
  }

  const canvasW = zoomLevel !== 1.0 ? Math.round(doc.width * zoomLevel) : doc.width;
  const canvasH = zoomLevel !== 1.0 ? Math.round(vpH * zoomLevel) : vpH;

  let canvas = sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: isTransparent
        ? { r: 0, g: 0, b: 0, alpha: 0 }
        : { ...C.bgRgb, alpha: 1 },
    },
  });

  if (composites.length > 0) {
    canvas = canvas.composite(composites);
  }

  return canvas.png().toBuffer();
}

