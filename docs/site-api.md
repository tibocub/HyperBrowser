# Writing a site for HyperBrowser

A site is a folder: pages, scripts, styles, images, and a `site.json` at its root.

```json
{ "title": "My site", "entry": "index.html", "icon": "icon.png", "permissions": ["space"] }
```

## site.json

| Field | |
|---|---|
| `title` | required |
| `entry` | the first page; default `index.html` |
| `icon` | optional; a path inside the site. A 16×16 1-bit picture fits the look |
| `description` | optional; shown in the Apps store |
| `permissions` | `"space"` makes a **dynamic** site; without it the site is **static**. Also `"notifications"`, `"contacts"`, `"projects"` (below) |
| `public` | default `true`. `false` makes the site **invite-only** |
| `types` | a dynamic site's own record types |
| `notifications` | what HyperBrowser watches for while the app is closed ([below](#notifications)) |

- **Invite-only** sites let in only people with an invite: an admin makes one with `hyper.createInvite()` (or
  `publish --invite`); it is an `hg:` link pasted in the address bar. Public can't be undone.
- **Types** use hypergraph's form (hypergraph's `docs/next/api.md`, "Types"). They are recorded when the site is
  first published; publishing again may only add (new types, new fields at the end). SwarmFS's type names
  (`profile`, `file`…) are taken.

```json
{ "title": "Forum", "permissions": ["space"], "public": false,
  "types": { "thread": { "fields": { "title": "string", "text": "text" } } } }
```

## What a page can load

Pages load from `hyper://<site key>/`: use relative links (`style.css`, `docs/a.html`). Nothing else loads: no
web (`https://`), no other site, no files of the computer. Each site has its own storage and cookies.
WebAssembly works (`WebAssembly.instantiateStreaming(fetch('app.wasm'))`), in the same sandbox as scripts.

## The look

HyperBrowser's theme (system, light or dark) is your pages' `prefers-color-scheme`. A page with no stylesheet at
all (no `<style>`, no `<link rel="stylesheet">`) gets HyperBrowser's default theme (`shell/ui/theme.css`): the
official site's fonts, colours, light and dark, links, buttons and dithered background. A HyperMD site built
without a `style.css` looks like the official site. Add any stylesheet and the page is yours alone.

The default theme:

- A page is at most 1140px wide.
- **An app** fits the window instead: `<body class="hb-app">`. The page never scrolls as a whole; the body's
  child is a column that fills it. Give the parts that should scroll `overflow: auto` and `min-height: 0`.
- Scrollbars are a dithered track and a white box.
- Buttons keep 2px free on their right and below for their shadow, so a pressed button never covers its
  neighbour.

## Static sites

Scripts run as on the web, without any HyperBrowser API (`window.hyper` is undefined).

## Dynamic sites: `window.hyper`

The hypergraph API for your site's own space (hypergraph's `docs/next/api.md`, "A site's handle"). Every call
returns a promise.

```js
const me = await hyper.info()                         // { key, name, identity, ... }
const post = await hyper.put('profile', { name: 'dave' })
const { record } = await hyper.get(post.id)
const { items, complete } = await hyper.query('profile').by(me.identity).latest(20)
const stop = hyper.query('profile').live(({ items, complete }) => render(items))
const off = hyper.on('change', ({ records }) => {})   // change, peers, members, decisions, status
const sub = hyper.subspace(key)                       // one of your site's sub-spaces
const { records, cursor } = await hyper.since(null)   // what was created since a cursor
stop(); off()
```

- **Consent**: the first call asks the person "let this site use your identity?" once. After a no, calls fail
  with `NOT_ALLOWED`.
- **Reads answer at once**: right after a visitor opens your site, a list may be empty with `complete: false`.
  Show it as loading and keep a live view: it fires again when records arrive.
- **Lifetime**: live views and `on` listeners last as long as the page. A real load (`location.search = …`, a
  link to another page, a reload, closing the tab) stops them all. A hash change (`location.hash`,
  `history.replaceState`) isn't a load: they keep running.
- **Errors** are plain objects `{ name: 'HyperError', code, message }`, not `Error`s; `code` is `NOT_ALLOWED`,
  `NOT_FOUND`, `INVALID_TYPE`… Bytes fields are `Uint8Array`.
- The official forum (`sites/forum`) is a full example: [forum.md](forum.md).

### `hyper.mine`: the person's own data

The person's data for your site, kept in their settings on their devices, never in your site's space and out of
other sites' reach. `await hyper.mine.all()` → `{ name: value }`; `await hyper.mine.set(name, value)` (`null`
removes; names up to 200 characters, values JSON). Use one name per thing (read state, a chosen sort, a draft) so
each write stays small. A value is at most 64 KB and the site's names and values at most 1 MB as JSON; over that,
`TOO_BIG`.

