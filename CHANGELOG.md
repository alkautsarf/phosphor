# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [0.4.1] - 2026-04-17

### Fixed

- Bundle `pdfjs-dist` and `@napi-rs/canvas` (with matched platform binary) in the release tarball so brew/binary installs get the in-process PDF renderer added in 0.4.0 instead of silently falling back to `pdftocairo`

## [0.4.0] - 2026-04-17

### Added

- In-process PDF rasterization via `pdfjs-dist` + `@napi-rs/canvas` (5× faster cold render than `pdftocairo`); falls back to `pdftocairo` if pdfjs init fails
- LRU page cache with stable kitty image IDs — revisiting a page is effectively instant (sub-20ms placeholder repaint, no re-transmit)
- Background prefetch of N±2 pages around the current view
- Coalesced `showPage` loop — held arrow keys never spawn redundant renders, latest target always wins
- Bench harnesses at `bench/pdf-bench.ts` and `bench/md-bench.ts` for future regression checks

### Changed

- `pdftocairo` invocation now goes through `Bun.spawn` with stdout pipe (no temp files, async, doesn't block the JS event loop)
- PDF render DPI tightened from a 300 floor to a fitted-to-terminal range (cuts cold render ~35% on its own)

### Fixed

- Markdown viewer no longer hangs Satori on documents containing very long code blocks; oversized `code` tokens are split at 25 lines so each Satori call stays bounded

## [0.3.1] - 2026-04-14

### Fixed

- Include font files in release tarball for homebrew/binary distribution
- Add font resolution path for bundled package layout

## [0.3.0] - 2026-04-14

### Added

- GUI-quality markdown rendering via Satori + sharp pipeline
- Interactive scrolling viewer with vim navigation (j/k, gg/G, Space, 0-9)
- Zoom in/out (+/-) with instant sharp.resize scaling
- Chunked rendering architecture — 12 independent Satori renders instead of one monolithic pass
- Dark, light, and transparent theme support with polished color palettes
- Geist Sans + Geist Mono fonts (Vercel's OTF, optimized for Satori)
- Inline image rendering in markdown (local images resolved as data URIs)
- Rich element support: headings, code blocks with language labels, tables, blockquotes, lists, task checkboxes, horizontal rules
- `--dark`, `--light`, `--transparent` CLI flags for theme override
- `PHOSPHOR_THEME` environment variable for persistent theme preference
- Flicker-free viewport rendering (in-place placeholder overwrite, no screen clear)
- Auto-detection of `.md`, `.markdown`, `.mdown`, `.mkd`, `.mdx` extensions
- `--info` flag support for markdown files

## [0.2.0] - 2026-04-05

### Added

- Interactive PDF viewer with page navigation (h/l, j/k, arrows, 1-9 jump, q quit)
- PDF page rendering via pdftocairo at dynamic DPI to fill terminal
- Centered image and PDF rendering (horizontally and vertically)
- Terminal resize handling (SIGWINCH) in PDF viewer
- Minimum terminal size check with "too small" message
- `--page N` flag to open PDF at specific page

### Fixed

- HEIC/JPEG images now auto-rotate based on EXIF orientation
- Removed `-h` alias for `--height` to avoid conflict with `--help`

## [0.1.0] - 2026-04-05

### Added

- Kitty graphics protocol with virtual Unicode placement (works in tmux)
- DCS passthrough for tmux image transmission
- Automatic cell pixel size detection via CSI 16t query
- Terminal auto-detection (Ghostty, Kitty, WezTerm, iTerm2, and more)
- Image format support: PNG, JPEG, WebP, GIF, AVIF, TIFF, SVG, BMP
- HEIC support on macOS via sips fallback
- Sixel, iTerm2, and halfblock protocol encoders
- CLI with `-w`, `-h`, `-p`, `--info` flags
- stdin pipe support
- Library API: `display()`, `createRenderer()`, `detect()`
- Native resolution rendering (only downscale, never upscale)
- Random image IDs to prevent cross-instance collision
- `install.sh` for curl-based installation
- Homebrew formula support

[0.4.1]: https://github.com/alkautsarf/phosphor/releases/tag/v0.4.1
[0.4.0]: https://github.com/alkautsarf/phosphor/releases/tag/v0.4.0
[0.3.1]: https://github.com/alkautsarf/phosphor/releases/tag/v0.3.1
[0.3.0]: https://github.com/alkautsarf/phosphor/releases/tag/v0.3.0
[0.2.0]: https://github.com/alkautsarf/phosphor/releases/tag/v0.2.0
[0.1.0]: https://github.com/alkautsarf/phosphor/releases/tag/v0.1.0
