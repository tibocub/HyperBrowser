# Data model: 006 — the official forum

Types in `sites/forum/site.json` (`types`), next to SwarmFS's (`profile`, `upload`, `site`...). Permanent:
later versions only add fields at the end and add types.

| Type | Fields | Rules |
|------|--------|-------|
| `board` | `name` string, `about` text, `parent` link → board, `order` int | put and edit: `decide` (owner, admins) |
| `thread` | `title` string, `text` text, `board` link → board | author edits |
| `comment` | `text` text, `on` link → thread or comment, `thread` link → thread | author edits |
| `vote` | `value` int (+1, −1, 0 = taken back), `on` link → thread or comment | one per member |
| `mention` | `who` string (a member's key), `on` link → thread or comment | index `who` |
| `avatar` | `icon` bytes (32: 16×16 bits, rows top down, high bit left) | one per member |

- Names: SwarmFS's `profile` (`name`, one per member), written by the forum.
- A deleted thread or reply is gone (`del`); a reply under it shows "(deleted)".
- Moderation is hypergraph's (`moderateAction`, `report`, roles): no type of ours.

## The person's own (`hyper.mine`, never in the space)

| Name | Value |
|------|-------|
| `sort` | `activity` \| `newest` \| `top` \| `lively` |
| `read/<thread id>` | the stamp of the thread's latest activity seen |
| `mentions` | the stamp of the latest mention seen |

## Derived on the device

- **Activity** of a thread: the newest of its stamp and its replies' stamps.
- **Score**: the sum of each member's latest vote.
- **Lively**: replies + votes of the last 48 hours.
- **Unread** thread: activity > `read/<id>` (or never read). **New** reply: stamp > the `read/<id>` value when the
  thread was opened.
