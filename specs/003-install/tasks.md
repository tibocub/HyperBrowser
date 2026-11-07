# Tasks: 003 — install and what you hold

Plan in one line: two engine messages over SwarmFS's `site.keep`, `site.kept`, `site.held`; the shell's desktop
kind calls them; the toolbar shows the bytes. No new dependency, no new file in `shell/`.

- [x] T001 [test] `test/sites.test.js`: `site.keep` / `site.held` before opening → `NOT_FOUND`; `keep: 'yes'` →
  `INVALID_PARAMS`; a visited site not kept; keep(true) → kept, every page counted in `bytes`; keep(false) →
  not kept (Node and Bare)
- [x] T002 `site.keep`, `site.held` in `engine/index.js`; `specs/001-engine/contracts/protocol.md`
- [x] T003 `shell/frame.js`: `keepSite` on kind change and removal, `kept` on the icon, retry at launch; the
  "opened at launch" stand-in removed; `site.held` every 10 s (and after a keep) for open tabs
- [x] T004 `shell/ui/ui.js`: bytes held and "kept" in the toolbar state
- [x] T005 `shell/main.js`: the engine's stream closing without `closing` exits the shell
- [x] T006 docs (`docs/shell.md`, `specs/002-shell` FR-008/FR-006 notes), `specs/requests-to-swarmfs.md` F4, F5
  done; the three suites one after another; commit
