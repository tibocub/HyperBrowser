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
  your app a click goes, `#...`; `{field}` is replaced by that field, URL-encoded). At most 16. Anything else is
  refused (`INVALID_MANIFEST`): these fields can't change once released. Without the `notifications` permission the
  list is ignored.
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
your own app's instances, and only while your tab is current and the window focused. That is all a page gets: it
can't read notifications or their settings.

## Contacts (spec 013)

A site whose `site.json` lists `"contacts"` in `permissions` may read and change the contacts, once the person
allowed it ("Let X see and manage your contacts?"): `hyper.contacts.me()`, `setMe({ name, findable })`, `list()`
(`[{ identity, name, state: 'friend' | 'incoming' | 'outgoing', chat, at }]`), `request(identity, name)`,
`accept`, `decline`, `remove`, `rename(identity, name)`, `link()` (a one-use contact link), `add(link)`,
`on(fn)` (the list may have changed). Without the permission: `NOT_ALLOWED`. Only HyperBrowser's own Contacts and
Chat ask for it; a site that asks is asking for the person's whole social graph. The whole design:
`specs/013-contacts-chat/`; the apps: [chat.md](chat.md).
