# Writing a site for HyperBrowser

A site is a folder: pages, scripts, styles, images, and a `site.json` at its root.

```json
{ "title": "My site", "entry": "index.html", "icon": "icon.png", "permissions": ["space"] }
```

- `title` (required), `entry` (default `index.html`), `icon` (optional): paths inside the site.
- `permissions`: `["space"]` for a **dynamic** site; leave it out for a **static** site.
- `public` (default `true`): `false` makes the site **invite-only**: only people with an invite get in (an admin
  makes one with `hyper.createInvite()`, or `publish --invite`; it is an `hg:` link pasted in the address field).
- `types`: a dynamic site's own record types, in hypergraph's form (see hypergraph's `docs/next/api.md`,
  "Types"). Recorded when the site is first published; publishing again adds the new ones (only additions:
  new types, fields at the end). SwarmFS's type names (`profile`, `file`...) are taken.

```json
{ "title": "Forum", "permissions": ["space"], "public": false,
  "types": { "thread": { "fields": { "title": "string", "text": "text" } } } }
```

Pages load from `hyper://<site key>/`: use relative links (`style.css`, `docs/a.html`). Nothing else loads:
no web (`https://`), no other site, no files of the computer. Each site has its own storage and cookies.
WebAssembly works (`WebAssembly.instantiateStreaming(fetch('app.wasm'))`), in the same sandbox as scripts.

**The look.** HyperBrowser's theme (system, light or dark, in its menu) is your pages'
`prefers-color-scheme`. A page with no stylesheet at all (no `<style>`, no `<link rel="stylesheet">`) gets
HyperBrowser's default theme: the official site's fonts, colours, light and dark, links, buttons, and its
dithered background. A HyperMD site built without a `style.css` looks like the official site. Add any
stylesheet and the page is yours alone.

## Static sites

Scripts run as on the web, without any HyperBrowser API (`window.hyper` is undefined).

## Dynamic sites: `window.hyper`

The hypergraph API for your site's own space (see hypergraph's `docs/next/api.md`, "A site's handle"). Every
call returns a promise:

```js
const me = await hyper.info()                         // { key, name, identity, ... }
const post = await hyper.put('profile', { name: 'dave' })
const { record } = await hyper.get(post.id)
const { items, complete } = await hyper.query('profile').by(me.identity).latest(20)
const stop = hyper.query('profile').live(({ items, complete }) => render(items))
const off = hyper.on('change', ({ records }) => {})   // change, peers, members, decisions, status
const sub = hyper.subspace(key)                       // one of your site's sub-spaces
const { records, cursor } = await hyper.since(null)   // spec 017: what was created since a cursor (below)
stop(); off()
```

- `hyper.mine`: the person's own data for your site, kept on their devices (their settings), never in your
  site's space, out of other sites' reach: `await hyper.mine.all()` → `{ name: value }`,
  `await hyper.mine.set(name, value)` (`null` removes; names up to 200 characters, values JSON). For read state,
  a chosen sort, drafts: one name per thing, so each write stays small. Capped, since every device of the person
  keeps it: a value at most 64 KB and the site's names and values at most 1 MB, as JSON; over that, `TOO_BIG`.
- The first call asks the person "let this site use your identity?" once; after a no, calls fail with
  `NOT_ALLOWED`.
- Reads answer at once: right after a visitor opens your site, a list may be empty with `complete: false`.
  Show it as "loading" and keep a live view: it fires again when records arrive.
- Live views and `on` listeners last as long as the page: a real load (`location.search = …`, a link to another
  page, reload, closing the tab) stops them all, and the new page subscribes again. A hash change (`location.hash`,
  `history.replaceState`) isn't a load: they keep running.
- Errors have a `code` (`NOT_ALLOWED`, `NOT_FOUND`, `INVALID_TYPE`…) and a `message`; they are plain objects
  `{ name: 'HyperError', code, message }`, not `Error`s. Bytes fields are `Uint8Array`.
