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
- Read state, the sort and mentions seen: the forum's `hyper.instance(key).mine` (the person's settings, on their
  devices; each forum's apart, under the app's one cap). Bounded: one
  `read/<thread>` entry (~90 bytes) per thread read among the ones shown; entries of threads no longer shown
  (deleted, hidden, past the newest 500) are dropped once per visit, so at most ~45 KB of the site's 1 MB.
- Moderation and roles: hypergraph's (`moderateAction`, `report`, `reports`, `setRole`).

## Notifications (spec 016)

The forum's `site.json` watches `mention` records naming the person ("mentioned you"); a click opens `#/r/<record>`,
which opens that thread, or a comment's thread (at its top). Each forum calls `hyper.notifications.viewing(<forum>)`
while shown. Forums are checked in turns with the other non-chat places: a mention may arrive a few minutes late.
Replies, follows and unread dots are the next spec (forum panel). Publish again (`npm run forum:publish`) for the
watch to reach people.

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
