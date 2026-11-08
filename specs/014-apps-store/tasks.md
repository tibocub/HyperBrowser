# Tasks: 014 — the Apps store

## Phase 1: Store data
- [x] T001 `sites/apps/site.json` with type `app` (decide-only), `description` in every official app's site.json
- [x] T002 `scripts/apps.js`: Apps in APPS, `list` flag, entries put/edited after publishing (test/apps.test.js)
- [x] T003 test: a non-owner's `put('app')` is NOT_ALLOWED

## Phase 2: Shell
- [x] T004 `hyper.apps` in shell/site-preload.cjs; `apps()` in shell/main.js (click, dialog, install, open)
- [x] T005 `install`/`installed` from shell/frame.js
- [x] T006 sandbox self-test: no click → false; click + no → NOT_ALLOWED; click + yes → installed; control run fails

## Phase 3: Page, preset, docs
- [x] T007 `sites/apps/index.html`, `app.js`: the list, Install/Open, errors shown
- [x] T008 `shell/preset.json`: `preset:apps`
- [x] T009 docs/site-api.md, docs/shell.md, sites/home/start.hmd, docs/engine.md
