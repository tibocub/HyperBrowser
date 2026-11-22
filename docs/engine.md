# The engine

The engine (`engine/`) holds the person's identity, the network and every site's data, on hypergraph and
SwarmFS. It runs as a Bare worker inside the app (`engine/worker.js`), or on Node or Bare without a window
through the command line (`engine/cli.js`).

The shell talks to it over one framed byte stream: requests with ids, replies and events
(`engine/protocol.js`; the message list is in `specs/001-engine/contracts/protocol.md`). Sites never reach the
engine directly: the shell checks every call first ([shell.md](shell.md)). What a site's page gets:
[site-api.md](site-api.md).

| File | What it does |
|---|---|
| `index.js` | `start(ipc)`: the message handlers, sites, hosting, devices, names, site calls |
| `manifest.js` | reads and checks `site.json` |
| `publish.js` | publishing a folder as a site |
| `notifications.js` | watches app instances and keeps the notification list |
| `circles.js` | circles and holding copies for them |
| `contacts.js` | contacts, friend requests, contact links |
| `projects.js` | projects: synced folders, Publish, versions, previews |
| `helper.js`, `helper-config.js` | the always-on helper ([helper.md](helper.md)) |
| `cli.js` | the command line |

## Command line

```bash
node engine/cli.js publish <folder> [--dir <engine folder>] [--invite member|admin] [--instance <name>] [--new]
node engine/cli.js open <key>
node engine/cli.js helper [--config <file>] [--dir <folder>] [--join hg:…]
```

The same commands run on Bare: `bare engine/cli.js …` (`npx bare` from this repo). The engine folder defaults
to `~/.hyperbrowser`.

### publish

A site is a folder with a `site.json` and its pages ([site-api.md](site-api.md) has every field):

```json
{ "title": "HyperBrowser", "entry": "index.html", "icon": "icon.png", "permissions": [] }
```

`publish` prints `key: …` and stays online: visitors read the site from you while it runs, and edits you make in
the folder reach them. The same folder in the same engine folder always gets the same key, so keep both.

- `--invite member|admin`: prints a one-use invite link (`hg:…`) after the key, for a dynamic site. Pasted into
  HyperBrowser's address bar, it lets that HyperBrowser in with that role.
- `--instance "<name>"`: also makes an instance of the app owned by the publisher (the first time; the same one
  after), and prints its key. If the app declares an `official` type, the instance is recorded there.
- `--new`: gives the folder a fresh site with a new key and leaves the old one.

An invite-only site (`"public": false`) stays invite-only. If a folder first published with `"public": false`
later drops that line, publishing refuses with `PRIVATE_SITE`: a space can't be made private again once public,
and its records would become readable. Use `--new` for a public site.

### open

`open <key>` prints the site's title and its entry page's size, and stays online. `npm start -- --open <key>`
opens it in a tab of the shell instead.

## The official apps

```bash
npm run apps:publish -- --dir <owner engine folder>
npm run apps:seed                   # the same from ../hyperbrowser-owner, staying online
```

`apps:publish` builds the home site, then publishes every app listed in `scripts/apps.js` (home, the forum with
its "HyperBrowser" instance, Apps, Chat, Contacts, the IDE) from that engine folder. It then:

- writes their keys into `shell/preset.json` (only the `key` fields; for the forum, its instance's key);
- lists each app in the Apps store as an `app` record, from its `site.json` `title`, `description` and icon;
- prints what changed, or "no change".

A key already in `preset.json` that differs is never overwritten (it prints `KEPT`) unless you add `--replace`.
`--stay` keeps every app and the forum online until Ctrl+C.

Always publish from the same checkout: a folder's key is tied to its path, so another checkout (a worktree, for
example) makes new sites.

To add an app: a line in `scripts/apps.js` (`{ id: 'myapp', folder: 'sites/myapp' }`; an id not in
`preset.json` is only listed in the store), a `"description"` in its `site.json`, then run the command again.

### Bundled apps

`npm run build -- --apps-from <owner folder>` packs each preset app's data (`scripts/bundle.js`: the app's
space, its pages and the files too big for a record, signed by the owner; no key, identity, personal space or
setting) into the build's `apps/` folder, with a `bundle.json` (`{ id, apps: [{ id, key }] }`).

The shell passes it to the engine as `init { bundle }`. At start, the engine imports it if this engine folder
hasn't imported this bundle yet (`<dir>/bundled.json` holds the last id) or a bundled app isn't held here. Each
app is imported as a visit of it: every block checked against its writer's signature and every file against its
signed hash, so a changed snapshot is refused (logged and tried again at the next start; the start goes on).
The shell then installs the preset apps with no peer needed. A newer version already held here is kept (a core
is never taken back); later versions come from peers.

