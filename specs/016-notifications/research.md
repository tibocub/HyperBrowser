# Research: 016 — notifications

Read in the code on 2026-11-11, not run, unless a line says otherwise.

## R1. Knowing what is new (FR-005): a cursor per log, from hypergraph

**Decision**: a small hypergraph addition first (`requests-to-hypergraph.md` B7): `space.since(cursor, { types })` →
`{ records, cursor }`. The `change` event only wakes the engine up; the cursor is the truth.

**Why**: a record id is `{ log, seq }` (`lib/encodings.js`), and a log only ever grows. "Everything past seq 41 in
Ann's log" needs no clock: a message written at 10:00 and received at 12:00 is found, and a clock far ahead silences
nothing. It survives restarts and suits a phone waking for seconds.

**Alternatives rejected**:
- Stamps (`query().since()`): misses late arrivals, and a future stamp silences what follows.
- `change` events alone: they fire only while the engine listens. `Hypergraph.open` opens the kept-open spaces before
  the engine can attach, so a start loses records; a crash loses what wasn't shown.
- Remembering the ids of `latest(N)`: no hypergraph change, but anything older than the window is lost, and N records
  with future stamps push real ones out: a cheap way to silence a conversation.

**Worked around**: nothing. Constitution IV: the gap goes to the library. It also helps every app ("what's new since
I last looked"), and the forum panel's dots need it.

## R2. Where watches live

An app's code and `site.json` aren't read while it's closed. When the person says yes, the engine copies the app's
watches and title into the person's settings; each later open of the app refreshes them (a new version may change
them). So watching needs no app opened, on any device of the person.

## R3. Keeping spaces online

`hg.pin()` was the first idea, but a pin follows the person to every device, phones included. `space.hold()` keeps a
space open on this device only, so the engine holds. A `Space` is a plain event emitter: listening doesn't open it.

Limits (`lib/network.js`): at most `maxOpen` (64) open, of which `maxAnnounced` (32) announce; the others only look up
peers. Plan: hold chats up to 24; the other places take turns, 2 at a time, 20 s each. 50 places, 26 of them in turn:
about 4.5 minutes. To measure first: whether 20 s is enough to connect on the public DHT.

## R4. Read state without clocks

Same trick as R1: per place, the highest seq read in each log, at most 64 logs (the most recent), merged log by log
when two devices write. One setting per place, about 2 KB at most. A notification is read if its `seq` is below its
log's mark. A stamp here would reintroduce the late-arrival bug.

## R5. "Is the person looking at it?"

The shell knows the tab but not which conversation Chat shows inside it. The page says so:
`hyper.notifications.viewing(instance)`. The shell only believes it for that page's own app, and only while that tab is
current and the window focused. So a page can silence itself and nothing else. Seen and focused means read: no
separate "mark as read" call.

## R6. History isn't news

Joining a group downloads its past. Until a place is first complete here, and at a first yes, the cursor advances
silently (US4.3). After that, a burst from a space catching up counts as a catch-up, not a popup each.

## R7. Friend requests

Not records: `engine/contacts.js` keeps them in the person's settings. The engine makes these notifications itself,
named Contacts, with no permission question, since it's HyperBrowser's own feature. They can be blocked like any app.

## R8. System popups

`tray.js` uses `displayBalloon` on Windows. Clicks must open the right place, so `Notification` with its `click`
event is preferred. Unverified: an unpackaged Windows build may need `app.setAppUserModelId`. Check by hand first;
fall back to the balloon, which opens the list.

## R9. Measuring

HyperBrowser has no `perf/`. Add one scenario (`perf/notifications.mjs`, `npm run perf`, a committed
`perf/history.jsonl`, same shape as hypergraph's) for SC-005. `since` gets its own scenario in hypergraph.
