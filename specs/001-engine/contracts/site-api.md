# Contract: the site API (`window.hyper`, dynamic sites only)

A static site's page has no `window.hyper`. A dynamic site's page (`site.json` `permissions: ["space"]`) has:

```js
await hyper.put('profile', { name: 'dave' })          // every call returns a promise
await hyper.get(id)                                   // { record, deleted }
const { items, complete } = await hyper.query('profile').by(someone).latest(20)
const stop = hyper.query('profile').live(({ items, complete }) => render(items), { limit: 20 })
const off = hyper.on('change', ({ types, records }) => {})   // change, peers, members, decisions, status
await hyper.info()                                    // { key, name, parent, private, ..., identity }
const sub = hyper.subspace(subKey)                    // the same calls on one of its sub-spaces
stop(); off()                                         // stop a live view, a listener
```

Every Space method of hypergraph's site handle (`hg.scope`, `docs/next/api.md` "A site's handle") except
`addProtocol` and `memberConnections`; sync getters (`subspaces`, `status`, `peers`) return promises here.
Errors reject with an `Error` whose `code` is hypergraph's. Fields of kind `bytes` arrive as `Uint8Array`.

The first call asks the person "let this site use your identity?"; the answer is remembered for the site.
No: every call rejects with `NOT_ALLOWED`.

A page may pass a key anywhere: it never changes which space it reaches (the shell names the site).
Reads answer at once: before the site's records arrived, `items: []` and `complete: false`; a live view
fires again once they arrive.
