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

## Not built (yet)

- The shell's own-app guards for the new calls aren't in the self-test yet (step 4, with their control run).
  Only the 016 check's expected key list changed.
- `open` in a follow can name only fields of its types (no `{id}`): a followed thread's entry can't link to the
  thread itself yet.
- R1's shortcut: one call running longer than 30 s on an instance could find its handle closed (`CLOSED`).
