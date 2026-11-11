# Feature Specification: 016 — notifications

**Feature Branch**: `016-notifications`

**Created**: 2026-11-11

**Status**: Draft (decisions grilled with Tibo, 2026-11-11; to be reviewed before planning)

**Input**: Tibo: a centralized notification system, a bit like Android or Windows, so apps can be authorized to send
notifications; useful first for Chat and the forum. Direction across the next specs: hypergraph's `ROADMAP.md`,
decision of 2026-11-11.

## Clarifications

### Session 2026-11-11 (Tibo)

- Q1 When can a notification arrive → **whenever HyperBrowser runs, tray included**. An app's code can't run while it
  is closed (constitution I), so the app says in advance what to watch and the engine watches. Fully quit: nothing
  until the next launch, then a catch-up. Each app can be blocked.
- Q2 Which apps → **any app that asks**, once, remembered. Chat and Forum ask too: no exception for official apps.
- Q3 What triggers by default → Chat: every message. Forum: mentions and replies, not every new thread.
- Q4 Where → a small **counter between the address bar and the peers counter**, showing a list when clicked;
  **counters on desktop icons**; **system popups** when the window isn't focused; a **mark on the tray icon**.
- Q5 Popup text → shown, with a **"hide content" switch per app**.
- Q6 Several devices → reading on one device clears the others.
- Q7 More watched places than can stay connected → chats stay connected first, **the rest are checked in turn**. The
  same loop serves phones later.
- Q8 Catching up → one summary popup at launch; one popup per conversation in normal use.
- Q9 Settings → a **Configuration page**, opened from the menu, not more entries in the drop-down.
- Q10 Friend requests → **they notify too**, under Contacts: a request you don't see is a request lost.

## Words

- **Watch**: what an app declares it wants to be told about, such as "new messages in my conversations" or "records
  that mention me". Data only: no app code runs to evaluate it.
- **Notification**: one entry in the person's list, made by HyperBrowser from a record a watch matched.
- **Conversation** (here): the place a notification belongs to: a chat conversation, or a forum. Notifications of one
  conversation are grouped.
- **Blocked app**: an app the person said no to, or turned off. **Muted conversation**: one conversation silenced
  inside an app that is otherwise allowed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A message reaches me while Chat is closed (Priority: P1)

Ann writes to Bob. Bob has HyperBrowser running but Chat isn't open, maybe only the tray is. A system popup says
"Chat: Ann" with her text. Clicking it opens that conversation at the latest message.

**Why this priority**: it is the whole point. Without it, a chat you aren't looking at is silent.

**Independent Test**: two engines on a local DHT, no site view open on Bob's: Ann's message produces one notification
on Bob's engine, naming the app and the conversation.

**Acceptance Scenarios**:

1. **Given** Chat allowed and no Chat tab open, **When** Ann sends a message, **Then** Bob gets a notification and a
   popup.
2. **Given** the window hidden in the tray, **When** a message arrives, **Then** the popup shows and the tray icon is
   marked.
3. **Given** Bob is looking at that conversation in a focused window, **When** a message arrives, **Then** no popup
   and nothing is added to the counter.
4. **Given** Bob wrote the message himself, on any of his devices, **Then** no notification.
5. **Given** a popup, **When** Bob clicks it, **Then** HyperBrowser comes to the front on that conversation.

---

### User Story 2 - One place to see what's new (Priority: P1)

A small counter sits between the address bar and the peers counter. Clicked, it lists the latest notifications,
grouped by conversation, newest first. Desktop icons show their own count.

**Why this priority**: popups are missed; the list is what makes them reliable.

**Independent Test**: frame check with scripted notifications: the counter's number, the list's rows, an icon's
count, and all three going down once read.

**Acceptance Scenarios**:

1. **Given** 3 unread notifications from 2 conversations, **Then** the counter says 3, the list has 2 rows, and each
   app's desktop icon shows its share.
2. **Given** a row, **When** clicked, **Then** that conversation opens and its notifications count as read.
3. **Given** over 200 notifications, **Then** the list keeps the latest 200 and the counter shows a capped number.
4. **Given** an app with no icon on the desktop, **Then** its notifications still reach the counter and the list.

