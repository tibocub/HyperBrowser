# Feature Specification: 006 — the official forum

**Feature Branch**: `claude/006-forum-4ac663`

**Created**: 2026-11-07

**Status**: Built in slices (see tasks.md)

**Input**: lead session, 2026-11-07: build `sites/forum`, the official HyperBrowser forum, a dynamic hypersite on the
site API. Milestone 1's main goal and the project's real-life reliability test; invite-only while testing, a fresh
public forum replaces it at release. Design approved by Tibo: `mockup/Main.dc.html` (front page),
`mockup/Thread.dc.html` (a thread), and hypergraph's `specs/research/hyperbrowser-milestone-1.md` ("Visual identity
and the official forum", "Decided"). Features: what hypergraph's forum scenario tests cover, plus sorting, unread
and mentions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read and start threads on boards (Priority: P1)

A member opens the forum: boards on the left, the chosen board's threads on the right (on a phone, boards then
threads). They open a thread, read it, and start a new one with a title and text. The owner and admins make the
boards, and boards inside a board (sub-forums).

**Independent Test**: two engines on a local DHT; the owner publishes the forum and makes a board; a member
(invited) sees the board, posts a thread; the owner sees it.

**Acceptance Scenarios**:

1. **Given** a forum with no board, **When** an admin makes "Getting started", **Then** every member sees it.
2. **Given** a member, **When** they try to make a board, **Then** it is refused.
3. **Given** a board, **When** a member posts a thread, **Then** it is listed on that board for everyone, with
   its author's name and icon, its replies and its score.
4. **Given** a board with a sub-board, **Then** the sub-board is listed under it.

### User Story 2 - Reply in a tree, vote, edit and delete (Priority: P1)

A member replies to the thread or to a reply; replies form a tree (one box-drawing step per level) that folds.
They vote ▲ or ▼ on threads and replies (score shown, the accent once they voted; voting again takes it back).
They edit or delete what they wrote; an edited post says so.

**Acceptance Scenarios**:

1. **Given** a thread, **When** b replies and c replies to b, **Then** the tree shows c under b under the thread.
2. **Given** a reply, **When** a member votes ▲ then ▼, **Then** the score counts only their latest vote.
3. **Given** their own reply, **When** its author edits it, **Then** everyone sees the new text, marked edited.
4. **Given** someone else's post, **When** a member tries to edit or delete it, **Then** it is refused.
5. **Given** their own post, **When** its author deletes it, **Then** it is gone for everyone; replies under it
   stay, under "(deleted)".

### User Story 3 - Invites, members and moderation (Priority: P1)

The forum is invite-only. An admin makes an invite (one person, or a few uses), sends the link; the newcomer pastes
it into HyperBrowser's address field and is in. Admins make members moderators; moderators hide posts, look at
reports, and ban; members report posts.

**Acceptance Scenarios**:

1. **Given** someone with no invite, **When** they open the forum's key, **Then** they can't get in.
2. **Given** an invite link, **When** a newcomer opens it in HyperBrowser, **Then** they are a member and can post.
3. **Given** a member's report on a post, **Then** moderators see it in the moderation list.
4. **Given** a moderator, **When** they hide a post, **Then** it is in nobody's list, and they can show it again.
5. **Given** a moderator, **When** they ban a member, **Then** that member's new posts are refused.
6. **Given** an admin, **When** they make a member a moderator, **Then** that member can hide posts.

### User Story 4 - Sorting, unread and mentions (Priority: P2)

The reader picks how threads are sorted: latest activity (default; a reply brings a thread back up), newest, top
(score), lively (most replies and votes lately, computed on this device). Threads and replies not read yet are
marked with the accent; what was read stays on the person's devices. Writing `＠name` mentions a member: the post
keeps their key and shows their current name; the member finds it in their Mentions list (no badge, no counter).

**Acceptance Scenarios**:

1. **Given** threads A (old, new reply) and B (newer, no reply), **Then** activity lists A first, newest B first,
   top the higher score first, lively the one with the most recent replies and votes first.
2. **Given** a thread the reader never opened, **Then** it is unread; once opened it is read; a new reply makes it
   unread again, and that reply is marked new.
