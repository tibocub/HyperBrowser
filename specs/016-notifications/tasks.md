# Tasks: 016 — notifications

Written as the work went (one worker, steps 2 to 5 of plan.md's Order; step 1, hypergraph's `space.since()`, was
done before). One commit per step.

## Step 2: engine

- [x] `engine/manifest.js`: `notifications` checked as data (at most 16; `type` declared; `me`, `text`, `{field}`
  in `open` name fields of that type; `text` or `says` (≤ 60); `open` starts with `#`; unknown fields refused).
- [x] `engine/notifications.js`, in the style of `engine/contacts.js`: watches copied to settings at the yes (R2),
  cursors (`since`) and items in `<engine dir>/notifications.json`, written only when changed, atomically, after
  what they passed was told; read state per R4; history isn't news (R6); friend requests (R7).
- [x] `engine/index.js`: `site.permit` takes `notifications`; `notify.state`, `notify.set`, `notify.read`, the
  `notify` event; clean-up at `instances.leave` and at uninstall (`site.keep false`); watches refreshed at each open.
- [x] `test/notifications.test.js`: two engines through `start(ipc)`, no site view.

## Built differently

- **No `blocked` field** in `hyperbrowser/notify/app/<app>`: the answer in `hyperbrowser/permissions` is the one
  truth (a block is a no; `notify.set { app, allow }` writes it, as `site.permit` does). The app's watches stay
  in its setting through a block, so an unblock needs no reopening; an uninstall removes them.
- **Items carry `log` (16 hex) and `seq`** besides data-model's fields, for the read marks. The read mark is the
  *next unread* seq (`read` if `seq < mark`).
- **A place whose history is still arriving is checked every second** until complete, not only on its next change:
  otherwise the first message after it completes was taken for history.
- **The launch's catch-up is a window of one turn (20 s)**: what is found in it is told once, at its end, as one
  summary (or one item). A real message right after a launch waits for the end of that window.
- **A block also drops the app's cursors**: an unblock starts from then, like a first yes (no backlog).
- **Contacts**: app id `contacts`, place `contacts`, allowed unless `permissions.contacts.notifications === false`.
  An answered request leaves the list. Their "cursor" is the set of incoming identities already told.
- **`init { notifyTurn }`** (tests and perf, as `grace`): the turn length.

## Not built

- Clock-ahead and late-arrival tests are hypergraph 021's (`space.since()` never reads stamps); a patched
  `Date.now` here doesn't reach hypergraph's stamper, so this suite tests a restart's catch-up instead.
- A record whose content was dropped here (budgets) notifies with no text ("New message"); no `get()` to fetch it.

## Step 3: turns (US5, R3)

- [x] Chats (the app `apps.set` names) held with `space.hold()`, up to 24; the other places in turns, 2 at a time,
  `turn` ms each (20 s), checked at the end of their turn and woken by their changes meanwhile. With 2 places or
  fewer in turns they simply stay held.
- [x] `perf/turn.mjs`: from a stopped engine's start to the notification of a record written while it was away
  (an upper bound on a turn: it includes the engine's own start). 2026-11-11, this PC:
  - test DHT, 5 runs: min 0.6 s, median 1.7 s, max 1.8 s.
  - public DHT, low load, 3 runs: 9.0 s, 13.5 s, 21.9 s.
  - **20 s is enough most of the time, not always**: one public run in three took 21.9 s. A place missed in its
    turn isn't lost (its cursor stays), it is found in the next round: worst case two rounds, about 9 minutes for
    50 places, still under SC-003's 10. Kept at 20 s; 30 s would make a round of 50 places about 6.5 minutes.
- The turns test can't prove the rotation is what reaches the places: on a local DHT hypergraph keeps the few
  spaces open anyway (64 open). It proves the timing bound.

## Step 4: shell

- [x] The question "Let X notify you?" right after the identity question (`ask()` chains it; `site.open` says
  `notify: 'ask'` when identity was a yes before and this one was never answered).
- [x] `hyper.notifications.viewing(instance | null)` (site preload → `site` ipc op `viewing`). The frame acts on it
  only while that tab is current and the window focused; main sends `notify.read { place, app }` and the engine
  refuses a place that isn't that app's. Seen there is read, and its popup isn't shown.
- [x] Counter (`#bell`) between the bookmark star and `#state`; its list (one row per conversation, newest first);
  desktop icon counts (the app's, or an instance icon's own); popups (one per conversation, replaced by its newest;
  a catch-up: one); the tray mark (a red square, and the tooltip's count).
- [x] Configuration window (menu → Configuration…): per app Allowed / Blocked / Hide text, per conversation Mute;
  the tray setting and Devices moved there from the drop-down.
- [x] Self-test: viewing can't mark another app's conversation read (fails in the control run), viewing marks its
  own, a page can't read notifications (`viewing` only; `notify.*` refused). Frame check: 9 checks on scripted
  notifications (counter, icon counts, rows, tray mark, read, Configuration, Blocked, popups).

Built differently:
- **The engine's `site.open` answers `notify: 'ask'`**, an additive field, so the shell knows when to ask without
  another message.
- **`notify.read` takes an optional `app`**: with it the engine checks the place is one of that app's instances.
  That is the guard behind `viewing` (the shell's control run leaves it out).
- **"A page can't read notifications" isn't a shell guard**: no page call reaches `notify.*` (the preload has no
  such call, and the engine's site methods are a fixed list). The self-test checks it, but it passes in the control
  run too: there is no guard to turn off.
- **Popups use Electron's `Notification`**, with `app.setAppUserModelId('org.hyperbrowser.app')` in an installed
  build (the installer's id). No balloon fallback: to add if Tibo's check by hand shows nothing.

## Step 5: apps, docs, perf

- [x] Chat: `notifications` permission, watches `message` (`text`) and `invite` (says "invited you to a group");
  `viewing(<conversation>)` when one opens.
- [x] Forum: `notifications` permission, watch `mention` (`me: who`, says "mentioned you", `open: #/r/{on}`);
  `viewing(<forum>)`; the `#/r/<id>` route opens a thread, or a comment's thread.
- [x] Docs: `site-api.md`, `shell.md`, `engine.md`, `chat.md`, `forum.md`.
- [x] `perf/notifications.mjs`, `npm run perf`, `perf/history.jsonl` (hypergraph's shape; scenarios
  `notifications.idle.memory`, `notifications.idle.cpu`, size 50).

Not built:
- `#/r/<comment>` opens the comment's thread at its top, not scrolled to the comment.
- The forum's `#/r` route and Chat's `viewing` call have no automated test (app UI code); the engine side does.
- Chat and Forum must be published again (`apps:publish`, Tibo) before their watches reach anyone.
- SC-005, `npm run perf` 2026-11-11 (Node, this PC, test DHT, 3 minutes idle, Ann gone so nothing happens): Bob's
  engine alone in a fresh process, 209 MB before watching; while watching 50 places it never went above it (growth
  −74 to −2 MB: start-up garbage freed). CPU in the second half: median 3.1 % of one core, max 7.5 % (the turns).
  With the places' peers online the memory would be higher (replication): not measured.
