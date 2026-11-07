# Tasks: 002 — the shell's interface

**Input**: `specs/002-shell/` (plan, research, data-model, contracts). Tests first where code runs on Node and
Bare (constitution II). Order: the first launchable version (Phase 2) comes before anything else, so Tibo can
try it.

## Phase 1: Setup

- [x] T001 Cozette woff2 (regular, bold) in `shell/ui/fonts/` with its MIT licence note; `shell/preset.json`
- [x] T002 `specs/requests-to-swarmfs.md`: F4 (keep a visited site whole, never evicted, seeded), F5 (bytes
  held per site)

## Phase 2: First launchable version — US1, US2, US3, US6 (P1)

- [x] T003 [test] `test/model.test.js`: `parseAddress` (key, `hg:` link, spaces trimmed, wrong length/letters
  refused), `shortKey`, desktop: `place` (first free cell), `move` (swap), `upsert` (preset gets its key,
  keeps its cell), `remove`
- [x] T004 `shell/model.js`
- [x] T005 [test] `test/sites.test.js`: `site.state` → `{ complete, peers }` on owner and visitor; not opened →
  `NOT_FOUND`; bad key → `INVALID_KEY`
- [x] T006 `site.state` in `engine/index.js`; `specs/001-engine/contracts/protocol.md` gains it
- [x] T007 `shell/frame.js` + `shell/frame-preload.cjs`: window, frame view, tabs, layout (bars / full /
  transparent cover), IPC `frame` (sender check), state push, state polling, `shell.json`
- [x] T008 `shell/ui/` (index.html, ui.css, ui.js, icons.js): top bar, menu, taskbar, toolbar, address
  (short ↔ full), state, desktop grid, loading/error panel, dark mode and accent
- [x] T009 `shell/main.js`: `npm start` with no flag opens the frame (`--open <key>` opens that site in a
  tab too); the self-test path unchanged
- [x] T010 Run `npm test`, `npm run test:bare`, `npm run test:sandbox` one after another; README launch
  command; `docs/engine.md` shell section; commit; hand to Tibo

## Phase 3: Desktop and menu — US4, US5 (P2)

Built with Phase 2 (one page); checked through the frame's messages, not yet by hand (drag, right-click).

- [x] T011 icon drag to cells, icon menu (open, install / bookmark, remove), ☆ toggle, icons from `site.json`
- [x] T012 HyperBrowser menu: identity, installed sites, open by key, theme, accent, about; Escape / outside
  click closes
- [x] T013 installed sites opened in the engine at launch (seeded while running, FR-008)
- [x] T014 tests, docs, commit; hand to Tibo

## Phase 4: Tibo's fixes after the first build (US7)

- [x] T017 the tab's × and the "+" as perfect pixel crosses (5×5 at 2 px, whole-pixel boxes); "+" right after
  the last tab
- [x] T018 no OS frame, no app menu: the top bar drags the window; our minimize, maximize/restore, close; keys
  kept (Ctrl+W, F5/Ctrl+R, Ctrl+T, Ctrl+L, devtools in dev); copy/paste checked
- [x] T019 [test] `npm run framecheck` in `npm run test:sandbox`: no app menu, no OS frame, the bar drags and its
  controls don't, the site view right under the bars, the frame covers the bars only, a site page has no
  `window.frame`

## Phase 5: Polish

- [x] T020 Ctrl+Tab / Ctrl+Shift+Tab while a site has the focus; narrow tabs (icon only) when there are many

Open, waiting on SwarmFS: FR-008's "kept whole on disk" (request F4) and FR-006's "what you hold" (request F5).


- [x] T015 the frame check (T019): a site's view starts under the bars (SC-004), a site's page has no door to
  the frame
- [x] T016 `docs/shell.md` (using the shell), README status; tasks ticked