---

### User Story 3 - The person decides (Priority: P1)

An app declaring watches asks once: "Let Chat notify you?". The person can later block any app, mute one conversation,
or hide an app's text, on the Configuration page.

**Why this priority**: HyperBrowser runs strangers' apps; an app must not reach the person without their yes
(constitution I).

**Independent Test**: engine tests through its messages: no yes, nothing watched; a yes, watched; a block, watching
stops and nothing is counted.

**Acceptance Scenarios**:

1. **Given** an app that declares no watches, **Then** it is never asked about and can never notify.
2. **Given** the person refused, **Then** nothing is watched for it, and no space is kept online for it.
3. **Given** an allowed app, **When** the person blocks it, **Then** its notifications stop and its unread ones go.
4. **Given** a muted conversation, **Then** it produces no popup and adds to no counter; other conversations of that
   app still do.
5. **Given** "hide content" on, **Then** the popup and list say "New message", with no text.
6. **Given** an app's page, **Then** it cannot read the person's notifications, another app's, or these settings.

---

### User Story 4 - Coming back after a while (Priority: P2)

Bob's computer was off for a week. On launch he gets one popup, "500 new messages", and the list shows one row per
conversation. A message written while he was away but arriving late still counts.

**Why this priority**: without it, a launch is a wall of popups, or messages get lost silently.

**Independent Test**: an engine stopped, records written, engine started: one summary event, the counts right, no
popup per record.

**Acceptance Scenarios**:

1. **Given** many records since the last run, **When** HyperBrowser starts, **Then** one summary popup.
2. **Given** a message stamped earlier but only now received, **Then** it is notified, not lost behind a newer one.
3. **Given** a first-ever yes to an app, **Then** the records from before that yes don't notify.

---

### User Story 5 - More places than can stay connected (Priority: P2)

Bob is in 50 conversations and forums, more than can stay connected at once. Chats stay connected first; the others
are checked in turn, so a forum mention may arrive a few minutes late, but it arrives.

**Why this priority**: a person in many places must not silently lose notifications.

**Independent Test**: more watched spaces than the online limit, a record written in the one checked last: its
notification arrives within one full turn.

**Acceptance Scenarios**:

1. **Given** more watched places than the limit, **When** a record lands in one that isn't connected, **Then** it is
   notified within one turn.
2. **Given** a turn in progress, **Then** the place the person is viewing and the chats stay connected.

---

### User Story 6 - Several devices (Priority: P3)

Bob reads Ann's message on his laptop; his desktop's counter goes down too.

**Why this priority**: valuable, but a single device already works without it.

**Independent Test**: two devices of one identity: read on one, the other's count drops.

**Acceptance Scenarios**:

1. **Given** two devices, **When** one reads a conversation, **Then** the other's unread count for it clears once the
   person's settings reach it.
2. **Given** a block or a mute on one device, **Then** it applies on the other.

### Edge Cases

