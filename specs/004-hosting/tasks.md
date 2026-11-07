# Tasks: 004 — installing decides hosting

Plan in one line: the engine counts tabs per site, leaves a site with no tab after a grace period unless it is
installed or owned, and leaves those sites at start; the shell closes what it opens. No new dependency.

- [x] T001 check: does SwarmFS eviction work while a space is joined? Yes (`_evict` deletes files only).
- [x] T002 [test] `test/hosting.test.js`: installed site served with no tab and after a restart; a visited site
  not served after its grace period nor after a restart; a left site opened again and installed (Node, Bare)
- [x] T003 `engine/index.js`: tab count, `grace`, leave after the grace period, the sweep at `init`
- [x] T004 `shell/main.js`: `site.close` when a site's view goes; `shell/frame.js`: the install action closes
  what it opened
- [x] T005 hypergraph `claude/rejoin-public-after-leave`: rejoin after `leaveSpace` (own logs' headers kept,
  sub-spaces joined again with their top); tests, CHANGELOG, `docs/next/api.md`
- [x] T006 SwarmFS `claude/leave-forgets-site`: `leave()` forgets the site's keeping pass; test, api.md
- [x] T007 docs: `docs/engine.md`, `docs/shell.md`, the protocol contract, README, the requests files
- [x] T008 the suites one after another; commit
