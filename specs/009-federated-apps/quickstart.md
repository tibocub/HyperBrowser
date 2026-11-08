# Quickstart: checking 009

Temp folder for tests: `HG_TEST_TMP=C:/Users/tiboz/AppData/Local/Temp/hg-tests`. Run the suites one after another.

## Tests (the "done when" list)

`test/instances.test.js` (engines on a local DHT, through `siteApi()`, the page's `window.hyper`):

1. A and B each `instances.create` → each is owner of theirs; B's board/role/hide/invite in A's: refused (SC-001).
2. C joins A's by invite and B's by public link; `instances.list` shows both; C posts in both (SC-002).
3. The app is published again with a changed page and a new type: opening either instance reads the new page;
   the new type works once each owner opens it (SC-003).
4. Guards (SC-004), each with a control run (guard off → the call goes through):
   - `instance` = another site's key, another app's instance, an unlisted instance → `NOT_ALLOWED`;
   - `instances.join` of a site's public link or another app's instance's link → `NOT_ALLOWED`, not held after;
   - consent refused → instances unreachable.
5. `instances.leave` → not listed, not reachable, not held here.

`test/forum.test.js` runs unchanged in what it checks, against an instance (SC-005).

```bash
npm test
```

```bash
npm run test:bare
```

```bash
npm run test:sandbox
```

SwarmFS (its branch): `npm test` in its worktree. hypergraph: unchanged; HyperBBS and hyperDNS only if hypergraph
changes.

## By hand (the real shell)

1. `npm run forum:publish -- --instance "HyperBrowser" --invite admin` → app key, instance key, invite.
2. `npm start`, paste the invite: the forum app opens on "HyperBrowser"; the address field shows the instance.
3. Open the app's key: "your forums", "create", "join by link", the official forum.
4. Create "Test", invite a second HyperBrowser (another `--dir`), post from both.
