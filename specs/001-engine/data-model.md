# Data model: 001

## site.json (at the site's root)

```json
{ "title": "HyperBrowser", "entry": "index.html", "icon": "icon.png", "permissions": ["space"] }
```

| Field | Rule |
|---|---|
| `title` | string, 1–200 characters after trimming; required |
| `entry` | a relative path inside the site (no `..`, no leading `/`, no `\`); default `index.html` |
| `icon` | optional, same path rule |
| `permissions` | optional array of strings; `space` = dynamic (the API for its own space); others ignored |

Invalid: not JSON, not an object, a bad field → `INVALID_MANIFEST` with what is wrong. Missing → `NO_MANIFEST`.
At publish, `entry` (and `icon`) must exist in the folder.

## Published folder → site

No table: SwarmFS's links (`sfs.links()`), a link to a pages sub-space whose parent is the site (research R2).

## Identity answers

Setting `hyperbrowser/identity`: `{ [siteKey]: true | false }` (person's settings, all devices).

## Engine state (memory only)

- `sites`: key → `{ site (SwarmFS Site), manifest, scope (hg.scope handle, once allowed) }`
- `subs`: id → stop function (live views and event listeners), each tied to its site key

## Path rule (site.read)

`path` is decoded, split on `/`; empty, `.` or `..` segments, `\`, or NUL → `NOT_FOUND`. `''` → the entry.
