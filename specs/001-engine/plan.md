# Implementation Plan: 001 — the engine and serving sites

**Branch**: `001-engine` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-engine/spec.md`

## Summary

A Bare engine with one entry, `start(ipc)`, speaking our framed JSON protocol v1 (the spike's, plus
heartbeat, bytes and events). It opens SwarmFS (which opens the one hypergraph instance: one identity, one
swarm) and serves sites: `site.publish` (a folder → a public SwarmFS site), `site.open` (by key or link),
`site.read` (a file by path), and the site API (`site.call`, `site.live`, `site.on`) through
`hg.scope(key, { identity: 'main' })`, gated by the site's `site.json` and the person's remembered answer.
A command line (`engine/cli.js`, Node or Bare) runs the same engine in-process for `publish` and `open`.
The shell (Electron main via `pear-runtime`) runs the engine as a Bare worker, sends heartbeats, and shows
each site in a sandboxed view (the spike's recipe), behind `shell/views.js`'s one interface.

## Technical Context

**Language/Version**: JavaScript (ES modules), Node ≥ 22 (tests, CLI), Bare ≥ 1.27 (engine worker, tests),
Electron 42 (shell).

**Primary Dependencies**: `hypergraph` (`file:../hypergraph`, `hypergraph/next` + `hypergraph/testing`),
`swarmfs` (`file:../SwarmFS`), `pear-runtime` (shell), `framed-stream`, `streamx`, `b4a`, `bare-*` through
the `imports` map; dev: `brittle`, `bare`, `electron`.

**Storage**: the engine folder (SwarmFS + hypergraph); app storage inside it (SwarmFS); answers in the
person's settings.

**Testing**: `brittle` files run as plain scripts on Node and Bare (`scripts/test-runner.js`, SwarmFS's);
local DHT from `hypergraph/testing`; the sandbox self-test under Electron (`npm run selftest`, and its
control run).

**Target Platform**: Windows 10+ and Linux x64 desktop (Linux: Tibo); macOS untested.

**Project Type**: desktop app (engine + shell) with a command line.

**Performance Goals**: SC-001 (a site from its key in ≤ 15 s on a local test network).

**Constraints**: engine imports no Node built-in directly, no `Buffer`, no `process`, no Electron/Pear;
low machine load (test files one after another).

**Scale/Scope**: milestone 1: a handful of sites open, two official ones.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Sites are strangers | One view per site with its own session, `hyper://` served per key, request filter, key from the sender, no preload for static sites; engine refuses API calls for static sites; self-test + control run | pass |
| II. Test-first | engine/protocol/site-API tests written before the code, through `start(ipc)` and messages; two-engine test; selftest | pass |
| III. Node and Bare | engine code only via the `imports` map; tests on both; protocol file shared; views behind one interface | pass |
| IV. Compose | SwarmFS for sites and files, `hg.scope` for the API; gaps filed in `specs/requests-to-*.md` (site types) | pass |
| V. Smallest | no tray, no UI, no HyperMD rendering, no packaging; JSON frames kept | pass |

Post-design re-check (after contracts): unchanged, pass.

## Project Structure

### Documentation (this feature)

```text
specs/001-engine/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── protocol.md      # engine messages (v1)
│   ├── site-api.md      # window.hyper in a dynamic site's page
│   └── cli.md           # publish, open
└── tasks.md
```

### Source Code (repository root)

```text
engine/
├── index.js        # start(ipc): the engine
├── protocol.js     # framing, versions, requests/replies/events, bytes on the wire, pair()
├── manifest.js     # site.json: parse and check
├── worker.js       # Bare entry for pear-runtime: start(Bare.IPC), exit when closed
└── cli.js          # windowless: publish <folder>, open <key>
shell/
├── main.js         # Electron main: engine worker, heartbeat, hyper:// per site, the bridge, --selftest
├── views.js        # the one view interface: createSiteView(key, { dynamic }) → { view, close }
├── site-preload.cjs # window.hyper for dynamic sites (sandboxed preload)
└── selftest/       # the sandbox test sites (copied into temp folders and published at selftest)
test/
├── protocol.test.js
├── engine.test.js       # init, heartbeat, malformed input
├── sites.test.js        # publish, open, read, site.json errors
├── site-api.test.js     # consent, calls, live, events, static refused, incomplete answers
├── two-engines.test.js  # publish with the CLI in a child process, open by key here
└── helpers.js
scripts/test-runner.js
docs/
├── engine.md            # how to run, commands (Windows and Linux)
└── site-api.md          # for site authors
specs/requests-to-hypergraph.md, specs/requests-to-swarmfs.md
```

**Structure Decision**: the milestone-1 layout (`engine/`, the shell, later `sites/home`, `sites/forum`).
The spike's files are the starting point, rewritten as ES modules.

## Complexity Tracking

None.
