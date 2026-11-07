# Requests to SwarmFS

What HyperBrowser needs from SwarmFS and doesn't work around (constitution IV). Newest first.

## F5. Bytes held of a site on this device (2026-11-07, spec 002)

- **Need**: the shell's toolbar shows what this device holds of the open site ("12.4 MB"), next to complete
  and peers.
- **Today**: SwarmFS knows each file it holds (`held` records, app storage) but has no count per site; the
  shell would have to read SwarmFS's private records.
- **Ask**: `site.held()` (or a field of a site's status) → bytes of that site's files held here (pages and
  uploads, inline ones included or not: say which).
- **Here meanwhile**: the toolbar shows complete/loading and peers only.

## F4. Keep a visited site whole: "install" (2026-11-07, spec 002)

- **Need**: HyperBrowser's "install" (Tibo): a site kept whole on disk, never evicted from app storage, and
  seeded; a bookmark stays cached and evicted as usual.
- **Today**: a visitor's files land in app storage and are evicted least-recently-read first; only an
  owner's uploads are kept (`_keep`).
- **Ask**: `site.keep(true | false)`: fetch every page and upload of the site, keep them out of eviction, and
  keep them as they change; `false` hands them back to app storage's usual rules. Remembered across restarts.
- **Here meanwhile**: the shell records installed sites and opens them in the engine at launch (joined, so
  served while HyperBrowser runs); their files are still evicted as usual.

## F3. `close()` right after `sync()` leaks `sync()`'s interval (2026-11-07, spec 001)

- **Seen**: an engine closed within a moment of opening never lets its process exit. `sync()` sets its 10 s
  `setInterval` after a few awaits (`lib/swarmfs.js` `sync`: links started, `_watchSingles()`); `close()`
  clears `this._timer` at once, so a `close()` that comes first clears nothing and the interval runs forever.
- **Ask**: `close()` waits for a `sync()` in progress (or `sync()` checks for a close before setting the timer).
- **Here meanwhile**: the engine awaits its own `sync()` promise before `close()` (`engine/index.js` shutdown).
  Not a workaround of SwarmFS's behaviour: the right order anyway; drop the comment once fixed.

## F1. `createSite(name, { types })`: a dynamic site's own record types (2026-11-07, spec 001)

- **Need**: a dynamic site (the official forum) keeps its records in its own space, next to its pages (a site is
  one space, one key). Their types must be in the space.
- **Today**: `sfs.createSite(name)` calls `hg.createSpace({ name })`, which records SwarmFS's types only.
- **Ask**: `createSite(name, { types })` passing `types` (merged after SwarmFS's own) to `createSpace`; and later,
  once hypergraph can add types to one space (our request B1), a call to add types to an existing site.
- **Blocks**: the official forum's records through the site API.

## F2. `site.read` of a file nobody holds right now: `NOT_AVAILABLE` quickly (2026-11-07, note)

- Not a request yet: spec 001's tests use inline files only (≤ 60 KB). To check when the official site has big
  images: how long a page waits for a file no online member holds (fetch timeout 30 s by default).
