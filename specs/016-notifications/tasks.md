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