3. **Given** the reader's sort and read state, **When** they come back later on the same identity, **Then** both
   are as they left them.
4. **Given** b writes `＠c` in a reply, **Then** c's Mentions list has it; if c changes their name, the reply shows
   the new name.

### User Story 5 - Who you are (Priority: P2)

A member sets the name shown in the forum and a 16×16 1-bit icon: drawn by them, or made from their key (the
default).

**Acceptance Scenarios**:

1. **Given** a member with no icon, **Then** they show an icon made from their key, the same on every device.
2. **Given** a member who draws an icon, **Then** everyone sees it next to their name.

### Edge Cases

- Right after opening, lists may be incomplete: shown as loading, filled as records arrive.
- Names aren't unique: a mention shows the current name and the short key on hover; two members with one name
  are told apart by their icons and keys.
- Post text is a HyperMD subset (bold, italic, code, quotes, links, images); anything else, HTML and scripts
  included, is shown as text.
- Links in posts open other pages of this site or other HyperBrowser sites only (the sandbox blocks the web).
- A reply whose parent was hidden or deleted stays in the tree under "(deleted)".
- A thread moved or a board removed: out of scope (no move); deleting a board hides it, its threads stay readable
  by link.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The forum is one site, one space: its pages writable by the owner and admins only, posts by members.
  It declares its own record types in its `site.json`.
- **FR-002**: Invite-only: the site is not public; admins make invites in the forum; a link pasted into the address
  field joins.
- **FR-003**: Boards (with sub-boards) made, renamed and removed by the owner and admins only.
- **FR-004**: Threads (title, text, board), replies (to the thread or a reply), votes (+1, −1, taken back), edit
  and delete by their author; edited posts are marked.
- **FR-005**: Moderation: report (members), hide and show again, the reports list, ban and unban (moderators and
  up), make moderator (admins).
- **FR-006**: Sorting by activity (default), newest, top, lively; the reader's choice is remembered.
- **FR-007**: Unread threads and replies marked with the accent; read state kept in the person's own data, on
  their devices, never in the forum's space.
- **FR-008**: Mentions keep the member's key, show their current name, and fill a Mentions list the member opens.
- **FR-009**: Names and 16×16 1-bit icons (drawn or made from the key).
- **FR-010**: The look of the mockups: System 1 window, striped title bar, dithered desktop, panes; Cozette for the
  interface and the tree, IBM Plex Mono for post text; black and white plus one accent; dark = inverted. No copied
  menu bar (File, Edit...): the shell draws the frame, the forum only its content.
- **FR-011**: Usable on a phone width (boards then threads) and with the keyboard; every control has a label.
- **FR-012**: Tests through the site API with two engines on a local DHT, for every flow above, on Node and Bare.
- **FR-013**: User docs in `docs/forum.md` and a page on `sites/home`; screenshots of the front page and a thread,
  light and dark, in this folder.

### Key Entities

- **Board**: a name, a description, an order, maybe a parent board.
- **Thread**: a title, text, its board; author, time, edited.
- **Reply**: text, what it answers (the thread or a reply), its thread.
- **Vote**: +1 or −1 (0: taken back) on a thread or a reply, one per member.
- **Mention**: who was mentioned (their key), in which post.
- **Member look**: their name (the site's `profile`), their icon (16×16 bits).
- **Read state** (personal, not in the forum): per thread, the latest activity seen; the sort chosen; mentions seen.

## Success Criteria *(mandatory)*

- **SC-001**: A newcomer with an invite link is in and reading within a minute of pasting it (owner online).
- **SC-002**: A post written on one peer shows on another peer's open page without reloading.
- **SC-003**: Every flow of US1–US5 passes as an automated two-peer test.
- **SC-004**: Tibo can click through the front page and a thread in HyperBrowser.

## Assumptions

- Devices: the person's other devices come with HyperBrowser's device pairing (not built yet in the engine); the
  forum needs nothing of its own for them: posts are the person's, read state follows the person's settings.
- Private sub-forums (a staff room, sub-spaces) are out of scope for milestone 1's forum.
- Images in posts are pictures of the site, or small images attached to the post.
- The person's identity is asked once ("let this site use your identity?"), as for every dynamic site.
