# Implementation Plan: 020 — helper (v1, command line)

**Branch**: `020-helper` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

## Summary

A `helper` command in `engine/cli.js`: the same `start()` as the shell's worker, headless, with a config file read at
start and on change, circles joined from `join` lines, holding always on, the official apps (and `seed` keys) kept
whole and followed live. Plus an install script and a systemd unit for Ubuntu 24.04.

## Technical Context

JavaScript (ESM), Node ≥ 22 (the helper runs on Node; the engine stays Bare-compatible). Testing: brittle (`npm test`,
`npm run test:bare` for anything under `engine/`), `npm run perf`. Uses the engine's existing calls: `init`,
`circles.join`, `holding.set`, `holding.get`, `site.open`, `site.keep`, `contacts.setMe` (name) or whatever sets the
person's name.

## Constitution Check

- I. Sites are strangers: the helper opens no page and runs no site code; it only keeps data. ✅
- II. Test-first: config parsing and defaults (a pure module, unit-tested), the two success-criteria tests through
  `start(ipc)`. ✅
- III. Node and Bare: engine changes in `engine/` only, tested on both; the CLI's helper itself may be Node-only
  (`fs.watch`, `os.hostname`, `statfs`) if Bare lacks one: say so. ✅
- IV. Compose: hypergraph's circles and holding as they are; no hypergraph change expected (if one is needed, stop and
  tell the lead). ✅
- V. Smallest: no IPC to the running helper (the config file is the control), no status command, no Docker. ✅

## Research (worker, before code)

- **R1 Following apps live** (FR-006): what a non-owner engine does today with a preset app it has `site.keep`-ed: are
  all files fetched, and do new versions arrive while it runs (the shell's preset updates, spec 015)? Measure with two
  engines; change only what's missing.
- **R2 Name** (FR-005): which call sets the identity's name members see (`contacts.setMe({ name })`?), and whether a
  circle's members list shows it.
- **R3 Share default** (FR-003): free disk via `fs.statfs` on `dir` (as 018 R3), half of it capped at 100 GB, then
  `holding.set`'s own check.
- **R4 Remembered links** (FR-004): where to keep used `join` links (a file in `dir`), so a restart doesn't retry them.
- **R5 Config reload** (FR-002): `fs.watch` on the file (editors replace files: watch the folder, debounce).

## Project Structure

```text
engine/cli.js                 the helper command (or engine/helper.js it calls)
engine/helper-config.js       parse, defaults, merge (pure, tested)
scripts/helper-install.sh     Ubuntu 24.04 install/update
scripts/hyperbrowser-helper.service
test/helper.test.js           config; A/B/H message through H alone; H follows a new app version live
perf/helper.mjs               helper idle CPU and memory while holding and keeping the apps (perf-on-change)
docs/helper.md                install, config reference, updating, logs; README and docs/engine.md link to it
```

## Order

1. Tests first (config, the two success-criteria tests), failing.
2. Engine/CLI: the helper command, config, joins, holding, apps followed live (R1's fix if any).
3. Install script, service file, docs, perf.
4. Full suites on Node and Bare; the install script checked in a container or WSL Ubuntu 24.04 if available (say if
   not).

One worker, one commit per step.

## Risks

- R1 may show that a non-owner doesn't fetch every file or doesn't follow new versions live: the fix may touch SwarmFS
  (then stop and tell the lead).
- The helper takes one of each space's 5 copies; with 2 helpers in a 2-person circle, every copy may sit on servers.
  Fine for the test; noted in the docs.
