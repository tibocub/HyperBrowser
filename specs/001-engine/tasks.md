# Tasks: 001 — the engine and serving sites

**Input**: `specs/001-engine/` (plan, research, data-model, contracts). Tests first (constitution II): each
test task is written and seen failing before its implementation task.

## Phase 1: Setup

- [x] T001 `package.json` (ES modules, `imports` map, deps `file:../hypergraph` `file:../SwarmFS`, scripts),
  `npm i`; `scripts/test-runner.js` (from SwarmFS); `test/helpers.js` (engine over `pair()`, on the test DHT)
- [x] T002 `specs/requests-to-hypergraph.md`, `specs/requests-to-swarmfs.md` (site types, research R11)

## Phase 2: Foundation (protocol, engine core) — blocks every story

- [x] T003 [test] `test/protocol.test.js`: request/reply, error codes, events, `BAD_VERSION`, bad JSON dropped,
  unknown id dropped, bytes round-trip as `$bytes`, closed stream rejects waiting requests
- [x] T004 `engine/protocol.js`: `connect(stream, { handle, onEvent })`, `toWire`/`fromWire`, `pair()`
- [x] T005 [test] `test/engine.test.js`: `NOT_READY` before init, `init` → identity, `ALREADY`, `UNKNOWN_METHOD`,
  malformed messages don't crash, heartbeat closes after 3 silent periods, pings keep it alive, `close`
- [x] T006 `engine/index.js`: `start(ipc)`, init (SwarmFS.open + sync), ping, heartbeat, close, `closing` event;
  `engine/worker.js`

## Phase 3: US1 + US2 — publish and open by key (P1)

- [x] T007 [test] `test/sites.test.js`: manifest checks (`NO_MANIFEST`, `INVALID_MANIFEST`, entry missing);
  publish → key; publish again → same key; open by key on a second engine (same process, test DHT) → manifest,
  entry bytes equal; `site.read` paths (`style.css`, missing → `NOT_FOUND`, `../x`, `%2e%2e/x`, `a\\b` →
  `NOT_FOUND`); a key that isn't a site; an edit in the folder reaches the visitor
- [x] T008 `engine/manifest.js`; `site.publish`, `site.open`, `site.read` in `engine/index.js`
- [x] T009 [test] `test/two-engines.test.js`: `cli.js publish` in a child process (Node or Bare, as the runner),
  key read from its output, opened here by key alone; `cli.js open` in a child process prints the title
- [x] T010 `engine/cli.js` (`publish`, `open`, `--dir`, `--bootstrap`, `--once`, SIGINT)

## Phase 4: US4 — the site API (P2)

- [x] T011 [test] `test/site-api.test.js`: static site refused; `NEEDS_CONSENT` then consent → put/get/query
  (chain) work, answer remembered after reopening the engine; no → `NOT_ALLOWED`; live view fires on another
  engine's record; `site.on('change')`; `site.off` and `site.close` stop them; `sub` outside the site →
  `NOT_ALLOWED`; `addProtocol` → `UNKNOWN_METHOD`; visitor read before records arrive → `{ items, complete }`,
  never an error; an unknown type → `INVALID_TYPE` once complete; bytes fields cross as bytes
- [x] T012 `site.consent`, `site.call`, `site.live`, `site.on`, `site.off`, `site.close` in `engine/index.js`

## Phase 5: US3 + shell — sandboxed views (P1)

- [x] T013 `shell/views.js` (the view interface, the spike's guards + CSP, no preload for static sites),
  `shell/site-preload.cjs` (the `window.hyper` proxy: calls, query chains, live, on, subspace)
- [x] T014 `shell/main.js`: engine worker (pear-runtime), heartbeat, `hyper://` served from `site.read` with
  content types, the bridge (key from the sender, consent dialog), `--open <key>`, `--selftest`, `--no-guards`
- [x] T015 [test] `shell/selftest/`: the spike's checks + static site has no API + the API surface + a write
  and live read through the API; results collected by `executeJavaScript`; run `npm run selftest` (pass) and
  `--no-guards` (fail)

## Phase 6: US5 + polish

- [x] T016 heartbeat from the shell verified by a Bare-worker test: `test/worker.test.js` (Node only: runs
  `engine/worker.js` with pear-runtime, sends init with a heartbeat, stops pinging, the process exits)
- [x] T017 docs: `docs/engine.md` (commands, Windows + Linux), `docs/site-api.md` (site authors), README
- [x] T018 full runs: `npm test`, `npm run test:bare`, selftest + control run; tasks ticked; report
