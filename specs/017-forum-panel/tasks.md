# Tasks: 017 — forum panel (and Chat's marks)

Written as the work goes (one worker, plan.md's Order). One commit per step.

## Step 0: R0, switching forums measured

- [x] 2026-11-12, this PC (Electron 42, the self-test's engine, all data local, no peers): the forum app on a
  small forum (5 threads), then `location.search = '?instance=<other>'` (a page load, as the "All forums" link
  does) to forums of 500 threads and 100 comments. Click to the first thread drawn, and
  to all 500 drawn:
  - first switch to a 500-thread forum: 350 ms first threads, 434 ms all;
  - the next ones: 96 to 119 ms first threads, 97 to 215 ms all; to the small one: 63 to 78 ms.
  - **Under 1 s: Q2 stays a page load.** Not measured: a forum whose records are still arriving from peers.
  - Method: a temporary `--r0` mode in `shell/main.js` (not committed).

## Step 1: engine (R1, R2, R3, R4, `since`)

- [x] R1: an instance's handle no subscription uses is closed 30 s after its last use (`init { idle }` for
  tests); a call or a subscription on it cancels that; a subscription ending starts it again. `hosting` answers
  `handles` too (the handles kept), which is how the test sees it.
- [x] R2: `site.json` watches may say `"show": "dot"`: a match sets the place's dot, no notification. The dot
  clears at `notify.read` (the page's `viewing`).
- [x] R3: `hyper.notifications.follow / unfollow / follows`. A follow is a watch (same checks as `site.json`'s,
  `manifest.js` `watch(w, types, true)`) plus `place`, `type` (one or a list), `where { field: value }`, `by`,
  `popup`. In `hyperbrowser/notify/follow/<app>`, at most 100. Matched like the app's watches, with the same
  rules (allowed apps only, open or held places only, no app code).
- [x] R4: `hyper.notifications.unread()` and `.on(fn)`: `{ [place]: { count, dot } }` for every instance of the
  page's own app (the engine's list is the guard).
- [x] `hyper.since(cursor, { types, limit })` on the page's own space or instances (hypergraph's `since()`).
- [x] Tests (failed first): `test/instances.test.js` (handles released, `since`), `test/notifications.test.js`
  (show "dot", dots and counts, follows and their guards).

Lead review of step 1 (2026-11-12): `"show": "dot"` accepted as permanent. Added at the start of step 2: an `open`
template may use `{id}`, the matched record's own id (site.json watches and follows alike).

## Step 2: forum (R5, R6, R7, follows)

