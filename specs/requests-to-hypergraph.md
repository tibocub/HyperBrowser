# Requests to hypergraph

What HyperBrowser needs from hypergraph and doesn't work around (constitution IV). Newest first.

## B7. What's new since I last looked (2026-11-11, spec 016) — done: hypergraph 021 `space.since()` (2777971)

- **Need**: notifications and unread marks must find every record received since the last check, in a space that was
  closed meanwhile, after a restart, on a phone waking for seconds.
- **Today**: `change` fires only while someone listens, and `Hypergraph.open` opens kept-open spaces before an app can
  attach. `query().since()` goes by stamps: a message written offline and received late is missed, and an author with
  a clock far ahead silences what follows.
- **Ask**: `space.since(cursor, { types, limit })` → `{ records, cursor }`: records created past the cursor (a seq per
  log), `null` meaning "from now on". Read-only; the cost follows what's new, not the space's size.

## B6. A rendezvous on hypergraph's swarm (2026-11-08, spec 013) — worked around: a second Hyperswarm

- **Need**: a friend request by key: the sender knows only the other person's identity, no space key. Both meet
  on a DHT topic derived from the identity (`hash('hyperbrowser/contacts/1/' + identity)`) and exchange one
  message (the invite to their new conversation).
- **Today**: hypergraph's swarm joins only spaces' topics; it isn't exposed. HyperBrowser's engine runs a Hyperswarm
  of its own for this (`engine/contacts.js`): a second DHT node per engine (UDP socket, routing table, announces).
- **Ask**: `hg.meet(topic, { server, client, onconnection })` (or an app protocol on a topic's connections) on the
  one swarm, so an app adds a rendezvous without a second DHT node.

## B5. An invite only one identity can use (2026-11-08, spec 013)

- **Need**: a friend request carries a one-use invite to a private conversation, sent over the DHT to whoever
  answers under the recipient's topic. Anyone can answer under any topic: an impostor gets the invite and may
  join first.
- **Today**: HyperBrowser's sender bans anyone but the expected identity as soon as it sees them join (nothing was
  written there yet, the space is private: the key changes). The real recipient then finds the invite used up.
- **Ask**: `createInvite({ for: identity })`: a redemption by any other identity is refused (`NOT_ALLOWED`), the
  same way for every member (part of the signed invite). Group invites sent in a direct conversation would use it
  too.

## B4. `close()` hangs when called seconds after a join (2026-11-08, spec 012) — worked around

- **Seen**: device A (public DHT) has an installed public site; device B opens with `{ joinCode }`; B's
  `hg.close()` called right after `open` resolves never returns: it waits in `this.store.close()`
  (corestore), after the network and the spaces closed. 60 s after the join, the same close takes 0.4 s.
  Not seen on the test DHT. Repro: `E:\Code\P2P\.tmp\join-close.mjs` (HyperBrowser's engine: the PC keeps
  the preset site `8cbbhe…`, then the join, then close).
- **Worse**: a process killed during that hang left a folder that `Hypergraph.open` then waited on forever,
  with nothing pending (Node exits on "unsettled top-level await").
- **Likely**: the spaces listed in the personal space being created and opened (`#settle`) while `close()`
  runs; a core session opened after the store started closing.
- **Workaround in HyperBrowser**: after a join the shell keeps the joined engine running (no restart). A quit
  seconds after a join can still hang (the process stays; nothing is killed).
- **Ask**: `close()` always returns, whatever is opening; and a folder whose process died at any moment opens.

## B3. A site's own data on the person's devices (2026-11-07, spec 006) — done in HyperBrowser for now

- **Need**: the forum keeps what a person read, the sort they chose and the mentions they saw on their own
  devices, never in the forum's space. A site's handle (`hg.scope`) reaches no personal space, by design.
- **Today**: HyperBrowser's engine keeps it as the person's settings named `hyperbrowser/site/<key>/<name>`
  (`hyper.mine.all()`, `hyper.mine.set()`: docs/site-api.md). Each `set` is a settings record in the personal
  space; `settings()` reads them all.
- **Ask (later, not blocking)**: a site's own corner of the personal space on its handle, e.g.
  `scope.mine.get/set/all`, so a site's names aren't mixed with the person's settings and a site with many
  names (one per thread read) doesn't grow `settings()`. HyperBrowser would keep `hyper.mine` as it is.

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