### `hyper.since(cursor, { types, limit })`

The records created past `cursor`, by what this device received (message numbers, never dates: a reply received
late still counts), with the next cursor. `null` starts from now (no records). Keep the cursor in `hyper.mine` to
know what is new since the last visit. At most 1000 records a call (the default limit; more is
`INVALID_PARAMS`): call again with the new cursor while you get a full batch. A cursor is about 60 bytes per log
(one per writing member and device).

### Copies, keys and history

- `hyper.copies(key?)` → `{ wanted, kept, online }`: how many copies of a space the person's circles keep
  ("Kept by N of 5 copies, M online"; warn while `online < 2`). `wanted: 0` means no circle holds it. Call it on a
  handle (`hyper.copies()`, `hyper.subspace(k).copies()`, `hyper.instance(k).copies()`) or with a `key`: your
  site's space, one of its sub-spaces or one of your app's instances; any other key is `NOT_ALLOWED`.
  `hyper.on('copies', (c) => {})` on a handle: that space's copies changed.
- `hyper.rotateKey()`: a private space's (or instance's) new content key from now on, for a lost device or a
  suspected leak. By a member who may decide or moderate (`NOT_ALLOWED` otherwise, and on a public space).
- `hyper.instance(k).secure({ forget? })` → `{ key }`, "Secure this place": a new content key now, then the place
  is renewed with new keys and a new address its members follow by themselves. Removed and banned people can no
  longer see who joins, writes or when. `forget: true` also deletes everything written before now. Owners and
  admins of a private instance only (`NOT_ALLOWED` otherwise, on a public space or a sub-space);
  `ALREADY_RENEWED` if another admin renewed it first (its message names them). The app's instance list and a page
  still on the old key follow by themselves (`info().key` is the new one).
- `hyper.instance(k).trimHistory({ before })`: records written before `before` (ms since 1970) are deleted on
  every member's device and every copy the circles keep; copies others already took can't be recalled. Owners
  and admins, any instance.
