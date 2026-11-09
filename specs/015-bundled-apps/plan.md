# Plan: 015 — bundled apps

## Where each part goes

- **hypergraph** (`lib/index.js`): `hg.exportSpaces(keys, dir)` and `hg.importSpaces(dir, { timeout })`.
  - Export: a fresh Corestore in `dir/cores` (its own random primary key, which signs nothing) replicates in
    process with the instance's store; each space's cores are opened there **by key** and downloaded whole:
    the decision log (Autobase: bootstrap, every writer in its system list, its view cores) and every accepted
    log. `dir/spaces.json` lists `{ key, root, cores: [{ key, length }], logs: [key] }`. Refused (NOT_ALLOWED)
    for a space that isn't public. Nothing named, no secret: the store's named cores are never opened.
  - Import: the snapshot's store replicates in process with the instance's store (hypercore checks every block
    against its signed tree: a changed block never arrives, so the download times out → IMPORT_INVALID). Then
    each space is joined as `#joinPublic` does once it has a peer: opened, its decisions applied, refused if not
    public, its logs considered (the gate checks each header as for a peer's notice), kept. A core already held
    longer is left as is (never downgrade). A failure drops the spaces this import opened.
- **SwarmFS**: `sfs.exportSites(keys, out)` with `SwarmFS.open(dir, { offline: true })` (no rescan, no swarm, so a
  build never publishes the owner's folder edits) and `sfs.importSites(from)`; the files: `out/files/<root>`,
  imported only when their hash is a root named by a page or upload record of the site, put in app storage
  with a held record (then `site.keep(true)` moves them to kept/ as for any cached file).
- **HyperBrowser**:
  - `scripts/build.js --apps-from <dir>`: `exportSites` of the preset keys (the forum entry is its official
    instance: the forum **app** is exported instead, looked up from the instance's `app`) into `<out>/app/apps`.
  - `engine/index.js` init `{ bundle }`: imports when `bundle/bundle.json`'s id isn't the one in
    `<dir>/bundled.json` or a bundled key isn't held; writes the marker after. Errors logged, start goes on.
  - `shell/main.js`: passes `bundle: <app>/apps` when it exists. The preset icons install as before.

## Tests

- hypergraph: `test/next/forum/bundled.js` (forum scenario: export a public forum, import offline, posts read,
  tampered refused, a new post reaches the importer from the owner, not public refused, older snapshot keeps
  newer data).
- SwarmFS: `test/export.test.js` (Node, Bare): pages incl. a non-inline file read offline after import;
  tampered file/core refused; no secrets in the folder; later edit arrives from a peer.
- HyperBrowser: `test/bundle.test.js`: engine init with a bundle opens every page with no bootstrap; second init
  doesn't import again; build check only if cheap.

## Perf

Import/export are not on a hot path of a running app (once per install); hypergraph's rule asks for a scenario
only for hot paths: none added, said in the report.
