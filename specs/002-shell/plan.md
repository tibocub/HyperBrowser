# Implementation Plan: 002 — the shell's interface

**Branch**: `002-shell` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-shell/spec.md`

## Summary

The window becomes a frame HyperBrowser draws itself, in one trusted view (`shell/ui/`, a local page with
its own preload), on top of the site views. Electron main (`shell/frame.js`) holds the tabs: the desktop tab
(drawn by the frame) and one site view per open site (spec 001's `createSiteView`, unchanged), placed under
the frame's bars. When the current tab is the desktop, or a menu is open, the frame view covers the whole
window (transparent over a site, so a menu draws over the site); otherwise it covers the bars only. The frame
talks to main on its own IPC channel, accepted from the frame's view only. Pure logic (the address, the
desktop's icons and cells) lives in `shell/model.js`, tested on Node and Bare. The engine gains one method,
`site.state` (complete, peers), tested on Node and Bare. Desktop, bookmarks and settings: one JSON file in
the app's data folder.

## Technical Context

**Language/Version**: JavaScript (ES modules), Electron 42 (shell), Node ≥ 22 and Bare ≥ 1.27 (tests, engine).

**Primary Dependencies**: spec 001's; no new ones. Cozette Vector 1.30.0 (MIT) as woff2 in `shell/ui/fonts/`.

**Storage**: `<userData>/shell.json`: `{ desktop: { icons }, settings: { theme, accent } }`.

**Testing**: `brittle` (`test/model.test.js`, `test/sites.test.js` for `site.state`) on Node and Bare; the
sandbox self-test and its control run unchanged (`npm run test:sandbox`).

**Target Platform**: Windows 10+ (Tibo tests), Linux later.

**Project Type**: desktop app.

**Performance Goals**: SC-001 (window under 5 s), SC-003 (tab switch at once: views stay, only bounds change).

**Constraints**: the frame never inside a site's view; site views never above the bars; no new dependency.

**Scale/Scope**: tens of tabs, tens of desktop icons.

## Constitution Check

- **I. Sites are strangers**: site views unchanged (spec 001's guards); the frame's IPC channel checks the
  sender is the frame's view; site views are only ever placed under the bars, and the frame view is re-raised
  above them whenever a view is added. The self-test and control run still run. PASS.
- **II. Test-first**: `site.state` and `shell/model.js` written test-first; the frame's Electron wiring is
  checked by hand (Tibo) and by the self-test still passing. PASS.
- **III. Node and Bare**: engine change Bare-safe; `shell/model.js` has no imports, tested on both. PASS.
- **IV. Compose**: install's "kept whole" and per-site bytes held are SwarmFS's: requests F4, F5, not built
  here. PASS.
- **V. Smallest**: one frame page, no framework, no new dependency. PASS.

Post-design: unchanged, PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-shell/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/frame.md   # the frame's IPC messages and the engine's site.state
└── tasks.md
```

### Source Code (repository root)

```text
engine/index.js          # + site.state
shell/
├── main.js              # engine, site bridge, self-test (spec 001) + starts the frame
├── frame.js             # the window, tabs, layout, the frame's IPC (Electron main)
├── model.js             # pure: address parsing, short key, desktop icons and cells
├── preset.json          # the official site and forum (keys once published)
├── frame-preload.cjs    # window.frame for the frame page only
├── views.js             # unchanged
└── ui/                  # the frame page: index.html, ui.css, ui.js, icons.js, fonts/
test/model.test.js       # Node and Bare
```

**Structure Decision**: the existing layout; the frame is a sibling of `views.js` behind the same main process.

## Complexity Tracking

None.
