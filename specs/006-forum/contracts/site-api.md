# Contract: site API and engine additions (006)

## `site.json`

```json
{ "title": "HyperBrowser Forum", "permissions": ["space"], "public": false, "types": { "thread": { "fields": { "title": "string" } } } }
```

- `public` (boolean, default `true`): `false` leaves the site invite-only.
- `types` (object, optional, dynamic sites): the site's record types, hypergraph's form. Recorded at the first
  publish; added on a later publish (additions only). `INVALID_MANIFEST` if not an object.

## `window.hyper.mine`

```js
await hyper.mine.all()               // { sort: 'top', 'read/abc': 1730000000000 }
await hyper.mine.set('sort', 'top')  // null removes
```

Engine: `site.call` with `method: 'mine.all'` / `'mine.set'` (`args: [name, value]`). Names are non-empty
strings up to 200 characters; values JSON. Stored as the person's setting `hyperbrowser/site/<key>/<name>`.

## CLI

`node engine/cli.js publish <folder> --invite member|admin` prints `invite: hg:…` (one use) after the key.