The forum's preset key is its official instance, which is invite-only: the forum app is packed, the instance is
not.

## Which sites this device serves

- **Installed** sites (`site.keep(true)`), **your own** sites (owner, or admin as a project's co-author) and
  **bundled** apps: joined and served from engine start, with or without a tab.
- **Any other site**: joined while a tab shows it (`site.open` … `site.close`), and for a grace period after its
  last tab closes (5 minutes; `init { grace }`). Then the engine leaves its space (SwarmFS `leave`, hypergraph
  `leaveSpace`): it is no longer announced or served, and its records go from this device. Its files stay in the
  cache; opening it again joins it again (someone must be online) and reuses them.
- **At start**, every site held here that is neither installed, yours nor bundled is left.
- **Eviction** (the cache over its cap) deletes cached files whether the space is joined or not.
- `hosting` → `{ sites, handles }`: how many sites are joined now (the tray's "hosting 3 sites"), and how many
  app-instance handles are kept open.

## Devices: one identity on several computers

hypergraph pairs devices; the engine passes it through.

- `devices.add` gives a code. The new computer starts its engine in an **empty folder** with
  `init { joinCode, deviceName }`: it becomes a device of the same identity (same key) and receives the recovery
  phrase over the pairing connection.
- What follows the person on every device: the spaces any device created or joined, roles in them, and the
  settings: answers to "use your identity?", sites' own data (`hyper.mine`), apps' instance lists, and the
  installed sites (`hyperbrowser/installed/<key>`). SwarmFS's "kept" flag stays per device, so each device keeps
  the files itself.
- `devices.remove`: what that device does from then on counts for nobody (`DEVICE_REMOVED` on it). It needs the
  recovery phrase: plain on this device until protected with `devices.protect`, then behind the password.
- `devices.list` and the `devices` event: see the protocol.
- `init { mnemonic }` on an **empty folder**: SwarmFS restores the identity of that 24-word recovery phrase (same
  identity key, a new device key). A phrase that isn't one fails `init` with hypergraph's "Invalid mnemonic" (no
  code); a folder already holding another identity, `NOT_ALLOWED`. The shell passes it on the first start only.
- `phrase.read { dir, password? }`: the recovery phrase in another engine folder, closed (the shell's identities:
  shown before one is deleted). Works before `init`; `NOT_ALLOWED` when protected and the password is wrong.

Known issue: closing an engine within seconds of a join can hang in hypergraph (`specs/requests-to-hypergraph.md`
B4), so the shell doesn't restart the engine after a join.

## Names

`names.resolve { address, timeout? }` → `{ key, authority }` resolves `name@authority` through HyperDNS
(`file:../hyperDNS`, running on the engine's own hypergraph). The answer is the first of the name's records that
is a site key, `hyper://<key>` or an `hg:` link. The authority is one this engine holds (by its name), or any
authority by its link (`name@hg:…`, joined read-only the first time).

Errors: `UNKNOWN_AUTHORITY`, `AMBIGUOUS_AUTHORITY`, `UNKNOWN_NAME`, `UNAVAILABLE` (nobody holding it is online;
it waits up to `timeout`, 10 s by default), `NOT_A_SITE`, `INVALID_PARAMS`.

Only the shell calls it; pages can't. To create authorities and publish names, use HyperDNS's own shell
(`npm run shell` in that repo). Cost: `npm run perf:names`.

## Notifications

`engine/notifications.js`. An app's `site.json` `notifications` list (checked by `manifest.js`) is copied to the
person's settings when they say yes (`site.permit { permission: 'notifications' }`) and refreshed at each open.
The engine watches the app's instances with hypergraph's `space.since(cursor)`: one sequence number per log,
never timestamps.

- **What stays online**: the conversations of the app named by `apps.set` (Chat), held with `space.hold()`, up
  to 24. Every other watched place is checked in turns, 2 at a time, 20 s each (`perf/turn.mjs` measures a
  turn: 9 to 22 s on the public DHT).
- **History isn't news**: a place's first look starts from now; a place still catching up stays silent (checked
  every second) until it is complete once. What a launch finds in its first turn is told at once, as one
  summary.
- **This device**: `<engine dir>/notifications.json` holds `cursors` (one per place), `items` (the latest 200)
  and `dots`. It is saved only when something changed, atomically (temp file, rename), after the items were
  told: a crash may repeat one, never lose one.
- **The person's settings** (all devices): `hyperbrowser/permissions` (the answer),
  `hyperbrowser/notify/app/<app>` (`{ title, watches, hide }`), `notify/mute/<place>`, `notify/read/<place>`
  (`{ [log, 16 hex]: next unread seq }`, 64 logs at most), and `hyperbrowser/notify/follow/<app>` (at most 100
  per app).
- **Dots**: a watch with `"show": "dot"` only sets the place's dot, cleared by `notify.read`.
- **Follows**: watches added at runtime with a `place`, `where` and `by`, checked by `manifest.js`
  `watch(w, types, true)`. Their items carry `follow` and `popup` and never count in `unread`.
- **Handles**: an app instance's handle that no subscription uses is closed 30 s after its last call
  (`init { idle }` in tests), so hypergraph can close its space once idle. A subscription keeps it open.
- **Clean-up**: `instances.leave` and an uninstall (`site.keep false`) remove cursors, items, mute and read state.

Shell messages:

- `notify.state` → `{ items, unread: { total, byApp, byPlace }, apps }`
- `notify.set { app, allow?, hide? }` or `{ place, mute }`
- `notify.read { place, app? }`; with `app`, refused unless the place is that app's (for
  `hyper.notifications.viewing`)
- event `notify`: `{ items, summary, unread }`
- `site.open` answers `notify: 'ask'` when the shell should ask the question.

Site calls (`site.call`): `notifications.unread`, `.follow`, `.unfollow`, `.follows`, the `notifications` event
(`site.on`), and `since` (at most 1000 records a call). All of them reach only the app's own instance list,
whatever instance the page names.

`npm run perf` runs `perf/notifications.mjs` (50 watched places, nothing happening: memory and CPU over a few
minutes) and appends a line to `perf/history.jsonl`. `node perf/turn.mjs [runs] [--public]` measures a turn.

## Circles

`engine/circles.js` wraps hypergraph's circles (5 copies of each space) for the shell only: `site.call` refuses
`circles.*` and `holding.*` with `UNKNOWN_METHOD`.

| Message | Answer |
|---|---|
| `circles.list` | `[{ key, name, members, holders, total, role }]` |
| `circles.create { name }`, `circles.join { link }` | `{ key, name, holding }` |
| `circles.invite { key }` | `{ link, expires }`: one use, 7 days; owner and admins; `CIRCLE_FULL` at 50 |
| `circles.members { key }` | `[{ identity, name, role, you, holds, share, used }]` |
| `circles.rename { key, name }` | |
| `circles.setRole { key, identity, role: 'admin' \| 'member' }` | |
| `circles.remove { key, identity }`, `circles.leave { key }` | |
| `holding.get` | `{ on, bytes, used, free }` |
| `holding.set { on, bytes? }` | `bytes` at least 0.1 GB, at most free disk + held − 2 GB, else `TOO_BIG` |

The `circles` event fires 300 ms after a change: read the list again.

- `share` and `used` are a member's bytes across all their circles (null when not holding or not reported).
  `total` is the circle's shares ÷ 5, null while none is known. The window's wording is in `shell/model.js`
  (`storageText`, `totalText`).
- **The list** is the setting `hyperbrowser/circles` (`{ [key]: true }`), written on create, join and leave,
  because `hg.spaces()` can't tell which spaces are circles until they are open.
- **Holding** runs while the engine runs. The first circle made or joined turns it on at 1 GB, unless the person
  set it before on this device (`<engine dir>/circles.json` `set`) or the disk lacks room.
  `holding.set { on: false }` deletes what is held.
- **Who holds**: from the circle's `hg/holder` records, the newest per device since the person's newest `left`
  (`holdsFrom`).
- **Rename**: hypergraph has no rename, so a `circle-name` record (`{ name }`) declared on the circle at
  create. The latest by a current owner or admin wins, else the name it was made with.
- **Share full**: checked every 30 s and after `holding.set`. The person is told once when what is held reaches
  the share (an item from app and place `hyperbrowser`), and again only after it went under 90%
  (`circles.json` `full`).

Site calls on a page's own space, sub-spaces and app instances (any other key is `NOT_ALLOWED`):

- `copies`, and `site.on { event: 'copies' }` when hypergraph's `copies` event changes them;
- `rotateKey`, `secure`, `trimHistory`, through `hg.space(key)` (the site handle has none); hypergraph allows
  owners and admins only.

When a place is renewed (here or on another of the person's devices), every app's instance list is updated to
its new key on hypergraph's `spaces` event, one pass at a time, and a call naming the old key reaches the new
place.

`npm run perf:circles [-- --people 49 --friends 10 --minutes 1]` measures 3 circles: the Configuration page's
reads (`circles.list` and each `circles.members`), the engine's idle CPU while holding, and inviting `--friends`
contacts one after another.

## Contacts

`engine/contacts.js`; how Contacts and Chat use it: [chat.md](chat.md). The shell's own messages, which no page
reaches: `contacts.me`, `contacts.get { identity }`, `contacts.request { identity, name }`, `contacts.list`,
`contacts.inviteToCircle { identity, circle }` → `true` (a friend only, else `NOT_FOUND`; owner and admins of
the circle), and `contacts.setMe { name?, findable? }` → `true`. A page goes through `site.call` and the
`contacts` permission (`NOT_ALLOWED` without it).

## Projects

`engine/projects.js` implements the `projects.*` site calls ([site-api.md](site-api.md#projects)), behind the
`projects` permission. Design: `specs/024-site-files/plan.md`.

- **A project** is a private SwarmFS files space linked both ways to a folder under `init { projects }` (the
  shell passes `Documents/HyperBrowser`; default `<engine dir>/projects`). The person's list is the setting
  `hyperbrowser/projects` (`{ [space key]: { name } }`); each device links the projects it holds to a folder of
  its own, on start and on `spaces` and `settings` events. `leave` writes `{ left: true }` there, so the
  person's other devices leave too. `.swarmfsignore` gets `.git/` and `node_modules/` before every link.
- **Paths**: a page reaches only what the project syncs (`inside()`): never `.git`, `node_modules` or ignored
  paths, in any case; `.hyperbrowser.json` is read-only. Windows short names (`GIT~1`) are refused, and the
  checks run again on the path as the disk resolves it (native realpath), so a link inside the project to `.git`
  is refused too. `remove` walks a folder itself: ignored paths stay, links are unlinked, never followed.
- **Built pages**: `projects.build` writes them to `<engine dir>/builds/<project key>/`, never into the project.
  A project file with the same path wins in the preview and in Publish. `leave` removes them.
- **Publish**: `site.json` is checked, then the files are copied into `<engine dir>/versions/<site>/<n>/`
  (unchanged files are hard links to the newest version; copies where links fail), then copied over the site's
  pages folder `<engine dir>/published/<site>/` (changed files only). Every Publish first waits until this
  device holds every page at its current version (read from SwarmFS's `held` records): otherwise a co-author's
  publish still arriving would turn the new files into conflict copies. A device publishing a site for the
  first time links that folder and waits up to 60 s for the pages already there (`BUSY` after). A roll back
  publishes an old version's files as a new version.
- **Co-authors** are SwarmFS `editor`s of the project. The site owner's engine makes each one an `admin` of the
  site (on the project's `members` event and after a Publish), and removes those taken off.
- **Preview**: a private site, never made public, whose key is kept in `<engine dir>/drafts.json`
  (`{ [project]: key }`). `site.open` and `site.read` on it read the project folder; its calls need no consent.
  A reset leaves it and makes a new one.
- **`openFolder`** takes a path, which the shell fills from the person's folder picker, never from the page.
- **`status`** reads `.git/HEAD` and `.git/index` (versions 2 and 3; size and mtime, as git's first check). It
  never runs git.
- `site.on { event: 'projects' }` tells `{ project }` on SwarmFS's sync events.

`npm run perf:projects [-- --files 1000]`: two devices, 1000 files of 1 KB written into a project, and the
times to sync and to publish.

## Errors that escape

An error nobody caught in the engine (a bug) doesn't stop it. The engine logs it with its stack (in the shell's
console as `engine: escaped error …`), tells the shell (`engine.error { message, code, method }`) and keeps
running. Without this, Bare would abort the engine and the app would quit. The shell writes it to its log and
tells the person once a session ([shell.md](shell.md)). The tests don't do this: there an escaped error fails
the test (on Bare its exit code is 3221226505, which is not a native crash).

## Heartbeat

The engine stops by itself if the shell sends no heartbeat for 6 s: on Windows, a crashed or killed shell gives
the engine no other sign.

## Notes

- The first time the engine goes online on Windows, Windows Firewall may ask about `bare.exe`. Allow it on
  private networks, or other devices on the network can't reach it directly.
- Tests: [CONTRIBUTING.md](../CONTRIBUTING.md#test).
