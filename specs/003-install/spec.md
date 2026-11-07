# Feature Specification: 003 — install and what you hold

**Feature Branch**: `003-install`

**Created**: 2026-11-07

**Status**: Built

**Input**: lead session, 2026-11-07: SwarmFS F4 and F5 are merged (SwarmFS `main` 43946bc, its spec 006):
wire them into HyperBrowser. Spec 002's FR-008 ("install keeps the site whole on disk and seeds it") and
FR-006 ("what this device holds") were waiting on them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install a site (Priority: P1)

On the desktop, Tibo right-clicks a site's icon and picks "Install (keep and seed)". The site is kept whole on
this device: every page and upload fetched, never evicted, served to others; it stays installed after a
restart. "Keep as a bookmark only" (or removing the icon) hands its files back to the cache, evicted as usual.

**Independent Test**: install a site, restart: the toolbar says "kept"; make it a bookmark: "kept" goes.

**Acceptance Scenarios**:

1. **Given** a bookmark, **When** made installed, **Then** the engine keeps the site and the toolbar state
   says "kept".
2. **Given** an installed site, **When** made a bookmark or removed from the desktop, **Then** the engine
   stops keeping it.
3. **Given** an install that couldn't be done (the site unreachable, the engine busy), **When** HyperBrowser
   starts again, **Then** it is tried again.

### User Story 2 - What you hold (Priority: P1)

The toolbar's state shows how much of the open site this device holds: `■ complete · 3 peers · 12.4 MB kept`.

**Acceptance Scenarios**:

1. **Given** an open site, **Then** the state shows its bytes held here, refreshed about every 10 s and right
   after an install or uninstall.

### Edge Cases

- A preset with no key yet: nothing to keep; once its key is known, the next launch installs it.
- A desktop saved by spec 002's build (installed icons never kept by the engine): installed at the next launch.
- The engine stops without a word (a crash): the shell says so and exits (spec 001's rule, now also without
  the `closing` event).

## Requirements *(mandatory)*

- **FR-001**: Engine `site.keep { key, keep }` → `{ kept }` (SwarmFS `site.keep`), the site opened first.
- **FR-002**: Engine `site.held { key }` → `{ bytes, kept }` (SwarmFS `site.held`, `site.kept`).
- **FR-003**: The desktop's kind drives it: installed → `site.keep(true)`; bookmark or removed →
  `site.keep(false)`. The icon remembers what the engine confirmed (`kept`), and the shell retries the rest at
  launch. The spec 002 stand-in (installed sites opened at launch) is gone.
- **FR-004**: The toolbar state adds the bytes held and "kept"; `site.held` at most every 10 s per open site.
- **FR-005**: Spec 001's sandbox self-test and spec 002's frame check keep passing.

## Success Criteria *(mandatory)*

- **SC-001**: An installed site is still installed after a restart.
- **SC-002**: The toolbar shows the bytes held within 10 s of opening a site.

## Assumptions

- Units: binary (1 KB = 1024 B), one decimal under 100.
- SwarmFS remembers the install per device; the desktop's kind is the person's choice, the engine's answer is
  the truth shown in the toolbar ("kept").
