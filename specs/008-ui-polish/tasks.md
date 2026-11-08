# Tasks: 008 — UI polish

- [x] T001 FR-001: `nativeTheme.themeSource` from the look's theme (`shell/frame.js`)
- [x] T002 FR-002: `shell/ui/theme.css` + Plex Mono in `shell/ui/fonts/`; injected as user CSS (`shell/views.js`)
- [x] T003 FR-003: `--px` and fixed dither in `shell/ui/ui.css`, `sites/home/style.css`, `sites/forum/style.css`,
  `shell/ui/theme.css`
- [x] T004 FR-004: options page `buttons.html`, screenshots; option A in the forum, the shell, the theme
- [x] T005 FR-005: `shell/icons/*.png`, `readGlyphs` + op `glyphs` (`shell/frame.js`), `shell/ui/ui.js`;
  `specs/002-shell/contracts/frame.md`
- [x] T006 FR-006: CSP `'wasm-unsafe-eval'`; `shell/selftest/site/add.wasm` + checks in `test.js`
- [x] T007 [test] self-test (theme, default theme, wasm), frame check (icons), `shell/selftest/pixels.cjs` in
  `test/sandbox.electron.js`
- [x] T008 docs: `docs/shell.md` (the look, icons and how to redraw them), `docs/site-api.md` (wasm, the
  look), `docs/engine.md`
- [ ] T009 Tibo: try it (`npm start`), pick the button (A, B or C)
