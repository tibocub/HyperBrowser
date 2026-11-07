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
  a chosen sort, drafts: one name per thing, so each write stays small.
- The first call asks the person "let this site use your identity?" once; after a no, calls fail with
  `NOT_ALLOWED`.
- Reads answer at once: right after a visitor opens your site, a list may be empty with `complete: false`.
  Show it as "loading" and keep a live view: it fires again when records arrive.
- Errors have a `code` (`NOT_ALLOWED`, `NOT_FOUND`, `INVALID_TYPE`…). Bytes fields are `Uint8Array`.
- The official forum (`sites/forum`) is a full example: [forum.md](forum.md).
