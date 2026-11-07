# Requests to hypergraph

What HyperBrowser needs from hypergraph and doesn't work around (constitution IV). Newest first.

## B2. Joining again a space left with `leaveSpace` (2026-11-07, spec 004) — fixed on a branch, not merged

- **Seen**: a visitor of a public site that left it (`leaveSpace`) and opened it again (`redeemInvite` of its
  public link) waited forever, past its timeout: leaving cleared every block of this device's own logs, their
  headers too, and opening reads that header, which nobody else holds when the device never wrote there.
  Once that passed, the site's pages (a sub-space) never came back: sub-spaces left with it stayed left.
- **Fix**: branch `claude/rejoin-public-after-leave` (hypergraph worktree `.claude/worktrees/rejoin-public`):
  `#purge` keeps block 0 of the two own logs; `#keep` joins again the sub-spaces left with the top space
  (meta `left-with`). Tests in `test/next/net/public-join.js`, `test/next/forum/leave.js`.

## B1. A dynamic site's own types, recorded per space (2026-11-07, spec 001)

- **Need**: the official forum is a site: its posts are its own types (`post`, `comment`, `vote`...) in the
  site's space. An engine of many sites opens hypergraph with no types of its own (or SwarmFS's), so it can't
  declare every site's types at open.
- **Today**: a space's types are recorded at `createSpace({ types })` and, later, only from the opening app's
  declaration when a decider opens it (spec 015). Writing a type the space lacks throws `INCOMPATIBLE_TYPES`.
- **Ask**: a way for a decider to add types to one space from a declaration given for that space, with the
  same compatibility check (only additions): e.g. `space.declareTypes(types)` (owner/admin), or
  `hg.scope(key, { identity: 'main', types })` recording them when the person is a decider there. HyperBrowser
  would take them from the site's `site.json` at publish.
- **Workaround refused**: declaring every site's types in the engine's `Hypergraph.open`.
- **Blocks**: the official forum (sites/forum) writing its records through the site API. Spec 001's tests use the
  types SwarmFS's site space already has.
