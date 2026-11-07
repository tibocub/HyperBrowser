# Contract: the frame's messages, and `site.state`

## Frame → main: `window.frame.send(op, args)` (IPC channel `frame`)

Accepted only from the frame's own view; any other sender gets `{ error: { code: 'NOT_ALLOWED' } }`.

| op | args | does |
|---|---|---|
| `open` | `{ input }` | a full key or `hg:` link: opens a tab (or selects the one open); else `{ error: { code: 'INVALID_KEY' } }` |
| `select` | `{ id }` | makes tab `id` current |
| `close` | `{ id }` | closes a site tab (not `0`) |
| `back` · `forward` · `reload` | | on the current site tab |
| `bookmark` | | toggles a bookmark icon for the current site |
| `icon.open` | `{ id }` | opens an icon's site (a preset with no key: `{ error: { code: 'NOT_PUBLISHED' } }`) |
| `icon.move` | `{ id, col, row }` | moves an icon (swaps with one already there) |
| `icon.kind` | `{ id, kind }` | `installed` or `bookmark` |
| `icon.remove` | `{ id }` | |
| `settings` | `{ theme?, accent? }` | |
| `window` | `{ act }` | `minimize`, `maximize` (toggles restore), `close` |
| `cover` | `{ full }` | `true` while a frame menu is open: the frame covers the window |
| `bars` | `{ height }` | the bars' height in px (the frame measures itself) |

## Main → frame: `frame-state`

```js
{ current, tabs: [{ id, key, title, icon, status, error, canBack, canForward, loading, state }],
  desktop: { icons }, settings, identity, open /* site tabs */, ready, maximized }
```

## Engine: `site.state`

Request `{ key }` (an opened site) → `{ complete: boolean, peers: number }`. `complete`: the site's space and
its pages' space are both complete (hypergraph `isComplete()`). `peers`: peers connected on the site's space.
Errors: `INVALID_KEY`, `NOT_FOUND` (not opened).
