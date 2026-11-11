# Data model: 016 — notifications

## On all the person's devices (settings)

| Setting | Value |
|---|---|
| `hyperbrowser/permissions` (exists) | `{ [app]: { contacts, notifications: true \| false } }` |
| `hyperbrowser/notify/app/<app>` | `{ title, watches: [Watch], hide: bool, blocked: bool }` |
| `hyperbrowser/notify/mute/<place>` | `true`, or null once unmuted |
| `hyperbrowser/notify/read/<place>` | `{ [log, first 16 hex]: seq }`, at most 64 logs; merged by highest seq |

**Place**: the instance key of a conversation or forum.

**Watch** (from `site.json`, checked by `parseManifest`):
- `type` (required): a record type the app declares.
- `me`: a field that must equal the person's identity.
- `text`: the field holding the text, or `says`: a fixed phrase (at most 60 characters). One of the two.
- `open`: what to open, within the app, such as `#/r/{on}`. `{field}` is replaced by that field, URL-encoded.

At most 16 watches per app.

## On this device only (`<engine dir>/notifications.json`)

- `cursors`: `{ [place]: cursor }`: `since`'s cursor.
- `items`: latest 200 notifications: `{ app, place, id, type, author, name, text, open, stamp, at }`.
  `text` cut to 200 characters, `name` to 64. `at` is this device's clock, for sorting only.

Written after a batch, atomically (temp file, rename). A notification is shown before its cursor is saved, so a crash
can repeat one, never lose one.

## Rules

- Own records skipped (`author` = the person). Records the read no longer returns (deleted, hidden, banned) leave the
  list. An edit moves no cursor to a new notification: `since` returns creations only.
- Read: `seq` below its log's mark in the place's read setting.
- Blocked app: watches off, holds released, its items removed. Muted place: cursor advances, no item.
- Leaving a place or uninstalling an app removes its cursors, items, mute and read settings.
