# Implementation Plan: 017 — forum panel (and Chat's marks)

**Branch**: `017-forum-panel` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

Spec 016's engine gains three things: "dot" watches (something new, no notification), runtime watches for follows, and
a page call reading its own app's unread counts. It also releases a forum's handle once no page uses it. The forum page
gets the two left columns, join and leave, board dots, and thread unread marks found with `since()` instead of dates.
Chat gets list numbers, a "New messages" line and a "…" menu per message. No hypergraph change.

## Technical Context

**Language/Version**: JavaScript (ESM), Node ≥ 22 and Bare ≥ 1.27; Electron 42.
**Primary Dependencies**: hypergraph/next (`space.since()`, 021), SwarmFS. Nothing new.
**Testing**: brittle (`npm test`, `npm run test:bare`), `npm run test:sandbox`, `npm run framecheck`, `npm run perf`.
**Target Platform**: Windows and Linux desktop.
**Constraints**: sites are strangers; `site.json` fields can't change once released (016's are published: additions
only).
**Scale**: 50 joined forums, 500 threads shown per forum (today's cap), follows: 100 per person.

## Constitution Check

- I. Sites are strangers: a page reads counts and adds follows for its own app's places only; each guard has a
  control-run check. ✅
- II. Test-first: engine through `start(ipc)`; forum and chat logic in their `lib/` (pure, tested); real-page
  checks in the self-test. ✅
- III. Node and Bare: engine changes only in `engine/notifications.js` and `engine/index.js`. ✅
- IV. Compose: `since()` and `instances.*` as they are. ✅
- V. Smallest: page loads, not instant switching (Q2); dots computed from what the page already loads. ✅

## Research (decisions)

- **R0 Measure first.** Switching forums is a page load. Time it on a forum with 500 threads: click to first draw
  with threads. Under 1 s: go on. Over: stop and report (Q2 is re-decided with Tibo).
- **R1 Releasing a forum.** Today `engine/index.js` keeps each instance's handle (`s.instances`) until the app's tab
  closes, and the handle keeps the space open. Once an instance has no subscription left, its handle is closed after
  30 s unless used again. A page load (the subscription fix) then lets the old forum go.
- **R2 Dots: a `dot` watch.** `site.json` watch entries gain `"show": "dot"` (default: a notification). A matching
  record only sets that place's dot: no list entry, no popup. The dot clears when the app's page says it's viewing the
  place (016's `viewing`). Checked in turns like notifications (Q3). Forum declares dot watches on `thread` and
  `comment`; Chat needs none (its numbers are notifications).
- **R3 Follows: runtime watches.** `hyper.notifications.follow({ place, type, where, by, popup })` adds a watch for
  one of the app's own places; `unfollow(id)`, `follows()`. Stored in the person's settings
  (`hyperbrowser/notify/follow/<app>`), at most 100 per app, shown in the list with a popup only when asked. Engine
  matching grows from `me` to `where: { field: value }` and `by: identity`. A board follow is `{ type: 'thread',
  where: { board } }`; a person, `{ type: ['thread', 'comment'], by }`.
- **R4 Reading counts.** `hyper.notifications.unread()` → `{ [place]: { count, dot } }` for the app's own places only,
  and an event when they change. The panel's numbers and dots, Chat's list numbers, and Chat's "New messages" line
  (the `count` last messages from others) come from it.
- **R5 Thread unread by numbers (Q7).** The forum page calls `since()` on its own open forum (added to the engine's
  site calls) from a cursor kept in `hyper.mine`; the threads of the records it returns join an "unread threads" set,
  also in `mine`, and opening a thread removes it. Board dots come from that set. Replaces the `read/<id>` stamps.
  Shortcut: a cursor is ~60 bytes per log and a `mine` value is capped at 64 KB, so forums of more than ~1,000
  writing members need the cursor split, or kept by the engine. Noted in the docs.
- **R6 Replies notify.** Posting a reply also writes a `mention` for the parent's author, unless it is oneself. App
  change only; 016's mention watch does the rest.
- **R7 Panel UI.** Forums from `hyper.instances.list()` (as the start page). The collapsed state in `hyper.mine`,
  and collapsed by default under 700 px wide. "+" opens the start page's join and make forms in a dialog. Leave asks
  for confirmation; an owner gets Q4's warning, with or without admins named (from `members()`).
- **R8 Chat.** List numbers from R4; on opening, the "New messages" line above the first unread message (R4's count),
  else the end, through `lib/scroll.js`; Edit and Delete behind a "…" button (a `<details>` or a button with a small
  menu, keyboard reachable).

## Contracts (additions)

```json
{ "type": "thread", "says": "posted a thread", "show": "dot" }
```

```js
hyper.notifications.unread()                         // { [place]: { count, dot } }, own app's places only
hyper.notifications.on(fn)                           // counts changed
hyper.notifications.follow({ place, type, where, by, says, popup })  // → { id }; own app's places only
hyper.notifications.unfollow(id)
hyper.notifications.follows()                        // this app's
hyper.since(cursor, opts)                            // hypergraph's, on the page's own space or instance
```

Engine messages: none new for the shell; `notify.state` items gain `popup: false` for quiet follows.

## Project Structure

```text
engine/notifications.js   dot watches, follows, unread for one app, release hooks
engine/index.js           since in CALLS; notifications.* site calls; instance handles released (R1)
engine/manifest.js        "show" in a watch
shell/site-preload.cjs    hyper.notifications.unread/on/follow/unfollow/follows; hyper.since
shell/frame.js            no popup for quiet items
sites/forum/              columns, collapse, join/leave dialog, board dots, unread by since, reply mentions, follows
sites/chat/               list numbers, New messages line, "…" menu
test/                     notifications.test.js, instances.test.js (release), forum.test.js, chat.test.js
shell/main.js self-test   own-app guards (control run), Chat's line in a real page
perf/notifications.mjs    50 forums with dot watches: memory and CPU idle
docs/                     site-api.md, forum.md, chat.md, engine.md
```

## Order

0. R0 measurement (stop if over 1 s).
1. Engine: R1, R2, R3, R4, `since` on the site API. Tests first.
2. Forum: R5, R6, R7, follows UI.
3. Chat: R8.
4. Docs, perf, self-test and frame checks.

One worker, one commit per step.

## Risks

- R5's `mine` cap on very big forums (noted, shortcut).
- `site.json`'s new `show` field is permanent once published: reviewed by the lead before the worker builds step 2.