- The official forum (`sites/forum`) is a full example: [forum.md](forum.md).
- `hyper.since(cursor, { types, limit })` (spec 017, hypergraph's `since()`): the records created past `cursor`, by
  what this device received (message numbers, never dates: a reply received late still counts), with the next
  cursor. `null`: from now on (no records). Keep the cursor in `hyper.mine` to know what is new since the last
  visit. At most 1000 records a call (the default limit; more is `INVALID_PARAMS`): call again with the new cursor
  while you get a full batch. A cursor is ~60 bytes per log (one per writing member and device).
- `hyper.copies(key?)` (spec 018, hypergraph's `copiesOf`): `{ wanted, kept, online }`, how many copies of a space
  the person's circles keep ("Kept by N of 5 copies, M online"; warn while `online < 2`). `wanted: 0`: nothing is
  handed (no circle holding). On a handle (`hyper.copies()`, `hyper.subspace(k).copies()`,
  `hyper.instance(k).copies()`), or `key`: your site's space, one of its sub-spaces or one of your app's instances;
  any other key is `NOT_ALLOWED`. `hyper.on('copies', (c) => {})` (on a handle): that space's copies changed.
- `hyper.rotateKey()` (spec 018, hypergraph's `rotateKey`): a private space's (or instance's) new content key from
  now on, for a lost device or a suspected leak; by a member who may decide or moderate (`NOT_ALLOWED` otherwise,
  and on a public space). On your own space, sub-spaces and instances only.
- `hyper.instance(k).secure({ forget? })` (spec 023, hypergraph 027's `secure`): "Secure this place": a new content
  key now, then the place renewed: new keys and a new address its members follow by themselves; removed and banned
  people can no longer see who joins, writes or when. `forget: true` also deletes everything written before now. →
  `{ key }`, the new address. Owners and admins of a private instance (`NOT_ALLOWED` otherwise, and on a public
  space or a sub-space); `ALREADY_RENEWED` if another admin renewed it first (its message names them). The app's
  instance list and a page still on the old key follow by themselves (`info().key` is the new one).
  `hyper.instance(k).trimHistory({ before })` (hypergraph 027): records written before `before` (ms since 1970) are
  deleted on every member's device and every copy the circles keep; copies others already took can't be recalled.
  Owners and admins, any instance. `info()` gains `moved`, `movedTo` (null for someone left behind: show "you no
  longer have access") and `renewal` (`{ from, waiting }`); `status().warnings` has `RENEW_WAITING` while the
  device that secured it must stay open (until another admin's device has joined). These are site calls on the
  page's own app's instances only, behind hypergraph's owner/admin checks: no new power for a page.
- `hyper.circles.join(link, name?)` (spec 018): offers a circle's invite to the person; only HyperBrowser joins, after
  a click on your page and their yes (its notice the first time) → `{ joined: true | false }`. `name` is shown as
  the invite's ("the name comes from the invite"). Known limit: `hyper.instances.join` with a circle's link is
  refused (`NOT_ALLOWED`) and the circle left at once, but the link's one use is spent (hypergraph can't tell a
  circle's link before redeeming it).

## Apps with instances: communities anyone can start

Your site is the **app** (the code); each **instance** is one community run by it (one forum, one club), a
space of its own, owned by whoever created it. You, the app's author, have no say in an instance you didn't
create. Every instance runs the code you publish: a fix reaches all of them, nothing to do per instance.

```js
const list = await hyper.instances.list()                  // [{ key, name, role, public }]: the person's
const f = await hyper.instances.create('Woodworkers')      // { key, name }: invite-only, they are its owner
const p = await hyper.instances.create('Open club', { public: true })   // public for good
const g = await hyper.instances.join(link)                 // an instance's invite or public link (hg:...)
await hyper.instances.leave(f.key)                         // gone from this device and the list

const forum = hyper.instance(f.key)          // every call of `hyper` above, on that instance
await forum.put('thread', { title: 'Hello' })
forum.query('thread').live(render)
const link = await forum.createInvite({ role: 'member' })  // send it: pasted in HyperBrowser, it opens your app
                                                           // on that instance
new URLSearchParams(location.search).get('instance')       // the instance a link opened, or null
```

- An instance has your `site.json` types; types a new version adds reach it when its owner or an admin opens it
  (until then, writing a new type there is `INVALID_TYPE`).
- Your app reaches only the instances made with it or joined through it: any other key, link or space is
  `NOT_ALLOWED`. The person's "use your identity?" answer covers your app and all its instances.
- `hyper` itself stays your site's own space. `hyper.mine` is the app's; `hyper.instance(key).mine` is that
  instance's (read state of one forum), apart from the others, all under the app's one 1 MB cap; leaving an
  instance drops its names. Make your app public (leave `public` out of `site.json`): its code must load for
  everyone; each instance has its own privacy.
- Instances the person joined stay on their device until they leave them; at most 1000 per app (`TOO_BIG`).
- Publishing: `node engine/cli.js publish <folder> --instance "<name>" [--invite admin]` also makes an instance
  owned by the publisher (once; the same one after) and prints its key and an invite to it. If your app declares
  an `official` type (`{ "fields": { "instance": "string" }, "put": { "permission": "decide" } }`), it records that
  instance there, for your start page to show (the forum does).

## People: friend requests and chats, through HyperBrowser (spec 013)

Any dynamic site may offer "add friend" or "message" next to a person's key (an identity, as `author` or
`info().identity` give it). HyperBrowser does the work; your site never sees the person's contacts.

```js
await hyper.people.request(identity, 'Bob')   // HyperBrowser asks "send a friend request to "Bob" (key …)?"
                                               // a no: NOT_ALLOWED; the name is yours, the key is shown too
hyper.people.chat(identity)                    // Chat on your conversation with them (their page in Contacts
                                               // if they aren't a friend yet)
hyper.people.contact(identity)                 // their page in Contacts
```

`chat` and `contact` work only while the person is clicking on your page (in a click handler); otherwise they
resolve `false` and open nothing.

## Apps: install or open another site, through HyperBrowser (spec 014)

Any dynamic site may offer another site to install or open (the Apps store does). HyperBrowser does it, with its
own question; your site never installs anything by itself.

```js
await hyper.apps.installed(key)   // true if this site (a key, or an app's instance key) is installed here
await hyper.apps.install(key)     // HyperBrowser asks "Install "<the site's own title>"?" with its key:
                                  // true once installed (or already was); a no: NOT_ALLOWED
await hyper.apps.open(key)        // the site in a tab of its own: true
```

- `install` and `open` work only while the person is clicking on your page (in a click handler); otherwise they
  resolve `false` and do nothing. The question names the site by its own `site.json` title, never by your
  page's words; installing then is the desktop's install (kept whole, served to others, spec 004).
- `key`: a 52-character site key (`INVALID_PARAMS` otherwise). A site nobody serves: the error of opening it.
- `installed` tells your site about the keys it names only (not the person's list); it needs no click.

## Notifications: tell the person, even while your app is closed (spec 016)

Your app's code doesn't run while it is closed, so you say in `site.json` what HyperBrowser should watch for, as data;
it watches your app's instances (every conversation or forum the person is in) and tells the person. Nothing to run.

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

- A watch: `type` (one of your types), `text` (the field shown) **or** `says` (a fixed phrase, at most 60
  characters), `me` (optional: only records whose field holds the person's identity), `open` (optional: where in
  your app a click goes, `#...`; `{field}` is replaced by that field, URL-encoded; `{id}` by the record's own id,
  spec 017), `show` (optional, spec 017: `"dot"`: a match only puts a dot on that instance, no notification, no
  popup). At most 16. Anything else is refused (`INVALID_MANIFEST`): these fields can't change once released.
  Without the `notifications` permission the list is ignored.
- The person is asked once, right after the identity question ("Let "<title>" notify you?"), and can change it on
  the Configuration page (block your app, mute one conversation, hide your text). HyperBrowser's own apps ask too.
- What notifies: records **created** after the yes, by someone else, found by what this device received (never by
  their dates: a message written offline and received late still notifies). Not: the person's own records, an
  edit, the history of a conversation just joined, a deleted, hidden or banned author's record.
- Text is shown as plain text, cut to 200 characters; your app's name is its `site.json` title.
- A click opens your app on that instance (`?instance=<key>`), with `open`'s `#...` after it.

```js
hyper.notifications.viewing(instanceKey)   // what your page shows now (or null): not notified, counted as read
```

Call it when you show one of your instances, and with `null` when you show none. HyperBrowser believes it only for
your own app's instances, and only while your tab is current and the window focused. Seen, the instance's count and
dot clear.

Your page can read its own app's counts and add follows (spec 017). Only your app's instances, whatever your page
names; never the person's notifications themselves or their settings:

```js
await hyper.notifications.unread()      // { [instance]: { count, dot } } for every instance of your app
const stop = hyper.notifications.on((counts) => {})   // the same, each time it changes
const { id } = await hyper.notifications.follow({ place, type: 'thread', where: { board }, says: 'new thread', open: '#/r/{id}' })
await hyper.notifications.follows()     // your app's: [{ id, place, type, where?, by?, says | text, open?, popup }]
await hyper.notifications.unfollow(id)
```

- `count`: the unread notifications there (your watches without `show`); `dot`: something new since the person
  last viewed it (a `"dot"` watch or a follow matched). Dots are kept per device.
- A follow is a watch added at runtime, for one of your app's instances (`place`): the same fields as a `site.json`
  watch (no `me`, no `show`), `type` one type or a list, `where: { field: value }` (at most 4, equal values),
  `by: <member key>`, `popup` (default `false`). It is a list entry and a dot, never a number; a popup only with
  `popup: true`. At most 100 per app, on all the person's devices; leaving the instance drops its follows. It works
  only while the person allows your app's notifications, like your watches.
- These need the `notifications` permission in `site.json` (else `NOT_ALLOWED`).

## Contacts (spec 013)

A site whose `site.json` lists `"contacts"` in `permissions` may read and change the contacts, once the person
allowed it ("Let X see and manage your contacts?"): `hyper.contacts.me()`, `setMe({ name, findable })`, `list()`
(`[{ identity, name, state: 'friend' | 'incoming' | 'outgoing', chat, at }]`), `request(identity, name)`,
`accept`, `decline`, `remove`, `rename(identity, name)`, `link()` (a one-use contact link), `add(link)`,
`on(fn)` (the list may have changed). Without the permission: `NOT_ALLOWED`. Only HyperBrowser's own Contacts and
Chat ask for it; a site that asks is asking for the person's whole social graph. The whole design:
`specs/013-contacts-chat/`; the apps: [chat.md](chat.md).
