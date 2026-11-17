# Feature Specification: 022 — names in the address bar (HyperDNS)

**Feature Branch**: `022-names` · **Created**: 2026-11-17 · **Status**: Draft (grilled with Tibo, 2026-11-17) ·
**Needs**: hyperDNS spec 001 (HyperDNS on the new core, its resolve call)

## Requirements

- **FR-001** Typing `name@authority` (e.g. `blog@bobsDNS`, also `hyper://blog@bobsDNS`) in the address bar resolves
  it through HyperDNS in the engine and opens the site it points to. `parseAddress` (`shell/model.js`) accepts it;
  keys and `hg:` links work as today.
- **FR-002** Any authority, member or not; no authority built in. While resolving: a short "Looking up…" state;
  errors in plain words: no such authority, no such name, nobody online who has it (try later).
- **FR-003** The address bar keeps showing the name (not the key) for a site opened by name; the site's key stays
  reachable (e.g. its info).
- **FR-004** Engine: HyperDNS as a dependency (`file:../hyperDNS`), Bare-compatible; a shell-only engine call
  (`names.resolve`), not given to pages.
- **FR-005** Docs, a regression test (model parsing; engine resolve against a test authority), the sandbox or
  self-test check of the address bar, perf rerun (`npm run perf`) if the engine's start changes.

## Not covered

Creating authorities or publishing names from HyperBrowser (later). A default authority.
