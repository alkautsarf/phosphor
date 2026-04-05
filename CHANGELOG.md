# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

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

[0.1.0]: https://github.com/alkautsarf/phosphor/releases/tag/v0.1.0
