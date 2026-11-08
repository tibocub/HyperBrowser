# Contract: instances in the site API and the engine (009)

## `window.hyper` (the app's page)

```js
const mine = await hyper.instances.list()
// [{ key, name, role, public }]: the person's instances of this app (made or joined), on any of their devices
const f = await hyper.instances.create('Woodworkers', { public: false })   // → { key, name }; the person is owner
const g = await hyper.instances.join('hg:…')     // an instance's invite or public link → { key, name }
await hyper.instances.leave(f.key)               // dropped here and from the list; membership stays

const forum = hyper.instance(f.key)              // every call of `hyper`, on that instance
await forum.put('thread', { title: 'Hello' })
forum.query('thread').live(render)
forum.subspace(subKey)                           // one of the instance's sub-spaces
await forum.info()                               // { key, name, ..., app: '<app key>' }

new URLSearchParams(location.search).get('instance')   // the instance a link opened, or null
```

- `hyper` itself stays the app's own space (unchanged). `hyper.mine` is per app (all instances).
- Errors: `NOT_ALLOWED` (not an instance of this app, or not listed: create or join it first; consent refused);
  `INVALID_PARAMS` (name not 1–200 characters, `public` not a boolean, not a link); `INVALID_KEY`;
  `INVITE_*` (hypergraph's refusals of a link); `TOO_BIG` (over 1000 instances of one app).
- `join` of a link to a site or to another app's instance: `NOT_ALLOWED`, and this device leaves that space again
  if it wasn't held before.
- One consent per app covers its instances.

## Engine messages (protocol v1, additions only)

| Message | Params | Result |
|---------|--------|--------|
| `site.call` / `site.live` / `site.on` | new optional `instance` (key) next to `sub` | as today, on the instance |
| `site.call` `method: 'instances.list'` | — | `[{ key, name, role, public }]` |
| `site.call` `method: 'instances.create'` | `args: [name, { public }]` | `{ key, name }` |
| `site.call` `method: 'instances.join'` | `args: [link]` | `{ key, name }` |
| `site.call` `method: 'instances.leave'` | `args: [key]` | `true` |
| `site.open` | `{ key }`: a key or link of an instance | `{ key: <app key>, instance: <key>, manifest: <app's>, dynamic }` |

- `instance` is checked by the engine: listed for the app the view shows (`key`, set by the shell) **and** its
  `site` record names that app. The shell passes the page's `instance` as it passes `sub` (data from the page,
  checked in the engine; the site key never comes from the page).
- Additions only: a v1 shell that never sends `instance` works as before; no version bump.

## `site.json` (unchanged)

Any dynamic site may make instances; its `types` are the instances' types. An app should be public (its code
must load for everyone; an instance carries its own privacy).

## CLI

`node engine/cli.js publish <folder> --instance "HyperBrowser" [--invite admin]`: after publishing the app,
creates an instance of it owned by this engine's identity (once: the same folder and engine folder reuse it),
prints `instance: <key>` and, with `--invite`, an invite to the instance.