- After a renewal, `info()` has `moved`, `movedTo` (null for someone left behind: show "you no longer have
  access") and `renewal` (`{ from, waiting }`). `status().warnings` has `RENEW_WAITING` while the device that
  secured it must stay open (until another admin's device has joined).

These work on your own space, sub-spaces and app instances only, behind hypergraph's owner and admin checks.

### `hyper.circles.join(link, name?)`

Offers a circle's invite to the person. Only HyperBrowser joins, after a click on your page and their yes →
`{ joined: true | false }`. `name` is shown as the invite's. Limit: `hyper.instances.join` with a circle's link is
refused (`NOT_ALLOWED`) and the circle left at once, but the link's one use is spent (hypergraph can't tell a
circle's link before redeeming it).

## Apps with instances

Your site is the **app** (the code); each **instance** is one community run by it (one forum, one club): a space
of its own, owned by whoever created it. You, the app's author, have no say in an instance you didn't create.
Every instance runs the code you publish, so a fix reaches all of them.

```js
const list = await hyper.instances.list()                  // [{ key, name, role, public }]: the person's
const f = await hyper.instances.create('Woodworkers')      // { key, name }: invite-only, they are its owner
const p = await hyper.instances.create('Open club', { public: true })   // public for good
const g = await hyper.instances.join(link)                 // an instance's invite or public link (hg:...)
await hyper.instances.leave(f.key)                         // gone from this device and the list

const forum = hyper.instance(f.key)          // every call of `hyper` above, on that instance
await forum.put('thread', { title: 'Hello' })
forum.query('thread').live(render)
const link = await forum.createInvite({ role: 'member' })  // pasted in HyperBrowser, it opens your app on it
new URLSearchParams(location.search).get('instance')       // the instance a link opened, or null
```

- An instance has your `site.json` types. Types a new version adds reach it when its owner or an admin opens it;
  until then, writing a new type there is `INVALID_TYPE`.
- Your app reaches only the instances made with it or joined through it: any other key, link or space is
  `NOT_ALLOWED`. The person's "use your identity?" answer covers your app and all its instances.
- `hyper` itself stays your site's own space. `hyper.mine` is the app's; `hyper.instance(key).mine` is that
  instance's, apart from the others, all under the app's one 1 MB cap. Leaving an instance drops its names.
- Keep the app itself public (leave `public` out): its code must load for everyone. Each instance has its own
  privacy.
- Instances the person joined stay on their device until they leave them; at most 1000 per app (`TOO_BIG`).
- `node engine/cli.js publish <folder> --instance "<name>" [--invite admin]` also makes an instance owned by the
  publisher. If your app declares an `official` type
  (`{ "fields": { "instance": "string" }, "put": { "permission": "decide" } }`), the instance is recorded there,
  for your start page to show (the forum does).

## People: friend requests and chats

Any dynamic site may offer "add friend" or "message" next to a person's identity (as `author` or
`info().identity` give it). HyperBrowser does the work; your site never sees the person's contacts.

```js
await hyper.people.request(identity, 'Bob')   // HyperBrowser asks the person, showing the name and the key;
                                               // a no: NOT_ALLOWED
hyper.people.chat(identity)                    // Chat on your conversation with them (Contacts if not a friend)
hyper.people.contact(identity)                 // their page in Contacts
```

`chat` and `contact` work only while the person is clicking on your page (in a click handler); otherwise they
resolve `false` and open nothing.

## Apps: install or open another site

Any dynamic site may offer another site to install or open (the Apps store does). HyperBrowser does it, with its
own question; your site never installs anything by itself.

```js
await hyper.apps.installed(key)   // true if this site (or an app's instance) is installed here
await hyper.apps.install(key)     // HyperBrowser asks "Install "<the site's own title>"?": true once installed;
                                  // a no: NOT_ALLOWED
await hyper.apps.open(key)        // the site in a tab of its own: true
```

- `install` and `open` work only during a click on your page; otherwise they resolve `false`. The question names
  the site by its own `site.json` title, never your page's words. Installing is the desktop's install.
- `key`: a 52-character site key (`INVALID_PARAMS` otherwise). A site nobody serves gives the error of opening it.
- `installed` answers only about the keys it is given (not the person's list) and needs no click.

## Notifications

Your app's code doesn't run while it is closed, so `site.json` says, as data, what HyperBrowser should watch for
in your app's instances. Nothing to run.

```json
{
  "permissions": ["space", "notifications"],
  "types": { "message": { "fields": { "text": "text" } }, "mention": { "fields": { "who": "string", "on": "link" } } },
  "notifications": [
    { "type": "message", "text": "text" },
    { "type": "mention", "me": "who", "says": "mentioned you", "open": "#/r/{on}" }
  ]
}
```

A watch has:

| Field | |
|---|---|
| `type` | one of your types |
| `text` **or** `says` | the field shown, or a fixed phrase of at most 60 characters |
| `me` | optional: only records whose field holds the person's identity |
| `open` | optional: where in your app a click goes (`#...`); `{field}` is replaced by that field, URL-encoded, `{id}` by the record's id |
| `show` | optional: `"dot"` only puts a dot on the instance: no notification, no popup |

At most 16 watches. Anything else is refused (`INVALID_MANIFEST`): these fields can't change once released.
Without the `notifications` permission the list is ignored.

- The person is asked once, right after the identity question ("Let "<title>" notify you?"), and can change it
  on the Configuration page (block the app, mute one conversation, hide the text).
- What notifies: records **created** after the yes, by someone else, by what this device received (a message
  written offline and received late still notifies). Not: the person's own records, an edit, the history of a
  conversation just joined, a deleted, hidden or banned author's record.
- Text is plain, cut to 200 characters; the app's name is its `site.json` title.
- A click opens your app on that instance (`?instance=<key>`), with `open`'s `#...` after it.

```js
hyper.notifications.viewing(instanceKey)   // what your page shows now (or null): not notified, counted as read
```

Call it when you show one of your instances, and with `null` when you show none. HyperBrowser believes it only
for your own app's instances, and only while your tab is current and the window focused.

Your page can read its own app's counts and add follows, for your app's instances only (never the person's
notifications themselves or their settings):

```js
await hyper.notifications.unread()      // { [instance]: { count, dot } } for every instance of your app
const stop = hyper.notifications.on((counts) => {})   // the same, each time it changes
const { id } = await hyper.notifications.follow({ place, type: 'thread', where: { board }, says: 'new thread', open: '#/r/{id}' })
await hyper.notifications.follows()     // [{ id, place, type, where?, by?, says | text, open?, popup }]
await hyper.notifications.unfollow(id)
```

- `count`: the unread notifications there (watches without `show`); `dot`: something new since the person last
  viewed it (a `"dot"` watch or a follow matched). Dots are kept per device.
- A follow is a watch added at runtime for one instance (`place`): the same fields as a `site.json` watch (no
  `me`, no `show`); `type` one type or a list; `where: { field: value }` (at most 4, equal values); `by: <member
  key>`; `popup` (default `false`). It gives a list entry and a dot, never a number. At most 100 per app across
  the person's devices; leaving the instance drops its follows. It works only while the person allows your app's
  notifications.
- These need the `notifications` permission (else `NOT_ALLOWED`).

## Contacts

A site that lists `"contacts"` in `permissions` may read and change the contacts once the person allowed it ("Let
X see and manage your contacts?"):

`hyper.contacts.me()`, `setMe({ name, findable })`, `list()`
(`[{ identity, name, state: 'friend' | 'incoming' | 'outgoing', chat, at }]`), `request(identity, name)`,
`accept`, `decline`, `remove`, `rename(identity, name)`, `link()` (a one-use contact link), `add(link)`, `on(fn)`
(the list may have changed).

Without the permission: `NOT_ALLOWED`. Only HyperBrowser's own Contacts and Chat ask for it: a site that asks is
asking for the person's whole social graph. Design: `specs/013-contacts-chat/`; the apps: [chat.md](chat.md).

## Projects

A site that lists `"projects"` in `permissions` (an editor, such as the IDE) may work on the person's projects
once allowed ("Let X edit and publish your projects?"); without it, `NOT_ALLOWED`. A **project** is a folder on
disk (`Documents/HyperBrowser/<name>`, editable with any tool) synced between the person's devices and
co-authors while online. Saving never publishes.

**The list**

- `hyper.projects.list()` → `[{ key, name, folder, site, role }]`: `site` is its published site's key or null;
  `role` is `owner` or `editor` (a co-author).
- `create(name)`, `openFolder()` (HyperBrowser asks the person to pick a folder, such as a cloned repo; the page
  never names a path; `CANCELLED` if they don't), `openCopy(siteKey)` (a site's published files as a new project,
  no posts or messages; publishing it makes a new site), `join(link)` (a co-author's invite) → the project.
- `leave(key, { deleteFiles })`: off the person's list on every device. The folder is kept unless `deleteFiles`
  (what the project syncs is deleted; `.git` stays).
- `hyper.projects.on(fn)` → stop: `fn({ project })` when a project's files changed here (a save, a co-author's
  edit, another device's).

**Files**, by paths inside the project (`css/site.css`):

- `files(key)` → `[{ path, size, mtime }]`; `files(key, { folders: true })` also lists folders
  (`{ path, folder: true }`, empty ones included).
- `read(key, path)` → `Uint8Array`; `write(key, path, textOrBytes)` (folders made as needed; 32 MB a write);
  `rename(key, from, to)`; `remove(key, path)` (a folder with what the project syncs in it; links in it are
  unlinked, never followed); `mkdir(key, path)` (`EXISTS` if something is there).
- Refused paths: `..`, absolute paths, Windows short names such as `GIT~1`, anything leading out through a link
  (`INVALID_PATH`, `NOT_ALLOWED`).
- Only what the project syncs is reachable: `.git`, `node_modules` (any case, any depth) and what
  `.swarmfsignore` lists are `NOT_ALLOWED` for every call, because git runs `.git/hooks` outside the sandbox.
  `.hyperbrowser.json` is read-only (only HyperBrowser writes it). `.swarmfsignore` always keeps `.git/` and
  `node_modules/`; each device keeps its own git.
- Two devices or people saving one file at once: both versions are kept, the other as
  `name (<who>'s copy).ext`.

**Building, previewing, publishing**

- `build(key, { 'x.html': html })` replaces the project's built pages, kept outside the project. Paths are
  `.html` inside the site; 64 MB in all. Preview and Publish use them wherever the project has no file of that
  name: the person's own file wins.
- `preview(key)` → `{ key }`: a draft site of the project's current files, on this device only. HyperBrowser
  shows it beside the page, in the same tab; calling it again (after a save) reloads it; `closePreview()` hides
  it. A dynamic app's draft gets its own throwaway space with no identity question: nothing reaches the real
  site or its data. `resetPreview(key)` → `{ key }`: a new, empty space.
- `publish(key)` → `{ site, created, version }`: the project's files (not `.swarmfsignore`, not
  `.hyperbrowser.json`) become the site's pages at once, as one version. The site is made on the first Publish
  (its key goes in the project's `.hyperbrowser.json`). A broken `site.json` (not JSON, an entry or icon that
  isn't there) is refused before anything is published (`INVALID_MANIFEST`, `NO_MANIFEST`).
- `versions(key)` → `[{ version, at }]`, newest first; `rollBack(key, version)` publishes that version again as a
  new version (the project's files stay as they are). Versions are kept per device: each device lists and rolls
  back to the versions it published.
- `status(key)` → `{ devices, coauthors, git }`: the devices and co-authors online now, and
  `{ branch, changed: [{ path, state: 'modified' | 'new' | 'deleted' }] }` read from `.git` without running git
  (null without one).

**Co-authors** edit the files and publish the site; they are its admins while they are in the project.

- `invite(key)` → `{ link }` (one use; the owner only); `inviteContact(key, identity)` (the link sent in the
  chat with that friend); `members(key)` → `[{ identity, name, role, you, removed, banned, online }]`;
  `removeMember(key, identity)` (the owner: they can no longer publish nor read new edits).
- A co-author's files reach your folder like your own (`package.json` scripts, editor settings): invite only
  people whose code you would run.

Limits: no read-only viewers yet (hypergraph H6). Co-authors of an invite-only site can't reach it by its key,
so can't publish it.
