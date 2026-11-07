# Feature Specification: 001 — the engine and serving sites

**Feature Branch**: `001-engine`

**Created**: 2026-11-07

**Status**: Draft

**Input**: "Spec 001, engine and serving sites" (lead session, 2026-11-07), from the milestone-1 design
(`docs/design-milestone-1.md`, Tibo 2026-11-06/07), hypergraph's ROADMAP "The final app: HyperBrowser",
SwarmFS spec 004 "sites", hypergraph spec 015 "one engine" and the shell spike (branch `spike`,
`docs/spike-findings.md`). The shell's own interface (address bar, tabs, bookmarks, desktop) is spec 002,
not this one. Choices made here without Tibo are listed under Assumptions, for the lead's review.

Words used below:
- **Engine**: the part of HyperBrowser that holds the person's identity, the network and every site's
  data. It runs with or without a window (a command line for owners and, later, helpers).
- **Shell**: the desktop app around the engine: windows, one view per open site, the only bridge from a
  site to the engine.
- **Site**: one SwarmFS site space, one key (*Tibo*): its pages and files, a `site.json` at its root, and
  for a dynamic site its records (a forum's posts).
- **Static site**: its pages may run scripts, but those scripts get no access to the site's space.
- **Dynamic site**: a site whose `site.json` asks for its space; its scripts get the hypergraph API for
  that space, and nothing else.
- **Owner**: whoever published the site (the official site and forum: Tibo, on his machine).
- **Visitor**: someone opening a site by its key.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish a site folder from the command line (Priority: P1)

Tibo has a folder with his site's pages and a `site.json`. He runs the engine without a window,
`publish <folder>`: the engine makes the site (the first time), publishes the folder's files into it, makes
it readable by anyone with its key, prints the key and stays online so visitors can read it. Next time,
the same folder goes to the same site: the key never changes; edits to the folder reach visitors while it
runs.

**Why this priority**: there is nothing to open before a site exists. It is also how the official site and
forum get their keys (kept on Tibo's machine).

**Independent Test**: publish a folder twice in a row with the same engine folder; the same key both
times; the key opens the site on another engine.

**Acceptance Scenarios**:

1. **Given** a folder with `site.json` and `index.html`, **When** the owner runs `publish <folder>`,
   **Then** the engine prints the site's key and stays online until stopped.
2. **Given** the folder was published before from the same engine folder, **When** published again,
   **Then** the same key, and the folder's current files are what visitors read.
3. **Given** a folder without `site.json`, or with one that isn't valid, **When** published, **Then**
   refused with a message saying what is wrong; nothing is created.
4. **Given** the engine running `publish`, **When** the owner edits a page in the folder, **Then** a
   visitor reading it again gets the new version (SwarmFS's linked folder).

---

### User Story 2 - Open a site by its key and see its pages (Priority: P1)

Dave pastes the full key of Tibo's site. HyperBrowser opens the site in a view of its own and shows its
entry page; links, styles, scripts and images inside the site load from the site. Dave never had an
invite: the key is enough. The same works without a window (`open <key>` prints the site's title and entry
page, and stays online, holding what it read).

**Why this priority**: opening by key is the browser's core; milestone 1 has no names, only keys.

**Independent Test**: two engines on a test network; one publishes, the other opens the key alone and reads
the entry page and `site.json`, byte for byte.

**Acceptance Scenarios**:

1. **Given** a published site and its key, **When** a visitor opens the key, **Then** they read
   `site.json` (title, entry page, icon, what it asks for) and the entry page, identical to the owner's.
2. **Given** the site is open, **When** a page asks for `hyper://<key>/style.css` (or any path inside the
   site), **Then** it gets that file with a fitting content type; a missing file gives "not found".
3. **Given** a key with a typo, or a key of a space that isn't a site, **When** opened, **Then** a clear
   error ("not a site", "no one has this site online"), never a hang.
4. **Given** the owner offline but another visitor holding the pages, **When** a third visitor opens the
   key, **Then** they read it from that visitor (SwarmFS).

---

### User Story 3 - Each site is sandboxed (Priority: P1)

Every open site runs in its own view: its scripts can't reach the computer's files, Node, the web, or any
other site's pages, storage, cookies or data. A page can't choose which space it talks to: the shell
decides, from the view the message came from.

**Why this priority**: HyperBrowser runs code from anyone (constitution I).

**Independent Test**: the sandbox self-test opens two test sites and a static one; every check passes;
the same test with the shell's guards turned off must fail (the control run).

**Acceptance Scenarios**:

1. **Given** a site's page, **When** it tries Node (`require`, `process`), files (`file://`), the web
   (`https://`), another site (`hyper://<other>/`, its script, its storage, its cookies), **Then** each is
   refused.
2. **Given** a dynamic site's page, **When** it passes another site's key to an API call, **Then** it still
   gets only its own space.
3. **Given** the self-test run with the guards off, **Then** it fails (proves the guards do the work).
4. **Given** a static site's page, **Then** it has no site API at all.

---

### User Story 4 - A dynamic site uses its own space (Priority: P2)

The forum (later) is a dynamic site: its scripts read and write its records through the hypergraph API
for its own space: calls return promises, and live lists stay live, updating the page when records
arrive. The first time a dynamic site uses the API, HyperBrowser asks the person once: "let this site use
your identity?"; the answer is remembered for that site, on all their devices. Until they say yes, the site
gets nothing; if they say no, its calls are refused.

**Why this priority**: the forum needs it, but the official static site doesn't; it can follow stories 1–3.

**Independent Test**: a test dynamic site writes a record and keeps a live list; a second engine's visitor
sees the record arrive in its live list; before consent every call is refused.

**Acceptance Scenarios**:

1. **Given** a dynamic site not yet allowed, **When** its page makes an API call, **Then** the person is
   asked once; yes: the call goes through, and later calls and later visits don't ask again; no: refused.
2. **Given** an allowed site, **When** its page writes a record and reads it back, **Then** it gets it,
   written under the person's identity.
3. **Given** a live list open in the page, **When** a record arrives from another member, **Then** the
   page's list updates without asking again; **When** the page closes, the live list stops.
4. **Given** a static site, **When** it tries any API, **Then** there is none (story 3), and the engine
   also refuses API calls for it.
5. **Given** a visitor opening a dynamic site whose records haven't arrived yet, **When** its page reads,
   **Then** it gets an empty answer marked incomplete (not an error), and its live list fills in once they
   arrive.

---

### User Story 5 - The engine stops when the shell dies (Priority: P2)

If the shell crashes or is killed (Task Manager), the engine notices within seconds and stops, instead of
running on unseen.

**Why this priority**: the spike found an orphan engine on Windows (no pipe signal at all).

**Independent Test**: an engine whose shell stops sending heartbeats closes itself within the timeout.

**Acceptance Scenarios**:

1. **Given** a running engine, **When** no message arrives from the shell for 3 heartbeat periods, **Then**
   the engine closes cleanly (data saved) and exits.
2. **Given** a shell sending heartbeats, **Then** the engine never stops by itself, idle or not.

### Edge Cases

- A message from a newer or older protocol version: refused with `BAD_VERSION`, never misread.
- A malformed frame (not JSON, no id): dropped, the engine keeps running.
- A request before `init`: refused (`NOT_READY`); a second `init`: refused.
- A path escaping the site (`../`, `%2e%2e`, backslashes): "not found", never another site or a local file.
- A big file (over the inline size) whose holders are offline: "not available", the page loads the rest.
- A site whose `site.json` names an entry page that doesn't exist: opening says so.
- The same site open in two views: one handle in the engine, both work; closing one keeps the other.
- A page closed while a live list or a call is in flight: the engine stops the list, the reply is dropped.
- A record field holding bytes: crosses the boundary as bytes, not as text.
- A visitor before the site's types arrive: empty, incomplete answers (hypergraph since 2026-11-06), then
  `INVALID_TYPE` only once the space is complete and the type truly isn't there.

## Requirements *(mandatory)*

### Functional Requirements

**Engine and protocol**

- **FR-001**: The engine MUST be one entry, started on one duplex byte stream; everything it needs (its
  folder, its network) MUST arrive as messages, never as environment or globals.
- **FR-002**: The engine MUST run on Bare (the shell's worker) and Node (tests, command line) with the same
  code, using only modules that run on both and on mobile later.
- **FR-003**: Messages MUST be framed and versioned: requests with ids, replies (a result or an error with
  a code), and events; a message of another version is refused (`BAD_VERSION`); an unknown request is
  refused (`UNKNOWN_METHOD`).
- **FR-004**: The engine MUST hold one identity and one network for every site, opening each site through
  hypergraph's site handle (`hg.scope`), never giving a site anything outside its own space.
- **FR-005**: The engine MUST stop by itself when heartbeats stop for 3 periods (period given at start).

**Sites**

- **FR-006**: A site MUST be one SwarmFS site space with one key; a site's root MUST hold `site.json` with a
  title, an entry page, an optional icon and the permissions it asks (`space` makes it dynamic).
- **FR-007**: The owner MUST be able to publish a folder as a site from the command line: the same folder
  from the same engine folder always goes to the same site; the site is public (readable by key alone).
- **FR-008**: A visitor MUST be able to open a site from its full key alone, and read any of its files by
  path, verified (SwarmFS), with "not found" and "not available" told apart.
- **FR-009**: The command line MUST offer `publish <folder>` and `open <key>`, both staying online until
  stopped, on Node and Bare, with the same commands on Windows and Linux.

**Shell**

- **FR-010**: The shell MUST run the engine as a Bare worker (Pear), send heartbeats, and show each site in
  its own sandboxed view, served from `hyper://<key>/`, behind one view interface (so mobile can swap in a
  native web view).
- **FR-011**: A site's view MUST reach only its own `hyper://<key>/` files and, if dynamic, its own API; no
  Node, no files, no web, no other site, no other site's storage; no pop-ups, no navigation away, no
  device permissions.
- **FR-012**: The shell MUST name the site of every API call from the view it came from, never from the
  page's message.

**Site API**

- **FR-013**: A dynamic site's page MUST get hypergraph's public API for its own space and its
  sub-spaces (the site handle's calls, minus what can't cross a message boundary: app protocols, raw
  connections), every call returning a promise, live queries and events staying live until the page stops
  them or closes.
- **FR-014**: A static site's page MUST get no API; the engine MUST refuse API calls for a static site.
- **FR-015**: The first API call of a dynamic site MUST ask the person "let this site use your identity?";
  the answer is remembered per site (shared by the person's devices); until yes, calls are refused
  (`NEEDS_CONSENT`), after no, refused (`NOT_ALLOWED`).
- **FR-016**: Answers marked incomplete MUST reach the page as they are (empty and `complete: false` before
  the space's types arrive), never turned into errors or retried by the engine.

**Tests**

- **FR-017**: The engine, protocol and site API MUST have tests on Node and Bare, on a local test network;
  a two-engine test (publish on one, open by key on the other); the sandbox self-test with its control run.

### Key Entities

- **site.json**: `{ title, entry, icon?, permissions: [] }` at the site's root. `entry`: the path of the
  first page (default `index.html`); `icon`: a path; `permissions`: what the site asks for, `space` (the
  API for its own space) the only one in milestone 1; unknown ones are ignored.
- **Published folders**: per engine, which folder went to which site (so a folder keeps its key).
- **Identity answers**: per site key, yes or no, kept with the person's settings.
- **Message**: `{ v, id, method, params }`, `{ v, id, result | error }`, `{ v, event, data }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a local test network, a second engine reads a freshly published site's `site.json` and
  entry page from the key alone within 15 s, on Node and on Bare.
- **SC-002**: The sandbox self-test passes every check, and its control run (guards off) fails at least one
  check per guard (other site's script, the web, a forged key).
- **SC-003**: An engine left without heartbeats closes within 4 heartbeat periods.
- **SC-004**: A record written by a dynamic site on one engine reaches a live list of the same site on
  another engine without the page asking again (within 15 s on a local test network).
- **SC-005**: No malformed message (bad JSON, wrong version, unknown method, bad params) crashes the engine:
  each is refused or dropped and the next good message works.
- **SC-006**: Publishing the same folder twice gives the same key, 2 out of 2.

## Assumptions

1. **Public sites.** `publish` makes the site public, so a key alone opens it (hypergraph's public link is
   the key in link form). Invite-only sites (the forum while testing) are opened by invite: the engine
   accepts an invite link where a key goes; the forum's invite flow is its own spec.
2. **One permission.** `site.json` asks `space` to become dynamic. Until hypergraph's per-site keys exist,
   using the space means using the person's main identity, hence the single question (design, lead's
   call).
3. **The question's UI** in this spec is a plain system dialog from the shell; spec 002 designs the real one.
4. **Answers are kept in the person's settings** (`hg.setSetting`), so all their devices remember them.
5. **A dynamic site's own record types** (a forum's `post`) can't be put in its space today: a SwarmFS site
   records SwarmFS's types only, and an engine records a space's types only from its own declaration. Filed
   as requests (`specs/requests-to-swarmfs.md`, `specs/requests-to-hypergraph.md`); this spec's tests use
   the types a site space already has (`profile`, `upload`).
6. **Opening writes nothing.** Opening by key joins the public site without writing anything into it
   (SwarmFS, spec 004); the visitor keeps what it read in app storage, under its cap.
7. **The command line's engine folder** defaults to `~/.hyperbrowser` (`--dir` to change it); the window's
   is the app's own data folder.
8. **Linux** is not tested in this spec (Tibo runs it); code stays platform-neutral and the docs give the
   Linux commands.

## Out of scope (named for later)

- The shell's interface: address bar, tabs as a taskbar, toolbar, bookmarks, desktop, the identity question's
  design (spec 002).
- The tray (engine kept running when the window closes), `hyper://` links registered with the system.
- HyperMD pages rendered by the shell (HyperMD's own spec; this spec serves files as they are).
- Short keys and hyperDNS names in the address.
- Per-site keys (hypergraph), a site's own record types (requests filed), uploads from a page.
- Packaging and P2P updates.
