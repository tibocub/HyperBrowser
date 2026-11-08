# Research: 009 — federated apps

Read before deciding: `engine/index.js` (the site API: `target()`, `call`, `live`, `on`, `mine`, hosting), `shell/main.js`
(`bridge`: the shell names the site from the view), `shell/site-preload.cjs` (`window.hyper`, `subspace`),
hypergraph `lib/scope.js` (a site's handle: one space and its sub-spaces), `docs/next/api.md` ("A site's handle",
"Spaces and invites", "Many spaces"), `test/next/forum/forum.js` (`createForum` = `hg.createSpace`), SwarmFS
`lib/swarmfs.js` (`createSite`, `visit`, `site`), `lib/types.js` (`site` record: `put: { permission: 'decide' }`),
`lib/members.js` (`siteOf`).

## R1. What an instance is: a SwarmFS site whose `site` record names its app

- **Decision**: an instance is a top space made by `sfs.createSite(name, { app: appKey, types })`: a SwarmFS site
  with no pages, whose `site` record says `{ app: <the app's key> }`. Owned by its creator (hypergraph's
  `createSpace`: the creator is owner), with the app's record types.
- **Rationale**: the engine must know, unforgeably, which app an instance belongs to, for two things: opening an
  instance's link (which code to run?) and refusing an app that tries to join another site's space (FR-002,
  FR-006). SwarmFS's `site` record already exists, is read by `sfs.site()`/`visit()`, and only who may decide
  (owner, admins) may write it: a member can't forge it. Adding a field at the end is an addition (allowed between
  versions). An instance being a SwarmFS site also gives it uploads (pictures in posts, later) and
  install/held for free.
- **Alternatives**:
  - *A plain hypergraph space + a record `hyperbrowser/instance { app }`*: needs a check that the author is the
    owner (any member can put a record); more code, same result.
  - *Only a list per app in the person's settings, no mark*: then `join(link)` can't tell an instance from another
    site's space; a hostile app would join any public site and write there as the person. Rejected (constitution I).
  - *A sub-space of the app's space*: owned by the app's owner (Tibo would have authority). Rejected: the point.
  - *A copy of the app per instance*: a fix wouldn't reach every instance. Rejected (FR-008).
- **Who can be fooled**: an instance's owner or admin may write a `site` record naming any app; that only lets
  that app reach that instance, which its own owner chose. A space claiming app X fools only X into showing the
  claimer's data, as any instance would.

## R2. How a page reaches an instance: a handle, like `subspace`, checked by the engine

- **Decision**: the page stays on the app's origin (`hyper://<app key>/`): `window.hyper` is still the app's own
  space, and `hyper.instance(key)` is a handle with the same calls on one instance. Over the wire it is one more
  field, `instance`, next to `sub` in `site.call`/`site.live`/`site.on`; the engine's `target()` checks the key is
  in **this app's** list of the person's instances, then uses `hg.scope(instanceKey, { identity: 'main' })`.
  `hyper.instance(key).subspace(sub)` works as on the app's space. Plus four calls: `hyper.instances.create`,
  `.join`, `.list`, `.leave`.
- **Rationale**: the smallest change on every layer: the shell still names the site from the view (only the app);
  the engine checks the instance against a list it alone writes; the forum's `lib/` already takes `hyper` as an
  argument, so it is handed `hyper.instance(key)` instead (no rewrite). One origin per app: one consent, one
  `hyper.mine`, one storage, and one page may show several instances (a "your forums" page).
- **Alternatives**: *each instance its own origin (`hyper://<instance key>/` serving the app's pages, `hyper` = the
  instance)*: the page couldn't create or join without a shell navigation API, consent and storage split per
  instance, the shell needs a second key per view. Rejected as more code for less.

## R3. Where the list of an app's instances lives

- **Decision**: one setting of the person, `hyperbrowser/app/<app key>/instances` → `{ [instance key]: true }`,
  written only by the engine (create, join, leave), as `hyper.mine` and the consent answers are today. On every
  device of the person; never in any space; a site can't write it (the `mine` prefix is `hyperbrowser/site/`).
- **Rationale**: the list is what makes an instance reachable by an app (FR-006); it must be the person's, out of
  pages' reach, and follow them across devices (once pairing exists).
- **Note**: a joined instance whose `site` record names another app is never added (R1); the list is also checked
  against the mark when an instance opens (an admin of the instance may have changed it).

## R4. Opening an instance's link from the address field

- **Decision**: `site.open` of a key or link whose site has `app` (an instance) opens the app instead, adds the
  instance to that app's list (the person pasted the link: that is the "join"), and answers
  `{ key: <app key>, instance: <instance key>, manifest: <the app's> }`. The shell loads the app's view with
  `?instance=<key>` (the view already takes a query) and keeps the tab's address on the instance's key, so copying
  the address shares the instance. The page reads `new URLSearchParams(location.search).get('instance')`.
- **Rationale**: no new shell concept; links stay `hg:` links (invites, public links) or keys, as for sites.

## R5. Types and app updates

- **Decision**: `instances.create` makes the instance with the app's `site.json` types. When an instance is
  reached and the app's types have something the instance lacks, the engine declares them if the person may
  (owner, admin: `declareTypes`, additions only, spec 005/hypergraph 019); otherwise the instance keeps its types
  and a write of a missing type is `INVALID_TYPE` until an admin comes by. Code updates need nothing: an instance
  has no pages; the app's pages are read from the app's site, as today.
- **Alternatives**: *instances declare their own types*: an app's code expects its own types; letting instances
  diverge means the code can't trust them. Kept out (Q5).

## R6. Consent, hosting, leaving

- **Consent**: one answer per app, covering its instances (the engine's `target()` already keys it by the view's
  site, the app). Per-instance consent would ask again for every forum joined (Q6).
- **Hosting**: instances the person owns are hosted (spec 004's "own sites" rule, `hosted()` already says
  owner). Instances they joined: never left at start nor after the grace period (the sweep and `leaveLater` skip
  spaces in any app's list), so an invite-only forum isn't lost when the tab closes; they go online while used
  (hypergraph's open-while-used, spec 017) and when the app shows them. Leaving is the person's act
  (`instances.leave`) only (Q7).
- **Leave**: `sfs.leave(key)` (drops it from this device) and removed from the app's list. Membership stays
  (hypergraph's rule): a link brings them back.

## R7. Library changes needed

- **SwarmFS**: `site` type gains `app: 'string'` (at the end); `createSite(name, { app, types })` makes no pages
  sub-space when `app` is given; `site(key)` accepts a `site` record with `app` and no pages (`site.app`, `site.pages`
  null; `read()` → `NOT_FOUND`). Requests file: F7. Branch of its own, with its tests.
- **hypergraph**: none expected (`createSpace`, `redeemInvite`, `scope`, `declareTypes`, `leaveSpace` suffice). If
  that changes during implementation, its forum scenario tests are updated (its CLAUDE.md rule 3).

## R8. The official forum's data and keys

- **Decision**: drop the test forum. The app is published fresh, **public** (its code must load for anyone; the
  old forum site is invite-only, and making it public would publish its test data for good), and Tibo creates
  the "HyperBrowser" instance in it (invite-only while testing, as today).
- **Consequence**: **the forum key in `shell/preset.json` changes**: it becomes the official instance's key (opening
  it opens the app on it). Tibo republishes from his owner folder, the lead updates the preset. `forum:publish`
  gains `--instance "HyperBrowser"` to create the instance and print its key and an admin invite.
