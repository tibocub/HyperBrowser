# Feature Specification: 019 — circle invites

**Feature Branch**: `019-circle-invites`

**Created**: 2026-11-17

**Status**: Draft (Tibo's manual test of 018, 2026-11-16/17)

**Input**: Testing circles on two devices, Tibo found no way to join from a pasted link, wanted to invite contacts
from the Circles window, a clearer button in Chat, and found Contacts' "…" clunky (it overlaps **Message**, and opening
it moves the row). Builds on 018 (circles window, `contacts.inviteToCircle`, Chat's invite message).

## Clarifications

### Session 2026-11-17 (Tibo)

- Circles window "…" → **Invite contacts…**: pick friends, each gets an invite in Chat.
- Chat: **Accept <name>'s invitation to "<circle>"** instead of `Join "<circle>"`.
- The Circles window can also join from a **pasted link**.
- Contacts' "…" must not overlap or move anything.
- Lead's defaults, accepted: one link per friend (links are one use); friends already in the circle are greyed; no
  joining from the address field (one place to join); pasting a link needs no extra "Join?" question (pasting is the
  yes), only Q8's first-circle notice.

## Requirements

**Circles window**

- **FR-001** A circle's "…" gains **Invite contacts…** (owner and admins, like Copy invite link). It shows the
  person's friends with a checkbox each; friends already in the circle show "already in", unticked and disabled.
  **Send** posts each ticked friend their own one-use, 7-day invite in their Chat conversation
  (`contacts.inviteToCircle`), then says "Invites sent to N friends in Chat" and names any that failed (with why).
  No friends: "No friends yet: add some in Contacts".
- **FR-002** **Join with a link…** next to **Create a circle**: a field and **Join**. Joining goes through 018's join
  flow (Q8's notice the first time, OK or Not now) without the extra "Join?" question. Errors: "This invite was already
  used or has expired", "This circle is full (50)", "This is not a circle invite". Joined: the list refreshes and
  says "You joined "<name>"".

**Chat**

- **FR-003** An invite from someone else shows **Accept <name>'s invitation to "<circle>"** (`<name>` as Chat shows
  the sender). Same flow as today after the click (018 FR-009). Your own invite keeps "You invited them to the circle
  "<circle>"". No change to the message's fields (`circle`, `circleName` stay as published).

**Contacts**

- **FR-004** A friend's "…" is a real button with a gap from **Message**. It opens a small menu that floats over the
  page under the button (it moves nothing): one item per circle, **Invite to "<circle>"**, or the "No circle to
  invite to" line. It closes on a choice, a click outside, or Escape; Enter or Space opens it, Tab reaches its items.
  It survives a refresh of the list while open, or closes cleanly (no jump).
- **FR-005** Chat's and Forum's "…" menus are checked for the same overlap and shift; fixed the same way only if they
  have it (said in the report either way).

**Owner**

- **FR-006** (Done by the lead, 2026-11-17) `npm run apps:seed`: publishes every official app from
  `../hyperbrowser-owner` and stays online until Ctrl+C (`apps-publish --stay`).

## Not covered (decided)

Joining a circle from the address field; inviting non-friends from the Circles window (Copy invite link covers it); a
shared menu component across apps (each app is its own site).

## Success criteria

- Inviting 3 friends from the Circles window takes 3 ticks and one click; each finds the invite in Chat.
- A pasted link joins in 2 clicks (Join, then OK the first time).
- Opening Contacts' "…" moves no other element on the page (checked by the element's position before and after).
