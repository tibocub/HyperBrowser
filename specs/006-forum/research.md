# Research: 006 — the official forum

## R1. The forum's record types: from `site.json`, at publish

- **Decision**: `site.json` gains `types` (hypergraph's type form, JSON). `site.publish` makes the site with
  `createSite(title, { types })`; publishing the folder again calls `site.declareTypes(types)` (additions only:
  hypergraph refuses the rest with `INCOMPATIBLE_TYPES`).
- **Rationale**: the owner's engine publishes; types are the site's, versioned with its pages. Spec 019 /
  SwarmFS 005 built exactly this (requests-to-hypergraph B1, now done).
- **Alternatives**: the page calling `declareTypes` itself on the owner's first visit: every admin's visit would
  try, and a visitor could never post until then.

## R2. Read state on the person's devices: `hyper.mine`

- **Decision**: two calls, `hyper.mine.all()` → `{ name: value }` and `hyper.mine.set(name, value)` (null
  removes), stored as the person's settings named `hyperbrowser/site/<key>/<name>`: on every device of the person,
  never in the forum's space. Same consent as the rest of the site API.
- **Rationale**: the site handle can't reach the personal space (by design), so a site had no way to keep
  something for the person across their devices. Read state, the chosen sort and mentions seen need it. One
  setting per name keeps each write small (a thread read = one setting).
- **Caps** (lead review): a value ≤ 64 KB, a site ≤ 1 MB (names and values as JSON), else `TOO_BIG`; the forum
  drops read state of threads it no longer shows (≤ 500 entries, ~45 KB).
- **Alternatives**: `localStorage` (one device only: refused by the design); a JSON map in one setting (rewrites
  everything on each read). Noted in requests-to-hypergraph (B3): a site's own personal data on `hg.scope`
  would be the better home; the engine's names can move there without changing `hyper.mine`.

## R3. Invite-only, and the first invite

- **Decision**: `site.json` `"public": false` leaves the site closed (default true, as today). Admins make
  invites in the forum (`createInvite`). The owner's engine is headless (`engine/cli.js publish`), so
  `--invite member|admin` prints one invite link (one use) after publishing: Tibo's own HyperBrowser joins as
  admin with it.
- **Rationale**: an invite is hypergraph's `hg:` link, which the address field already opens (`site.open`).

## R4. Aggregates on the device

- **Decision**: the front page keeps live views of the board's threads and of the forum's latest replies and
  votes (limits 500 / 2000 / 5000) and computes replies, activity, score and liveliness from them.
- **Rationale**: one view per type instead of three calls per thread; "lively" must be computed on the device
  anyway. shortcut: past those limits old threads show fewer replies than they have; switch those counts to
  `count()`/`sum()` per visible thread then.

## R5. Text

- **Decision**: escape everything, then apply a small inline subset (`**bold**`, `_italic_`, `` `code` ``,
  ```` ``` ```` blocks, `> quote`, `[text](link)`, `![alt](path)`); links only to `hyper://`, a relative path or
  `#`; images only relative paths (the site's own). Mentions: `@` + the member's 52-character key in the stored
  text, shown as `＠name`.
- **Rationale**: HyperMD's full renderer emits HTML for things posts must not have (raw HTML, directives); the
  subset is short enough to own and test.

## R6. Devices

- **Decision**: nothing in the forum. Posts are the person's identity's; read state is in their settings
  (follows their devices). Device pairing is the engine's and shell's: not built yet (left in tasks.md).

## R7. Perf

- HyperBrowser has no perf setup (no `perf/` folder, no perf script). Noted; no scenario added.