- **Clocks can't be trusted**: a peer with a clock far ahead must not silence later messages, and a late arrival
  stamped in the past must still notify (hypergraph: stamps are the author's).
- **A flood**: a member posting hundreds of records must not produce hundreds of popups. Popups collapse per
  conversation.
- **Text from strangers**: names and text are shown as plain text, cut to a length. The app's name is HyperBrowser's
  own (`site.json`'s title, as for every other question), never a value from a record.
- **Deleted or moderated records**: one removed before it was read leaves the list. A record from a banned author
  doesn't notify. An edit is not a new notification.
- **Leaving**: leaving a conversation or uninstalling an app removes its watches and notifications.
- **Partial holding**: a space being caught up may reveal many records at once: they count as a catch-up, not a popup
  each.
- **Silent members**: watching writes nothing in the space (hypergraph spec 016: a silent member costs nothing).
- **A device join** restarts the engine on another identity: the list follows the new identity.
- **Fully quit**: nothing arrives, and the next launch catches up.
- **No system popups available** (some Linux desktops): the counter and list still work.

## Requirements *(mandatory)*

### Functional Requirements

Watching:

- **FR-001**: An app MUST be able to declare, as data, the record types it wants watched, across its instances, with
  an optional condition "this field names me", and which field holds the text.
- **FR-002**: The engine MUST evaluate watches without running app code, while no view of the app exists.
- **FR-003**: A watch MUST NOT write to the watched space.
- **FR-004**: The person's own records MUST NOT notify them.
- **FR-005**: Detection MUST NOT depend only on record stamps being in order (see Edge Cases).
- **FR-006**: Watched spaces MUST be kept online within the engine's limit: the one in view and chats first, the
  others checked in turn until all have had one.
- **FR-007**: Chat MUST declare a watch on messages and on group invites. Forum MUST declare a watch on records
  mentioning the person.
- **FR-008**: A new incoming friend request MUST be a notification, under Contacts.

Permission and settings:

- **FR-009**: An app declaring watches MUST ask the person once; the answer is remembered on all their devices. Same
  rule for official apps.
- **FR-010**: The person MUST be able to block an app, mute a conversation and hide an app's text.
- **FR-011**: A Configuration page MUST be reachable from the menu, drawn by the shell, holding these settings. The
  tray setting and Devices move there.
- **FR-012**: A page MUST NOT be able to read notifications or these settings.

Showing:

- **FR-013**: A counter MUST sit between the address bar and the peers counter, opening a list grouped by conversation,
  keeping the latest 200.
- **FR-014**: Desktop icons MUST show their app's or conversation's unread count.
- **FR-015**: A system popup MUST appear when the window isn't focused, or when the person is on another tab; the tray
  icon MUST be marked while something is unread.
- **FR-016**: At launch, a catch-up MUST produce one summary popup; in normal use, popups MUST collapse per conversation.
- **FR-017**: Clicking a popup or a row MUST bring HyperBrowser forward on the exact place: the conversation, or the
  thread.
- **FR-018**: Names and text MUST be shown as plain text, limited in length.

Reading:

- **FR-019**: An app MUST be able to tell HyperBrowser that the person has seen a conversation of its own, and only of
  its own. Chat and Forum MUST do so.
- **FR-020**: Read state MUST reach the person's other devices, within a bounded size.

### Key Entities

- **Watch**: app, record type, optional "names me" field, text field.
- **Notification**: app, conversation, record, author's name, text, time, read or not. Local to the device, rebuilt
  from what is held.
- **Read state**: per conversation, how far the person has read; on all their devices.
- **Notification settings**: per app allowed or blocked and text hidden or shown; per conversation muted. On all their
  devices.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With both people online and the place connected, a notification appears within 5 seconds of sending.
- **SC-002**: With a closed app, 100% of matching records in a scripted run (late arrivals and clock-ahead authors
  included) produce a notification, and none of the person's own.
- **SC-003**: A place outside the online limit is notified within one full turn; with 50 watched places, under 10
  minutes.
- **SC-004**: A catch-up of 500 records produces exactly one popup.
- **SC-005**: With 50 watched places and nothing happening, the engine's memory grows by at most 200 MB, and adds no
  sustained CPU load (measured by a perf scenario).
- **SC-006**: The sandbox self-test proves a page can't read notifications or settings, or mark another app's
  conversation read; the same checks fail in its control run.
- **SC-007**: An app author adds notifications with data only: Chat's needs no background code.

## Assumptions

- Desktop only here. Android reuses the same watches and the same turn-based checking, with periodic wake-ups, in its
  own spec. No Google push.
- A message reaches Bob only if someone holding it is online. Circles and helpers (a later spec) improve that; this
  spec doesn't depend on them.
- No do-not-disturb of our own: the operating systems have one.
- Forum's "replies count as mentions", follows, dots and the joined list are the next spec (forum panel). Watches added
  at runtime, which follows need, are decided there; this spec must not rule them out.
- `site.json` fields can't change once released (constitution V): the plan's contract gets a careful review.
- Rule 3 and perf-on-change: if the plan needs a hypergraph change, it goes through hypergraph's forum scenarios and
  perf. HyperBrowser has no `perf/` folder; SC-005's scenario needs one, or a home in hypergraph's.
