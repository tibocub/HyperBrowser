# The official forum (spec 006)

`sites/forum`: HyperBrowser's forum, a dynamic site on the site API ([site-api.md](site-api.md)). Invite-only while
testing; a fresh public forum replaces it at release. What members see and do: `sites/home/forum.hmd` (the
official site's "The forum" page). Spec, plan, data model and screenshots: `specs/006-forum/`.

## Publish it (owner)

```bash
npm run forum:publish -- --invite admin
```

It prints the forum's key and a one-use admin invite, and stays online (it is the forum's owner: keep its engine
folder, `~/.hyperbrowser` by default, `--dir` to choose). Paste the invite into your own HyperBrowser's address
field: you are an admin there, and make the boards and the next invites from the forum's Members page.
Publishing again (same folder, same engine folder) sends the edited pages and adds new record types.

## How it is made

- One page (`index.html`, `app.js`), hash routes (`#/b/<board>`, `#/t/<thread>`, `#/mentions`, `#/you`,
  `#/members`, `#/mod`, `#/new/<board>`, `#/board/<id>`), redrawn from live views of each record type.
- `lib/forum.js`: every write (boards, threads, replies with their mentions, votes, names, icons, moderation,
  invites, the person's read state); `lib/view.js`: sorting, the reply tree, folding, unread, scores (pure);
  `lib/text.js`: the post text subset, escape-first, and mentions (`@` + the member's key in the stored text);
  `lib/icon.js`: 16×16 1-bit icons (32 bytes), made from a key or drawn.
- Record types in `site.json` (`board`, `thread`, `comment`, `vote`, `mention`, `avatar`; names are SwarmFS's
  `profile`): see `specs/006-forum/data-model.md`. Only additions between versions.
- Read state, the sort and mentions seen: `hyper.mine` (the person's settings, on their devices). Bounded: one
  `read/<thread>` entry (~90 bytes) per thread read among the ones shown; entries of threads no longer shown
  (deleted, hidden, past the newest 500) are dropped once per visit, so at most ~45 KB of the site's 1 MB.
- Moderation and roles: hypergraph's (`moderateAction`, `report`, `reports`, `setRole`).

## Tests

`test/forum.test.js` runs `lib/` on the site API of engines on a local DHT (`siteApi()` in `test/helpers.js`
is the page's `window.hyper`): invite-only, boards, threads, the tree, votes, edit and delete, moderation,
sorting, unread across a restart, mentions, names and icons, and the text subset. Node and Bare.

## Limits (milestone 1)

- Live views hold the newest 500 threads, 2000 replies and 5000 votes of the forum (reply counts and scores
  of older threads come out short past that); a thread page holds 1000 replies.
- No private sub-forums (a staff room), no moving threads, no images uploaded with a post (pictures of the
  site only).
- Devices: your other devices come with HyperBrowser's device pairing (not built yet); the forum keeps
  nothing per device.
