# Contracts: 016 — notifications

Additive: an app without any of this behaves as today.

## `site.json`

```json
{
  "permissions": ["space", "notifications"],
  "notifications": [
    { "type": "message", "text": "text" },
    { "type": "mention", "me": "who", "says": "mentioned you", "open": "#/r/{on}" }
  ]
}
```

Fixed once released (constitution V). Invalid → `INVALID_MANIFEST`. Without the `notifications` permission the list is
ignored.

## Site API

```js
hyper.notifications.viewing(instanceKey | null)   // what this page shows now
```

Nothing else: a page can't read notifications or settings. The shell ignores it unless the instance belongs to this
page's app, and acts on it only while that tab is current and the window focused.

## Engine messages (shell only)

| Message | Params | Result |
|---|---|---|
| `notify.state` | | `{ items, unread: { total, byApp, byPlace }, apps }` |
| `notify.set` | `{ app, allow?, hide? }` or `{ place, mute }` | `true` |
| `notify.read` | `{ place }` | `true` |
| `site.permit` (exists) | `permission: 'notifications'` | `true` |

Event `notify`: `{ items, summary: { count } | null, unread }`. `summary` is set for a catch-up.

The permission question comes right after the identity question, at the app's first open.

## hypergraph (B7)

```js
const { records, cursor } = await space.since(cursor | null, { types: ['message'], limit: 500 })
// null: from now on, records empty. records: creations past the cursor, in no particular order.
```
