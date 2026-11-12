# Feature Specification: 017 — forum panel (and Chat's marks)

**Feature Branch**: `017-forum-panel`

**Created**: 2026-11-12

**Status**: Draft (decisions grilled with Tibo, 2026-11-11 and 2026-11-12)

**Input**: Tibo: the forum needs a better way to join, leave and quickly change forums, see which are joined, and
counters for each, like Discord's left panel. Chat must open at the latest messages (or at a "new messages" line),
never jump to the start when sending, and show groups in the same order as one-to-one conversations. Builds on
spec 016 (notifications) and hypergraph's `space.since()` (021).

## Clarifications

### Session 2026-11-11 (Tibo, with spec 016)

- Joined list and quick switching, Leave, and forums left behind get closed.
- Forum notifications by default: mentions, replies and pings (ping = mention; a reply writes a mention for the
  parent's author).
- Follow a board (its new threads) or a person (their threads and comments).
- A dot means "new since you last opened it", cleared on opening. Numbers only for mentions and replies.
- Chat's conversation list gets the same marks, numbers counting unread messages.

### Session 2026-11-12 (Tibo)

- Q1 Layout → **two columns on the left, like Discord**: your forums, then the current forum's boards. The forums
  column **can be collapsed**.
- Q2 Switching → **a page load**, as today (safe since the subscription fix). Instant switching only if measured
  slow.
- Q3 Dots on forums not open → **within a few minutes** (checked in turns, as notifications), not instantly.
- Q4 Leaving a forum you own → **allowed, with a warning**: it lives on while members keep it; nobody can make boards
  or moderators unless you named an admin.
- Q5 Follows → buttons on a board's header and a person's profile, listed on "You" for unfollowing. A follow shows a
  dot, not a number; a popup only if turned on for that follow.
- Q6 Chat → reads its own unread counts (only its own conversations) and shows the marks. Also: it opens at the latest
  messages, or at a "new messages" line when some are unread; sending never moves to the start; groups and
  one-to-one conversations in the same order.
- Q7 Thread unread marks → **by message numbers, not dates** (spec 016's way), so a reply received late still marks
  its thread.
- Q8 Chat's Edit and Delete → **one discreet "…" button per message**, opening them. (Tibo checked Chat's scroll fix
  once republished: it works.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My forums, at a glance (Priority: P1)

Bob is in four forums. A column on the left lists them. "Climbing" shows a dot (new posts), "HyperBrowser" shows 2
(two mentions). He clicks "Climbing": it opens, its dot goes.

**Why this priority**: it is what Tibo asked for: see what's joined, and where something happened.

**Independent Test**: engines on a local DHT: posts and mentions in forums not open give the right dots and numbers
on the panel; opening one clears its dot.

**Acceptance Scenarios**:

1. **Given** four joined forums, **Then** all four are listed, the open one marked.
2. **Given** a new thread in a forum not open, **Then** a dot within one round of checks.
3. **Given** a mention, **Then** a number; opening the thread clears it.
4. **Given** a click on another forum, **Then** it opens, the panel stays where it was, and the forum left is
   released (closed later if nothing else uses it).
5. **Given** the column collapsed, **Then** it stays collapsed across forums and restarts.

---

### User Story 2 - Boards with their dots (Priority: P1)

The second column lists the open forum's boards and sub-boards. A board with new threads or replies shows a dot.
Inside, unread threads are bold, the new replies marked.

**Why this priority**: a forum's front page is otherwise a wall; the dots say where to look.

**Independent Test**: a reply received late (written offline, stamped earlier) still marks its thread and board.

**Acceptance Scenarios**:

1. **Given** a new reply in board B, **Then** B has a dot and the thread is bold.
2. **Given** a reply received late, **Then** the same, though its date is older than what was read.
3. **Given** the board opened, **Then** its dot clears; the thread stays bold until opened.

---

### User Story 3 - Join and leave (Priority: P1)

A "+" at the bottom of the forums column joins with a link or makes a forum. Each forum has "Leave" in its menu.

**Why this priority**: today joining is a separate start page and leaving doesn't exist.

**Independent Test**: join with a link, then leave: the forum is gone from the list, its notifications, read state
and follows gone, its space left.

**Acceptance Scenarios**:

1. **Given** a link, **When** joined, **Then** the forum is listed and opens.
2. **Given** "Leave", **Then** a confirmation, then it goes from the list and its space is left.
3. **Given** a forum Bob owns, **When** he leaves, **Then** the warning of Q4 first.

---

### User Story 4 - Mentions, replies, follows (Priority: P2)

Ann replies to Bob's comment: Bob gets a mention (a number, a notification). Bob follows the board "Gear" and
follows Cleo: new threads in Gear and Cleo's posts give dots and list entries, no popup unless he turned it on.

**Why this priority**: the reason to come back; built on spec 016.

**Independent Test**: a reply notifies the parent's author; follows notify without popups; unfollow stops them.

**Acceptance Scenarios**:

1. **Given** a reply to Bob's comment, **Then** Bob is notified (a mention), not Ann.
2. **Given** a follow of a board, **Then** its new threads notify, its comments don't.
3. **Given** a follow of a person, **Then** their threads and comments notify.
4. **Given** "You", **Then** the follows are listed, each with unfollow and a popup switch.

---

### User Story 5 - Chat opens where it should (Priority: P1)

Bob opens a conversation: it shows the latest messages, or, with unread ones, a "New messages" line just above the
first of them. Sending keeps him at the bottom. Groups and one-to-one conversations read the same way: oldest at the
top, newest at the bottom. The conversation list shows unread numbers.

**Why this priority**: Tibo still sees Chat jump to the start, and groups in the other order.

**Independent Test**: in a real page (the sandbox self-test): open with unread messages → the line in view; send →
still at the bottom; a group and a direct conversation → same order.

**Acceptance Scenarios**:

1. **Given** no unread messages, **When** opened, **Then** at the latest message.
2. **Given** 5 unread, **Then** "New messages" above the first of them, in view.
3. **Given** a message sent, **Then** at the bottom.
4. **Given** a group and a direct conversation, **Then** both oldest at the top.
5. **Given** unread messages in two conversations, **Then** their numbers in the list; opening one clears its number.

### Edge Cases

- A forum left on another device of the person: gone here too; a forum not reachable yet: listed, "connecting".
- A forum with hundreds of boards: the column scrolls.
- Following a person who posts a lot: dots only, capped in the list like any notifications.
- A reply to oneself: no mention.
- Read state on two devices: a thread read on one is read on the other (spec 016's read marks).
- The forums column on a narrow window: collapsed by default under a width.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The forum page MUST show a collapsible column of the person's forums, each with a dot (new since last
  opened) or a number (unread mentions and replies), and the collapsed state remembered.
- **FR-002**: Switching forums MUST release the forum left, so that it closes once nothing uses it.
- **FR-003**: A second column MUST list the open forum's boards with dots.
- **FR-004**: Unread threads and boards MUST be decided by what was received, not by dates.
- **FR-005**: Joining (link or new) MUST be reachable from the column; Leave from each forum, with the owner's warning.
- **FR-006**: Leaving MUST remove the forum's notifications, read state and follows.
- **FR-007**: A reply MUST notify the parent's author as a mention, except a reply to oneself.
- **FR-008**: An app MUST be able to add and remove watches at runtime for its own places (follows), each with a
  popup switch; HyperBrowser's rules of spec 016 apply (the person's permission, no app code run).
- **FR-009**: A page MUST be able to read the unread counts of its own app's places, and nothing of another app's.
- **FR-010**: Chat MUST open at the latest message, or at a "New messages" line above the first unread one; sending
  MUST keep the view at the bottom; every conversation oldest first.
- **FR-011**: Chat's conversation list MUST show unread numbers.
- **FR-012**: Chat MUST show a message's Edit and Delete behind one "…" button, reachable by keyboard.

### Key Entities

- **Follow**: app, place, kind (board or person), the board's id or the person's key, popup on or off. On all the
  person's devices.
- **Forum dot state**: per forum, whether anything arrived since it was last opened; derived from spec 016's cursors.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Switching between two forums takes under 1 second on this PC (measured before the plan settles Q2).
- **SC-002**: After switching through 20 forums, at most the visited one plus hypergraph's usual ones stay open.
- **SC-003**: A late-received reply marks its thread and board in 100% of scripted runs.
- **SC-004**: The sandbox self-test proves a page can't read another app's counts or add watches for another app's
  places; the checks fail in the control run.
- **SC-005**: Chat opens at the latest message or the "New messages" line in 100% of the self-test's runs, groups and
  direct conversations alike.

## Assumptions

- Spec 016 is merged; its notifications, read marks and turns are reused.
- Chat and Forum are published again (`apps:publish`) before people see any of this.
- The Chat problems Tibo saw came from an older published Chat: once republished, the scroll fix works. A probe
  (2026-11-12) gives groups and direct conversations the same order; US5's self-test keeps it so.
- No instant switching (Q2), no search, no drag to reorder forums.
