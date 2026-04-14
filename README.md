Render images, PDFs, and markdown in your terminal. Supports Kitty graphics protocol with Unicode virtual placement, Sixel, iTerm2, and halfblock fallback — with full tmux passthrough.

Built for terminals that support modern graphics protocols (Ghostty, Kitty, WezTerm, iTerm2) and works seamlessly inside tmux.

## Install

**Homebrew:**

```bash
brew tap alkautsarf/tap
brew install phosphor
```

**curl (macOS / Linux):**

```bash
curl -fsSL https://raw.githubusercontent.com/alkautsarf/phosphor/main/install.sh | sh
```

## Usage

```bash
# Display an image
phosphor image.png

# Short aliases
ph image.png
pho image.png

# Resize to specific width (in terminal cells)
phosphor image.jpg -w 60

# Force a specific protocol
phosphor image.png -p halfblock

# Show image info + detected protocol
phosphor image.png --info

# Read from stdin
cat screenshot.png | phosphor

# Open a PDF (interactive viewer)
phosphor document.pdf

# Open PDF at specific page
phosphor document.pdf --page 5

# View markdown with GUI-quality rendering
phosphor README.md

# Markdown with theme override
phosphor README.md --dark
phosphor README.md --transparent
```

### PDF Controls

```
→ / l / j / Space   Next page
← / h / k           Previous page
1-9                 Jump to 10%-90%
q                   Quit
```

### Markdown Controls

```
↓ / j           Scroll down
↑ / k           Scroll up
Space           Page down
gg              Go to top
G               Go to end
+ / =           Zoom in
- / _           Zoom out
0               Jump to top
1-9             Jump to 10%-90%
q               Quit
```

## Supported Formats

| Format | Support |
|--------|---------|
| Markdown | GUI-quality rendered viewer (`.md`, `.markdown`, `.mdx`) |
| PDF | Interactive viewer (requires poppler) |
| PNG | Native |
| JPEG | Native |
| WebP | Native |
| GIF | Native (first frame) |
| AVIF | Native |
| TIFF | Native |
| SVG | Native (rasterized) |
| BMP | Native |
| HEIC/HEIF | macOS only (via sips) |

## Protocols

phosphor auto-detects the best protocol for your terminal:

| Protocol | Terminals | Quality |
|----------|-----------|---------|
| **Kitty** (default) | Ghostty, Kitty, WezTerm, Rio | Pixel-perfect |
| **iTerm2** | iTerm2, WezTerm | Pixel-perfect |
| **Sixel** | foot, mlterm, VTE-based | Good |
| **Halfblock** | Any terminal | Blocky fallback |

### tmux Support

phosphor works inside tmux via:
- **Virtual Unicode placement** for image rendering (same technique as ratatui-image)
- **DCS passthrough** for transmitting image data to the outer terminal
- **Automatic cell size detection** via CSI 16t query

## Library Usage

```ts
import { display, createRenderer } from 'phosphor'

// Simple
await display('./photo.png')
await display(buffer, { width: 40, height: 20 })

// Advanced
const renderer = await createRenderer()
console.log(renderer.protocol) // 'kitty' | 'sixel' | 'iterm2' | 'halfblock'
console.log(renderer.tmux)     // true | false
await renderer.display('./photo.png', { width: 60 })
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PHOSPHOR_THEME` | Default markdown theme | `dark`, `light`, `transparent` |
| `PHOSPHOR_CELL_SIZE` | Override cell pixel size detection | `20x56` |

## Build from Source

```bash
git clone https://github.com/alkautsarf/phosphor.git
cd phosphor
bun install
bun run src/index.ts image.png

# Compile to standalone binary
bun run compile
```

## License

MIT
