# Feature Specification: 004 — installing decides hosting

**Feature Branch**: `claude/004-hosting-422124`

**Created**: 2026-11-07

**Status**: Built

**Input**: lead session, 2026-11-07: the engine never left a space, so every site ever opened stayed joined,
was reopened at startup, and was announced and served for good, installed or not. Tibo saw it on two machines:
a site never installed nor bookmarked still served after a restart. Installing (not bookmarking) must be what
keeps a site hosted; the official forum relies on it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An installed site is hosted (Priority: P1)

Tibo installs the forum. With no tab open, and after a restart with nothing opened, his device serves it: a
visitor gets it from him while the publisher is offline.

**Independent Test**: `test/hosting.test.js` "an installed site is served with no tab open, and after a restart".

**Acceptance Scenarios**:

1. **Given** an installed site and no tab, **When** the grace period is over, **Then** it is still served.
2. **Given** an installed site, **When** the engine restarts and nothing is opened, **Then** it is served.

### User Story 2 - A visited site is not hosted for good (Priority: P1)

Tibo opens a site he hasn't installed (a bookmark, or a link). He serves it while its tab is open and for 5
minutes after he closes it; then no longer. After a restart he doesn't serve it at all.

**Independent Test**: `test/hosting.test.js` "a site only visited is left after its grace period…" and "at
start, a site neither installed nor own is left…".

**Acceptance Scenarios**:

1. **Given** a visited site with its tab open, **Then** it is served.
2. **Given** its last tab closed, **When** the grace period is over, **Then** a fresh peer can't get it from
   this device.
3. **Given** a visited site held from before, **When** the engine starts, **Then** it is left before anything
   else: not served.
4. **Given** a site left, **When** opened again (someone serving it online), **Then** it opens, and can be
   installed (and is then served).

### Edge Cases

- A site opened in two places (a tab and the desktop's install action): left only after both closed.
- A tab closed and reopened within the grace period: never left; the network topic is kept the same 5 minutes
  by hypergraph, so it comes back at once.
- A link being opened when a grace period ends: the leave waits for the next one (the link may be this site).
- The person's own published sites: never left.
- Eviction: SwarmFS deletes cached files whether the space is joined or not (checked: `_evict` looks at files
  only). A non-installed site is left within the grace period of its last tab, so there is no separate leave
  on eviction.
- Uninstalled with no tab (the desktop's "bookmark only"): open, `keep(false)`, close: left after the grace
  period.

## Requirements *(mandatory)*

- **FR-001**: Each `site.open` counts as one tab until its `site.close`; the shell closes a site when its
  view goes, and the desktop's install action closes what it opened.
- **FR-002**: The last close starts a grace period (`init`'s `grace`, default 5 minutes); at its end, a site
  neither installed (`site.kept()`) nor owned by the person is left (SwarmFS `leave`). Its cached files stay.
- **FR-003**: At `init`, before `sync()`, every top space held here that is a site, neither installed nor the
  person's own, is left. A space that isn't a site, or can't be read at once, is left alone.
- **FR-004**: A site left can be opened again and installed again (hypergraph and SwarmFS fixes below).

Grace period: 5 minutes, the same as hypergraph's grace for a closed space's topic (`GRACE_MS`): a tab closed
by mistake or a quick back-and-forth comes back at once, and a visitor who just read the site can still be
served the files they were sent to it for; longer would announce sites the person is done with.

Fixes outside this repo (branches, not merged):

- **hypergraph** `claude/rejoin-public-after-leave`: joining again a space left with `leaveSpace` hung for a
  device that never wrote in it (its own log's header was cleared); and its sub-spaces (a site's pages) stayed
  left.
- **SwarmFS** `claude/leave-forgets-site`: `leave()` kept the site's old keeping pass, so installing it again
  after rejoining kept nothing.

Planned, not in this spec: hosting some bookmarks by rarity (a site few peers serve), in a later spec.

## Success Criteria *(mandatory)*

- **SC-001**: An installed site is served by this device with no tab and after a restart (test).
- **SC-002**: A site not installed is not served after its grace period or after a restart (test).

## Assumptions

- "Not announced" is checked as "a fresh peer can't open it from this device": leaving drops the topic and the
  space's records, so nothing is announced or served.
- Reopening a left site needs someone serving it online (its records were dropped); its files are not fetched
  again.
