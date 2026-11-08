# Tasks: 011 — packaging and P2P updates

- [x] T001 research: pear-runtime, pear-runtime-updater, hello-pear-electron, Pear docs → `research.md`
- [x] T002 FR-001 `scripts/build.js` (`npm run build`): electron-builder, siblings copied in, prebuilds pruned
- [x] T003 FR-003 `scripts/release.js` (`npm run release`): the folder `pear stage` takes
- [x] T004 FR-004 `shell/updater.js`; FR-006 the log; started from `shell/main.js` (installed builds only)
- [x] T005 FR-005 the menu item and restart (`shell/frame.js`, `shell/ui/*`), the version in About
- [x] T006 [test] FR-007 `scripts/update-check.js` (`npm run test:update`): 1.0.0 → 1.0.1 while running, swapped at the quit, data kept: PASS on Windows
- [x] T007 FR-008 docs: `docs/packaging.md`, `docs/shell.md`, `sites/home/start.hmd`, README
- [ ] T008 Tibo: `pear touch`, the `"upgrade"` line, the first release (docs/packaging.md), on both PCs
- [ ] T009 `npm run test:update` on Linux; an AppImage built and run on the laptop
- [ ] T010 later: the tray app seeding releases (a setting); MSIX when there is a certificate; macOS
- [x] T011 Windows switched from the portable `.exe` to the app folder after the check (plan D2): EBUSY, the
  launcher killing the rename step, and 34–43 s starts
