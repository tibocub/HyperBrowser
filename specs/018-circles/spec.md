# Feature Specification: 018 — circles

**Feature Branch**: `018-circles`

**Created**: 2026-11-16

**Status**: Draft (decisions grilled with Tibo, 2026-11-13 and 2026-11-16)

**Input**: hypergraph's circles (023) and fixed copies (024): people whose computers keep each other's
conversations and boards online, so private chat works while its people are offline. HyperBrowser 018 is the
screen for it: make and join circles, invite, choose how much to hold, see how many copies of a conversation are
kept. Builds on specs 012 (devices window), 013 (contacts, chat), 016 (configuration, notifications), 017 ("…"
menus).

## Clarifications

### Session 2026-11-13 (Tibo, with hypergraph 022/023)

- A Circles section on the Configuration page; invite a contact from its "…" menu (no button per row); one notice on
  joining (what it costs, what holders see); "you hold X of 1 GB"; "Change key" in a place's "…" menu.

### Session 2026-11-16 (Tibo)

- Q1 Where → Configuration: a **Circles** heading (holding switch, share, "you hold X of Y GB") and a **Your
  circles…** window like "Your devices…" (list, **Create a circle**, a "…" per circle: Copy invite link, Members,
  Rename, Leave).
- Q2/Q14 When holding runs → **whenever the engine runs**: it follows **When the window closes** (Stay in the tray
  keeps holding, Quit stops everything). No separate switch: turning holding off deletes what is held (hypergraph),
  so closing the window must never turn it off.
- Q3 Inviting → **Copy invite link**, and a "…" menu on each Contacts row: **Invite to circle ▸ <name>**, which posts
  a **Join "<circle>"** button in the Chat conversation with that contact.
- Q4 Copies → in each conversation's and private board's "…"/info: "Kept by N of 5 copies, M online"; a warning
  line under 2 online: "Few copies online: people may not get this while you're offline". A site call
  `hyper.copies()` for the site's own space, its sub-spaces and its instances.
- Q5 **Change key** in 018: in the "…" menu of your own conversations and boards (`rotateKey()`).
- Q6 Members list → name, role, a "holds" mark; owner and admins get a "…" per row: Make admin, Remove. The owner
  leaving gets the forum's warning.
- Q7/Q9 Share → **a number field in GB** (decimals), at least 0.1; at most the disk's free space plus what is held
  now, minus 2 GB ("Only X GB free on this disk"); lowering it below what is held asks first ("Y GB will be dropped
  now, oldest first").
- Q8 Join notice, once, on the first circle made or joined: "Your computer will keep copies of your circle's
  conversations and boards (up to 1 GB), so they stay reachable while their people are offline. It can't read
  private ones. Holders see how many spaces each member has, their sizes, when they change, and your IP address."
  **OK** / **Not now** (Not now: not joined, not made).
- Q10 Invite links → one use, 7 days, both ways. A used or expired link says so.
- Q11 A circle is **not** a group chat in 018: only a holding group, seen in the Circles window.
- Q12 Notifications → only **"share full"**, once each time it fills.
- Q13 Owners and admins rename a circle.
- Q15 Turning holding off warns: "This deletes the X GB you keep for your circles. Their spaces will be kept by
  others." **Turn off** / **Cancel**.

## Requirements

**Circles window**

- **FR-001** Configuration → **Circles**: the holding switch, the share field (FR-006) and "You hold X of Y GB";
  **Your circles…** opens the circles window.
- **FR-002** The window lists the person's circles (name, member count, how many hold). **Create a circle** asks a
  name. Each row's "…": **Copy invite link** (FR-008), **Members** (FR-004), **Rename** (owner, admins), **Leave**
  (the owner: the forum's warning).
- **FR-003** Making or joining the first circle shows the Q8 notice; OK goes on and turns holding on at 1 GB unless
  the person set it before; Not now does nothing.
- **FR-004** Members: name (contact name, else short key), role, a "holds" mark when one of their devices holds.
  Owner and admins: a "…" per row, **Make admin** and **Remove**. A 51st member is refused by hypergraph
  (`CIRCLE_FULL`): the inviter sees "This circle is full (50)".

**Holding**

- **FR-005** Holding runs while the engine runs (Q14). The switch turns it off after Q15's warning (hypergraph then
  deletes what is held) and back on.
- **FR-006** The share field (Q9): GB, decimals, 0.1 at least; refused above free space + held − 2 GB, saying how
  much is free; lowering below what is held asks first.
- **FR-007** "Share full" notifies once when what is held reaches the share and the oldest starts being dropped; again
  only after it went under 90%.

**Inviting and joining**

- **FR-008** Invite links: one use, 7 days (`createInvite({ uses: 1, expires })`). **Copy invite link** copies one;
  Contacts' "…" → **Invite to circle ▸ <name>** posts one in the Chat conversation with that friend.
- **FR-009** In Chat the invite shows as **Join "<circle>"**. Clicking it opens HyperBrowser's own join flow (the
  notice if it's the first circle, then joining); a page can never join a circle by itself. A used or expired link:
  "This invite was already used or has expired".

**Copies and keys in apps**

- **FR-010** `hyper.copies(key?)` → `{ wanted, kept, online }` (hypergraph's `copiesOf`) for the site's own space,
  its sub-spaces and instances; another key is `NOT_ALLOWED`. `wanted: 0` when nothing is handed (no circle).
- **FR-011** Chat (each conversation) and Forum (each private board) show "Kept by N of 5 copies, M online" in the
  "…"/info when `wanted > 0`, and the Q4 warning line while `online < 2`.
- **FR-012** **Change key** in the "…" of a conversation or board the person owns (`rotateKey()`), with a line
  saying what it does ("A new key from now on; for a lost device or a suspected leak").

## Not covered (decided)

A circle as a group chat (Q11); phones and background holding on phones; the helper; picking holders by how often
they are online (hypergraph, later); a pause that keeps data (Q14 chose no switch).

## Success criteria

- Two HyperBrowsers in a circle: A's conversation with an outsider C is read by C while A is offline (a two-engine
  test).
- A friend joins a circle from the Chat invite in under 4 clicks, seeing the notice once.
- A conversation shows its copies within 30 s of a holder coming online.
