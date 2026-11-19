# The forum app and the official forum

`sites/forum` is HyperBrowser's forum **app**, a dynamic site on the site API ([site-api.md](site-api.md)).
Anyone makes forums with it: each forum is an **instance**, a space of its own owned by whoever made it; the
app's author has no say in it. The **official forum** is the "HyperBrowser" instance, invite-only while
testing. What members see and do: `sites/home/forum.hmd`. Design: `specs/006-forum/` (the forum) and
`specs/009-federated-apps/` (instances).

## Publishing it

```bash
npm run forum:publish -- --invite admin
```

This publishes the app (public: its code loads for everyone), makes the "HyperBrowser" forum the first time (the
same one after), names it the app's official forum, and prints the app's key, the forum's key (`instance:`) and
a one-use admin invite to the forum. It stays online: it owns the app and the forum, so keep its engine folder
(`~/.hyperbrowser` by default, `--dir` to choose). Paste the invite into your HyperBrowser's address bar: the app
opens on the forum with you as an admin, and you make the boards and the next invites from its Members page.

Publishing again (same folder, same engine folder) sends the edited pages to **every** forum made with the app,
and adds new record types (each forum gets them when its owner or an admin opens it).

The preset forum icon (`shell/preset.json`) holds the official forum's key, not the app's: opening a forum's key
or link opens the app on it.

## How it works

- `?instance=<forum key>` says which forum the page shows. Without it, the start page: your forums, the official
  one (the app's `official` record, written by `publish --instance`), make a forum, join one by link.
- One page (`index.html`, `app.js`) with hash routes (`#/b/<board>`, `#/t/<thread>`, `#/mentions`, `#/you`,
  `#/members`, `#/mod`, `#/new/<board>`, `#/board/<id>`), redrawn from live views of each record type.
- `lib/forum.js`: every write (boards, threads, replies with their mentions, votes, names, icons, moderation,
  invites, the person's read state).
- `lib/view.js`: sorting, the reply tree, folding, unread, scores (pure).
- `lib/text.js`: the post text subset, escape-first, and mentions (`@` plus the member's key in the stored text).
- `lib/icon.js`: 16×16 1-bit icons (32 bytes), made from a key or drawn.
- Record types in `site.json`: `board`, `thread`, `comment`, `vote`, `mention`, `avatar` (names use SwarmFS's
  `profile`); see `specs/006-forum/data-model.md`. Only additions between versions.
- Moderation and roles are hypergraph's (`moderateAction`, `report`, `reports`, `setRole`).
- Long words (an `hg:` link) wrap anywhere in posts, titles and names (`overflow-wrap: anywhere`); code blocks
  keep their own horizontal scroll.

### The forums column

The left column lists your forums (this app's instances), each with a number (unread mentions and replies) or a
dot (new posts since you last opened it), from `hyper.notifications.unread()` and `.on()`. It collapses
(remembered in the app's `mine` as `panel`; collapsed by default under 700 px). "+ Join or make" opens the start
page's two forms. Each forum's "…" menu has Leave (confirmed; the owner is warned that without an admin nobody can
make boards or moderators any more). Switching forums is a page load (0.1 to 0.35 s with 500 threads), so the
forum left behind is released and closes later. Below: the open forum's boards, with dots.

### Unread

Unread is counted by message numbers, never by dates. The page calls `hyper.since()` on its forum from a cursor
kept in the forum's `mine` (`cursor`). The threads of the records found (others' threads and replies) join
`unread` (`{ [thread]: [ids of its new replies] }`, at most 300 reply ids in all, pruned to the threads shown).
Opening a thread removes it; its new replies stay marked while it is shown. A board has a dot when one of its
threads is unread. The cursor, `unread`, the sort and the mentions seen are the person's settings, on their
devices, each forum's apart.

Limit: a cursor is about 60 bytes per writing member and a `mine` value at most 64 KB, so a forum with more than
about 1,000 writing members needs this split, or kept by the engine.

The first open of a forum removes old `read/<thread>` stamps from an earlier read-state format and starts from
"now": what was there reads as read.

## Notifications

The forum's `site.json` watches `mention` records naming the person ("mentioned you"); a click opens
`#/r/<record>`, which opens that thread, or a comment's thread at its top. A reply also writes a `mention` for
the author of what it answers (not for oneself), so replies notify like mentions. Each forum calls
`hyper.notifications.viewing(<forum>)` while shown. Forums are checked in turns with the other non-chat places,
so a mention may arrive a few minutes late.

Two `"show": "dot"` watches (`thread`, `comment`) give the forums column its dots. Follows: "Follow" on a board's
header (its new threads) and next to each member in Members (their threads and replies); "You follow" on the You
page lists them, with a Popup switch and Unfollow. A follow gives a dot and a list entry, a popup only if switched
on; its entry opens the post (`#/r/{id}`).

## Copies, Change key, Secure, Trim

Each forum's **…** in the forums column says "Kept by N of 5 copies, M online" (`hyper.instance(k).copies()`,
read when the menu opens) once the person's circles keep it, with "Few copies online: people may not get this
while you're offline" under 2 online.

For a forum's owner and admins:

- **Change key** (`rotateKey()`), on a private forum.
- **Secure this place…**, on a private forum: new keys now, and a new address members follow by themselves; a
  checkbox "Also delete history before now", off by default, with its warning. A short line says "Securing…",
  then "Secured." (plus "Keep HyperBrowser open until another admin's device has joined." while that is so).
  Errors are in plain words ("Already renewed by Ann."). After a ban, a dismissable notice suggests Secure once.
  A page or bookmark on the old address opens the forum at its new one; someone left out sees "You no longer
  have access to this forum".
- **Trim history…**, on any forum: keep the last N days, weeks, months or years, with a warning that copies
  others already took can't be recalled.

The forum app makes public and invite-only forums, not private (encrypted) ones, and its boards are records
inside a forum, not spaces. So Change key and Secure show only on private forums made elsewhere, and boards have
no copies line of their own.

## Tests

`test/forum.test.js` runs `lib/` on a forum made with the app, through the site API of engines on a local DHT
(`siteApi(e, app).instance(forum)` in `test/helpers.js` stands for the page's `window.hyper.instance(...)`):
invite-only, boards, threads, the tree, votes, edit and delete, moderation, sorting, unread across a restart,
mentions, names and icons, and the text subset. On Node and Bare.

## Limits

- Live views hold the newest 500 threads, 2000 replies and 5000 votes (reply counts and scores of older threads
  come out short past that); a thread page holds 1000 replies.
- No private sub-forums, no moving threads, no images uploaded with a post.
