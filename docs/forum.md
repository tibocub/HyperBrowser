# The forum app and the official forum (specs 006, 009)

`sites/forum`: HyperBrowser's forum **app**, a dynamic site on the site API ([site-api.md](site-api.md)). Anyone
makes forums with it (its **instances**, spec 009): each forum is a space of its own, owned by whoever made it;
the app's author has no say in it. The **official forum** is Tibo's instance, "HyperBrowser" (invite-only while
testing). What members see and do: `sites/home/forum.hmd` (the official site's "The forum" page). Specs:
`specs/006-forum/` (the forum), `specs/009-federated-apps/` (instances).

## Publish it (owner)

```bash
npm run forum:publish -- --invite admin
```

It publishes the app (public: its code loads for everyone), makes the "HyperBrowser" forum with it the first time
(the same one after), names it the app's official forum, and prints the app's key, the forum's key (`instance:`)
and a one-use admin invite **to the forum**. It stays online (it owns the app and the forum: keep its engine
folder, `~/.hyperbrowser` by default, `--dir` to choose). Paste the invite into your own HyperBrowser's address
field: the app opens on the forum, you are an admin there, and make the boards and the next invites from its
Members page. Publishing again (same folder, same engine folder) sends the edited pages to **every** forum made
with the app, and adds new record types (each forum gets them when its owner or an admin opens it).

The preset's forum icon (`shell/preset.json`) holds the official forum's key (the `instance:` line), not the
app's: opening a forum's key or link opens the app on it.

## How it is made

- `?instance=<forum key>` says which forum the page shows; with none, the start page: your forums, the
  official one (the app's `official` record, written by `publish --instance`), make a forum, join one by link.
- One page (`index.html`, `app.js`), hash routes (`#/b/<board>`, `#/t/<thread>`, `#/mentions`, `#/you`,
  `#/members`, `#/mod`, `#/new/<board>`, `#/board/<id>`), redrawn from live views of each record type.
- `lib/forum.js`: every write (boards, threads, replies with their mentions, votes, names, icons, moderation,
  invites, the person's read state); `lib/view.js`: sorting, the reply tree, folding, unread, scores (pure);
  `lib/text.js`: the post text subset, escape-first, and mentions (`@` + the member's key in the stored text);
  `lib/icon.js`: 16×16 1-bit icons (32 bytes), made from a key or drawn.
- Record types in `site.json` (`board`, `thread`, `comment`, `vote`, `mention`, `avatar`; names are SwarmFS's
  `profile`): see `specs/006-forum/data-model.md`. Only additions between versions.
- The left columns (spec 017): your forums (this app's instances), each with a number (unread mentions and
  replies) or a dot (new posts since you last opened it), from `hyper.notifications.unread()` and `.on()`; it
  collapses (remembered in the app's `mine`, `panel`; collapsed by default under 700 px). "+ Join or make" opens
  the start page's two forms; each forum's "…" menu has Leave (confirmed; the owner is warned that without an admin
  nobody can make boards or moderators any more). Switching forums is a page load (measured: 0.1 to 0.35 s with 500
  threads), so the forum left is released and closes later. Then the open forum's boards, with dots.
- Unread (spec 017 R5): by message numbers, never by dates. The page calls `hyper.since()` on its forum from a
  cursor kept in the forum's `mine` (`cursor`); the threads of the records found (others' threads and replies)
  join `unread` (`{ [thread]: [ids of its new replies] }`, at most 300 reply ids in all, pruned to the threads
  shown). Opening a thread removes it; its new replies stay marked while it is shown. A board has a dot when one of
  its threads is unread. Two values in the forum's `mine` (`cursor`, `unread`), the sort and mentions seen: the
  person's settings, on their devices, each forum's apart. Shortcut: a cursor is ~60 bytes per writing member, and
  a `mine` value at most 64 KB: a forum of more than ~1,000 writing members needs it split, or kept by the engine.
- **The read state of spec 006 is dropped**: the old `read/<thread>` stamps are removed at the first open of each
  forum. That first open starts from "now": what was there reads as read, and only what arrives after is marked.
- Moderation and roles: hypergraph's (`moderateAction`, `report`, `reports`, `setRole`).

## Copies and Change key (spec 018)

Each forum's **…** in the forums column says "Kept by N of 5 copies, M online" (`hyper.instance(k).copies()`, read
when the menu opens) once your circles keep it, with "Few copies online: people may not get this while you're
offline" under 2 online. **Change key** (`rotateKey()`) shows on a private forum you own. Note: the Forum makes
public and invite-only forums, not private (encrypted) ones, and its boards are records inside a forum, not spaces
of their own: so "private boards" have no copies line of their own, and Change key shows on no forum it makes today.

## Notifications (spec 016)

The forum's `site.json` watches `mention` records naming the person ("mentioned you"); a click opens `#/r/<record>`,
which opens that thread, or a comment's thread (at its top). Each forum calls `hyper.notifications.viewing(<forum>)`
while shown. Forums are checked in turns with the other non-chat places: a mention may arrive a few minutes late.
Spec 017: a reply also writes a `mention` for the author of what it answers (not for oneself), so replies notify
like mentions. Two `"show": "dot"` watches (`thread`, `comment`) give the forums column its dots. Follows: "Follow"
on a board's header (its new threads) and next to each member in Members (their threads and replies); "You follow"
on You lists them, with a Popup switch and Unfollow. A follow is a dot and a list entry, a popup only if switched
on; its entry opens the post (`#/r/{id}`). Publish again (`npm run forum:publish`) for all this to reach people.

## Tests

`test/forum.test.js` runs `lib/` on a forum made with the app, through the site API of engines on a local DHT
(`siteApi(e, app).instance(forum)` in `test/helpers.js` is the page's `window.hyper.instance(...)`): invite-only, boards, threads, the tree, votes, edit and delete, moderation,
sorting, unread across a restart, mentions, names and icons, and the text subset. Node and Bare.

## Limits (milestone 1)

- Live views hold the newest 500 threads, 2000 replies and 5000 votes of the forum (reply counts and scores
  of older threads come out short past that); a thread page holds 1000 replies.
- No private sub-forums (a staff room), no moving threads, no images uploaded with a post (pictures of the
  site only).
- Devices: your other devices come with HyperBrowser's device pairing (not built yet); the forum keeps
  nothing per device.