- [x] `{id}` in `open` (`manifest.js`, `notifications.js` `item()`; tests in `notifications.test.js`).
- [x] R5: `lib/forum.js` `catchUp()` (since() from the cursor in the forum's `mine`, `thread` and `comment`) and
  `saveUnread()`; `lib/view.js` `addNew`, `pruneUnread`, `without`. Unread = `{ [thread]: [new comment ids] }`,
  in `mine` (`cursor`, `unread`). The old `read/<id>` stamps are dropped at the first open: those threads read as
  read once, nothing is marked new until something new arrives.
- [x] R6: a reply writes a `mention` for the author of what it answers, unless it is oneself.
- [x] R7: the forums column (collapsible, remembered in the app's `mine` `panel`, collapsed under 700 px unless
  chosen), numbers and dots from `notifications.unread()`/`on()`, "+ Join or make" (the start page's forms), each
  forum's "…" menu with Leave (confirmed in place; an owner gets Q4's warning, with or without admins). The boards
  column on every page, with dots.
- [x] Follows: "Follow" on a board's header and next to each member; "You follow" on You, with Popup and Unfollow.
  A board: `{ type: 'thread', where: { board } }`; a person: `{ type: ['thread', 'comment'], by }`; both
  `open: '#/r/{id}'`.
- [x] `site.json`: dot watches on `thread` and `comment`.
- [x] Tests (failed first): `forum.test.js` (catchUp/saveUnread across a restart, a late reply by numbers, the
  cap, pruning; reply mentions).
- Checked by hand in Electron (a temporary mode, not committed; one person, 3 forums): the columns, Follow,
  the owner's leave warning, the join box, collapse kept across a reload, no console error. Dots and numbers
  from another person weren't seen on screen (the engine tests cover them).

## Step 3: Chat (R8)

- [x] List numbers from `notifications.unread()`/`on()`; the "New messages" line (`lib/scroll.js` `newLine`: above
  the first of the last `count` messages from others), scrolled into view once at opening; Edit and Delete behind
  one "…" per message (a `<details>`, kept open across redraws).
- [x] Test (failed first): `chat.test.js` `newLine`. The page itself: the self-test (step 4).
- Runs: Node 80/80 (132 s), Bare 80/80 (141 s), 2 jobs. (The run before had one Node failure: a quote typo in
  this test, edited while that run was going; fixed before it was committed.)

## Step 4: docs, perf, self-test, frame check

- [x] Docs: `site-api.md` (`since`, `show`, `{id}`, `unread`/`on`/`follow`/`unfollow`/`follows`), `forum.md` (the
  columns, unread by numbers, **the old `read/<id>` read state dropped**), `chat.md`, `engine.md`.
- [x] Shell: a quiet follow (`popup: false`) is listed, never popped up (`frame.js`).
- [x] Self-test, own-app guards, each failing in the control run (checked): a page can't read another app's counts,
  nor its follows, can't remove its follow, can't follow its places, doesn't hear its counts. The self-test's
  sites A and B now declare `notifications` and a `note` type (no watch: no question).
- [x] Self-test, Chat in a real page (SC-005), with a second person (Ann: a second engine in the shell's process,
  on a local test DHT the self-test now runs on, `hyperdht/testnet`): 30 messages read, 5 unread → the line above
  the 5, in view, not at the top; oldest at the top; sending goes to the end; for a group and a direct
  conversation. The "…" menu: Edit and Delete, its summary takes the keyboard focus.
- [x] Frame check: a quiet follow pops nothing up (fails without the `frame.js` change: checked).
- [x] `perf/notifications.mjs`: the watched app also has a dot watch.
- Runs (2026-11-12, this PC, 2 jobs): `npm test` 80/80 (127 s); `npm run test:bare` 80/80 (139 s);
  `npm run test:sandbox` 5/5 (46 asserts, 107 s; self-test 25 s, control run 37 s); `npm run framecheck` PASS;
  `npm run perf`: 192 MB before watching, memory growth at most −32 MB (SC-005: at most 200), CPU second half
  median 4.8 % of a core, max 6.2 %, 0 notifications. Appended to `perf/history.jsonl`.

## Built differently

- **A follow item is a list entry and a dot, never a number**: it doesn't count in `notify.state`'s `unread`, nor
  in `unread()`'s `count` (Q5). Items carry `popup` (`false` for a quiet follow); a quiet follow doesn't count
  toward the catch-up summary either.
- **Dots are this device's** (in `notifications.json`, like the cursors), not on all the person's devices.
- **`since` takes at most 1000 records a call** (the default limit; more is refused): call again with the cursor.
- **The app's own watches win over a follow** on the same record: a mention stays a number.
- **A follow needs no permission question of its own**: it waits, inert, until the person allows the app's
  notifications (as the app's own watches).
- The `notifications` calls need the app to declare the `notifications` permission (else `NOT_ALLOWED`).

## Not built

- Done since step 1: the self-test's own-app guards (step 4); `{id}` in `open` (step 2, asked by the lead).
- R1's shortcut: one call running longer than 30 s on an instance could find its handle closed (`CLOSED`).
- A forum not reachable yet isn't listed as "connecting": the column lists what `instances.list()` gives (the
  forums held here). A forum left on another device leaves the column at the next count change.
- SC-003 (a late reply marks its thread) is tested on the lib (a record stamped long ago) and rests on
  hypergraph 021's own late-arrival tests; no scripted two-engine run delays a reply's replication.
- SC-002 (after 20 switches only the visited forum stays open) isn't measured: the engine test checks the handles
  are let go; hypergraph closes an idle space after 120 s, and keeps up to 32 recent ones open anyway.
- Dots and numbers drawn on screen from another person's posts weren't seen by hand; the engine tests and the
  self-test's Chat check (numbers through `unread()`) cover them.
- Chat's line counts every unread notification of the conversation, invites too: with an unread invite the line
  sits one message higher.
- The R0 and look scripts were temporary modes of `shell/main.js`, not committed.
- The self-test now imports `hyperdht/testnet.js`, a dependency of hypergraph's (not in `package.json`): dev only.
- Chat and Forum must be published again (`apps:publish`, Tibo) before people see any of this.
