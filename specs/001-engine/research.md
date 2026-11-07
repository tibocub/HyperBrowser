# Research: 001 — the engine and serving sites

## R1. One engine = SwarmFS's hypergraph instance

- **Decision**: the engine opens `SwarmFS.open(dir, { bootstrap, appStorageMax })` and uses `sfs.hg` as its one
  hypergraph (one identity, one swarm). Sites' API goes through `sfs.hg.scope(key, { identity: 'main' })`.
- **Rationale**: SwarmFS opens hypergraph with its own types and rules (sites, files, uploads); a second
  instance would be a second identity and swarm. `hg.scope` hands a site its space and sub-spaces only.
- **Alternatives**: open hypergraph ourselves and pass it to `new SwarmFS(hg)`: SwarmFS's types aren't exported,
  so we'd copy them (rejected: a copy drifts).

## R2. Published folders keep their site

- **Decision**: no table of our own: `sfs.links()` lists the linked folders; a folder linked to a site's pages
  sub-space gives the site through `hg.space(pages).parent`. Publishing a folder already linked reuses it.
- **Rationale**: SwarmFS already persists links (personal space, all devices); a second table could disagree.

## R3. Opening by key

- **Decision**: a key already held → `sfs.site(key)`; else `sfs.visit('hg:' + key)` (hypergraph's public link is
  the key in link form, spec 016). A string starting `hg:` (an invite or a public link) goes to `visit` as is.
- **Rationale**: a public site opens from its key alone; an invite-only site (the forum while testing) by invite.
- **Alternatives**: `hg.scope(key)` alone opens a closed space by key, but SwarmFS's `site()` needs the space
  held; `visit` is SwarmFS's way and writes nothing (spec 004 FR-009).

## R4. Protocol

- **Decision**: the spike's protocol v1, kept: one JSON message per frame (`framed-stream`), `v: 1` on every
  message. Added: bytes encoded as `{ "$bytes": base64 }` in both directions (records' `bytes` fields, file
  contents), events `live` and `event` for live views, a `ping` request (heartbeat).
- **Rationale**: JSON is identical on Node, Bare and in react-native-bare-kit; the spike measured nothing slow.
  `compact-encoding` only if measured slow (spike recommendation 3).

## R5. Heartbeat

- **Decision**: `init { heartbeat: ms }`; any message from the shell counts; the shell sends `ping` every
  period; the engine closes (SwarmFS, hypergraph) and destroys its stream after 3 silent periods. The worker
  entry exits when the engine is closed. The CLI sends no heartbeat (none configured).
- **Rationale**: Windows gives the worker no pipe event when the shell is killed (spike).

## R6. The site API across the boundary

- **Decision**: the page calls `hyper.<method>(...args)` → shell → `site.call { key, sub, method, args }`;
  queries are a recorded chain `query(type).by(x).latest(n)` → `site.call { method: 'query', args: [type],
  chain: [['by', [x]], ['latest', [n]]] }`; `.live(fn, opts)` → `site.live` and `live` events; `on(event, fn)`
  → `site.on` and `event` events; `site.off { id }` stops one. Records passed as arguments cross as plain
  objects (hypergraph takes a record or its id). Not exposed: `addProtocol`, `memberConnections`
  (functions and streams can't cross).
- **Consent**: answers kept in the setting `hyperbrowser/identity` (`{ [key]: true | false }`, shared by the
  person's devices). `site.call` before an answer: `NEEDS_CONSENT`; the shell asks, sends `site.consent`, and
  retries once. After no: `NOT_ALLOWED`.
- **Static sites**: the engine reads `site.json` at `site.open`; `site.call`/`live`/`on` for a site without the
  `space` permission: `NOT_ALLOWED`. The shell gives a static view no preload at all.

## R7. Incomplete answers before types arrive

- **Decision**: pass `{ items, complete }` through unchanged; the engine never retries or waits. Live views fire
  again when they turn complete (hypergraph). Tested: a visitor's read straight after opening never throws for
  a type the space has, and a type the space lacks is `INVALID_TYPE` once complete.
- **Rationale**: spike problem 1, fixed in hypergraph 2026-11-06; the lead: "handle it, don't work around it".

## R8. Sandbox recipe

- **Decision**: the spike's (`docs/spike-findings.md` criterion 2), unchanged in substance: one
  `WebContentsView` per site (`sandbox`, `contextIsolation`, no Node), one session per site key
  (`persist:site-<key>`), `hyper` scheme handled per session for its own key only, every other request
  cancelled, permissions refused, `window.open` denied, navigation off the site prevented, the key taken from
  the sender. Added: a CSP header on served files (`default-src hyper://<key>/ 'unsafe-inline'`), and static
  sites get no preload. The self-test collects results with `executeJavaScript` (so no test-only API exists).
- **Control run**: `--no-guards` turns off the shell's checks (scheme host check, request filter, key from the
  sender, CSP); the self-test must then fail.

## R9. Duplex pair for the CLI and tests

- **Decision**: a 15-line `pair()` in `engine/protocol.js` (two `streamx` Duplexes writing into each other), so
  the CLI and in-process tests run `start()` exactly as the worker does.

## R10. Content types

- **Decision**: the shell maps the extension to a content type (a small table: html, js, mjs, css, json, svg,
  png, jpg, gif, webp, ico, woff2, txt, md, wasm; else `application/octet-stream`). The engine returns bytes only.
- **Alternatives**: `bare-mime` in the engine (rejected: the engine has no use for it; mobile's WebView needs its
  own anyway).

## R11. Site record types (gap)

- **Finding**: a dynamic site's own types (a forum's `post`) can't get into its space: SwarmFS's `createSite`
  records SwarmFS's types, and hypergraph records a space's types only from the opening app's declaration
  (spec 015). An engine of many sites can't declare every site's types. Filed: SwarmFS `createSite(name,
  { types })`; hypergraph: let a decider record a space's types from a declaration given per space (e.g.
  `hg.createSpace({ types })` exists; missing: adding types later for one space). Tests use `profile`.
