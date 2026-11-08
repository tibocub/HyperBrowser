# Feature Specification: 008 — UI polish

**Feature Branch**: `claude/008-ui-polish-288f0f`

**Created**: 2026-11-08

**Status**: Built (for Tibo to try; the button choice is his)

**Input**: Tibo's feedback after trying the official site and the forum (lead session, 2026-11-08): five small
changes.

## Requirements

- **FR-001 The theme reaches sites.** The look's theme (system, light, dark) sets Electron's
  `nativeTheme.themeSource` (`shell/frame.js`, at start and on change), so every site's
  `prefers-color-scheme` follows it, live, without a reload. Before, sites followed Windows only.
- **FR-002 A default theme for unstyled pages.** `shell/ui/theme.css`, sites/home's look (fonts, colours,
  light/dark, links, buttons, fields, the dither, the striped title bar), injected into every site page by
  `shell/views.js` with `insertCSS(css, { cssOrigin: 'user' })` on `dom-ready`; fonts inlined as `data:` URLs.
  - Why a *user* stylesheet: author CSS always beats it, at any specificity, so a site's own look is never
    broken by ours; it needs no file in the site and no API (static sites get it too).
  - Why only pages with **no** stylesheet (`:root:not(:has(style, link[rel~=stylesheet]))`): user CSS loses
    property by property, so a page that sets a text colour but no background would get our dark background
    under its dark text. A page with any `<style>` or stylesheet is left as its author made it.
  - A HyperMD site built without `style.css` looks like sites/home (`screenshot-theme-hypermd-*.png` next to
    `screenshot-home-start-*.png`: the same page). A plain HTML page becomes a window on the dither
    (`screenshot-theme-plain-*.png`).
- **FR-003 Textures never move and stay on whole pixels.** Every dither and stripe (shell desktop, toolbar
  and window title bars; sites/home; sites/forum; the default theme) is drawn in `--px`, one device pixel
  (`1px / 1.25` at 125 %, `1px / 1.5` at 150 %, `1px / 1.75`; 2 device px from 200 %), and the dithered
  backgrounds are `background-attachment: fixed`, anchored to the window's corner. Measured, not assumed:
  the old CSS gives gray (blurred) pixels at 125 % and moves with the page; the new one is a clean
  checkerboard at 100, 125, 150, 175, 200, 250 % and is the same image after scrolling.
- **FR-004 Square buttons.** The forum's rounded double-border `.btn` becomes **option A**: a 1 px border and
  the 2 px hard shadow of the windows and menus; pressed, it sinks into its shadow (moves 2 px, shadow gone,
  inverted). The shell's `.push` buttons already had that look and now sink too; the default theme's buttons
  are the same. Options in `buttons.html` (open it in a browser) and `screenshot-buttons-light.png`,
  `screenshot-buttons-dark.png`:
  - **A, hard shadow (chosen)**: the same shadow as every window, menu and code block: one look.
  - **B, thin shadow**: 1 px shadow, lighter; stands out less from the fields next to it.
  - **C, default-button frame**: System 1's default button made square (border, 1 px gap, 2 px frame). The
    closest to the old one, but louder, and in System 1 it means "the default action", which most forum
    buttons aren't.
  To switch: `sites/forum/style.css` `.btn` and `.btn:active` (the rows in `buttons.html` show the CSS).
- **FR-005 Icons Tibo can redraw.** The shell's glyphs are one PNG each in `shell/icons/` (8×8; the window
  buttons 5×5; 1-bit, black on white), made from the old path strings pixel for pixel. Main reads them with
  `nativeImage` (`readGlyphs`, `shell/frame.js`) and sends them to the frame (op `glyphs`) as SVG paths,
  so they keep `currentColor` (inverted on hover, the accent on the bookmark) and stay crisp; the frame's
  CSP is unchanged. Around the black pixels, white or transparent both work. How to redraw one: `docs/shell.md`.
- **FR-006 WebAssembly in sites.** The site CSP gets `'wasm-unsafe-eval'`
  (`default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:`). Wasm runs inside the page, in the
  same sandbox as its scripts; it gets nothing a script doesn't have.

## Tests

- `npm run test:sandbox`:
  - the self-test, in each of the three sites: a wasm module from the site instantiates
    (`instantiateStreaming`) and runs; bytes the page holds compile (`WebAssembly.compile`); another site's
    `add.wasm` is refused; all the old checks (no Node, files, other sites, web) still pass with the new CSP.
    Without `'wasm-unsafe-eval'` the first two fail (checked once by hand).
  - the shell: the theme setting is each site's `prefers-color-scheme` (dark, then light); a page with no
    stylesheet gets the default theme; a page with its own `<style>` keeps its look.
  - the frame check: every icon is drawn from `shell/icons/` (and `plus.png` decodes to its 5×5 cross).
  - new, `shell/selftest/pixels.cjs` at 100, 125, 150 %: each dithered background is whole device pixels
    and doesn't move when the page scrolls. The old sites/home CSS fails both at 125 % (checked once).

## Not done / limits

- Glyphs are 2 CSS px a pixel, as before: crisp at 100 % and 200 %, slightly uneven at 125 % and 150 %
  (Chromium rounds 2.5 or 3 device px a pixel). Textures are fixed for those; the 16 px icons are not.
- `--px` covers 125, 150, 175, 225, 250 %. Other ratios (page zoom, odd monitor scales) fall back to 1 CSS px
  dots: as before, may blur.
- Default theme: the accent colour setting doesn't reach it (it uses sites/home's blue); pages get it at
  `dom-ready`, so a very long page may paint once without it.
- The forum's buttons were checked in `buttons.html` (the forum's real stylesheet) and in the self-test's
  pages, not in a running forum with `npm start`.
