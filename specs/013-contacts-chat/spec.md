# Feature Specification: 013 — contacts and chat (and the safe calls between apps)

**Feature Branch**: `claude/sharp-yalow-64e929`

**Created**: 2026-11-08

**Status**: Answered (Tibo, 2026-11-08, the four questions below)

**Input**: Tibo: a chat that is secure, private, P2P and reliable with friends: private 1-to-1 messages and
private groups. In a group the owner alone adds people and moderates by default, and can grant those rights to
others (invite, delete messages, ban, change the moderation settings). Maybe public IRC-like rooms (a room exists
by its name alone, hashed on the DHT). A contacts app like the phone's: browse contacts, send and accept friend
requests, open the messages with one contact at once. Apps call each other: Contacts opens Chat ready to write to
a contact, Chat opens a person's contact page. HyperBrowser handles those calls itself, so that sites made by
others interact only in a restrained way (a forum's profile page may offer "send friend request", nothing
dangerous).

## Clarifications

### Session 2026-11-08 (Tibo)

- Q1 How a friend request reaches the other person → **both**: directly over the DHT by the person's key (for
  simplicity: a button on a forum profile works), and by a contact link sent through any other channel (for
  privacy: nothing about you on the DHT). Whoever wants privacy turns "people can find me by my key" off.
- Q2 Public IRC-like rooms → **later, a spec of their own** (two rooms made with one name at once, spam,
  moderation without an owner).
- Q3 The app's name → **Contacts**.
- Q4 What other people's sites may do → **a small fixed set**: open a chat with a person, open their contact
  page (both only right after a click on the page), send a friend request (HyperBrowser asks the person to
  confirm first). Reading or changing the contacts needs a permission the person grants once; only the two
  official apps ask for it.

## Words

- **Contact**: a person (an identity key) in the person's contact list, with a name the person sees. A contact is
  a **friend** once both said yes; until then it is an **incoming** or **outgoing** request.
- **Conversation**: a private chat space. A **direct conversation** has the two friends only; it is made when a
  request is sent and the other person joins it by accepting. A **group** has an owner and the members they let
  in. Both are instances of the Chat app (spec 009), private (spec: hypergraph's private spaces): only their
  members read them, removed members don't read what comes after.
- **Contact link**: a one-use link to a new direct conversation, made by the person and sent by any channel;
  whoever opens it first becomes their friend.
- **Being findable**: the person's devices answer on the DHT under a name derived from their key, so others can
  send them a request knowing only the key (on by default).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Become friends and talk (Priority: P1)

Ann knows Bob's key (from the forum, or he pasted it to her). In Contacts she adds it and sends a request. Bob
sees "Ann wants to be your friend" in Contacts, accepts, and both have each other as friends. Either opens the
conversation and writes; the other reads it, live, and after a restart.

**Why this priority**: it is the whole point: two people, a private channel, no server.

**Independent Test**: two engines on a local DHT: a request by key, an accept, a message each way.

**Acceptance Scenarios**:

1. **Given** Ann and Bob both online and Bob findable, **When** Ann sends a request to Bob's key, **Then** Bob's
   contacts list it as incoming with Ann's name within seconds.
2. **Given** an incoming request, **When** Bob accepts, **Then** both list each other as friends and share one
   direct conversation only they read.
3. **Given** Bob offline when Ann sends, **When** Bob comes online later while Ann's HyperBrowser runs, **Then**
   the request reaches him without Ann doing anything.
4. **Given** Bob declines, **Then** the request is gone on his side and stays "sent" on Ann's (she isn't told).

### User Story 2 - Add a friend with a contact link (Priority: P1)

Cleo doesn't want to be findable. She makes a contact link in Contacts and sends it by email. Dan pastes it in
Contacts (or in the address bar): both become friends.

**Independent Test**: two engines, findable off on both: link, open, both friends, a message.

**Acceptance Scenarios**:

1. **Given** a contact link, **When** Dan opens it, **Then** both list each other as friends, with names.
2. **Given** a link used once, **When** someone else opens it, **Then** it is refused.
3. **Given** findable off, **Then** Cleo's devices never answer under her key's DHT name.

### User Story 3 - Private groups with rights the owner hands out (Priority: P2)

Ann makes a group "Climbing" in Chat and adds her friends Bob and Cleo. By default only she adds people and
moderates. She gives Bob the right to add people; Bob adds Dan. She makes Cleo a moderator, who deletes a message
and bans someone. A banned or removed member doesn't read what is written after.

**Independent Test**: three engines: create, add, grant, add by the granted member, delete, ban, a removed member
reads nothing new.

**Acceptance Scenarios**:

1. **Given** a new group, **When** a plain member tries to add someone, **Then** it is refused.
2. **Given** the owner granted "add people" to Bob, **When** Bob adds Dan, **Then** Dan is in.
3. **Given** a moderator, **When** they delete a message or ban a member, **Then** it is gone/out for everyone.
4. **Given** a member removed or banned, **When** others write, **Then** the removed member can't read it.

### User Story 4 - Apps call each other, safely (Priority: P2)

In Contacts, Ann clicks "Message" on Bob: Chat opens on their conversation. In Chat, she clicks Bob's name: his
contact page opens in Contacts. On the forum, Bob's profile shows "Add friend": a click makes HyperBrowser ask Ann
"Send a friend request to Bob (key …)?", and only her yes sends it. The forum learns nothing about her contacts.

**Independent Test**: the engine's guards (a site without the permission gets `NOT_ALLOWED` for every contacts
call; with it, it works); the sandbox self-test for the shell's confirm dialog and the click rule.

**Acceptance Scenarios**:

1. **Given** any site, **When** it asks to open a chat or a contact page without a click on the page, **Then**
   nothing opens.
2. **Given** any site, **When** it asks to send a friend request, **Then** the person is asked first; a no sends
   nothing and the site gets `NOT_ALLOWED`.
3. **Given** a site that didn't get the contacts permission, **When** it calls a contacts method, **Then**
   `NOT_ALLOWED`; the first call of a site that declares it asks the person once.

### Edge Cases

- A request to oneself, to an existing friend, or a malformed key: refused (`INVALID_PARAMS` / `ALREADY`).
- Someone else answering under Bob's DHT name (anyone can): they get Ann's request link; opening it lets them into
  an empty conversation, and Ann's HyperBrowser bans them at once (only Bob is expected). Bob isn't harmed;
  Ann sees the request still waiting and it is sent again. Documented, not prevented (hypergraph has no invite
  bound to one identity yet: request B5).
- A flood of requests: at most 100 incoming kept; more are dropped until some are answered.
- Both send a request to each other: each sees an incoming one; accepting either makes them friends (the other
  conversation stays as a second one, harmless).
- The other person removes Ann: their side leaves the conversation; Ann's contact stays until she removes it.
- A request accepted on one of Bob's devices: his other devices list Ann as a friend too (settings follow).
- A direct conversation needs Ann (its owner) online for Bob to get in (a decision by its owner): accepting while
  she is offline waits, then says "try again when Ann is online".

## Requirements *(mandatory)*

### Functional Requirements

**Contacts (engine, the person's settings, on every device of theirs)**

- **FR-001**: The person has a name (one, shared by every app) and a "findable" switch (on by default).
- **FR-002**: The person sends a request to a key: a new private direct conversation is made (owned by them, an
  instance of the Chat app), one invite to it is kept, and the request is delivered over the DHT to the other's
  devices while both are online, retried until delivered.
- **FR-003**: A findable person's devices receive requests: each carries the sender's name and the invite; the
  sender's identity is read from the invite's signature (never from what the message claims).
- **FR-004**: The person accepts (joins the conversation; both become friends), declines (dropped), or removes a
  contact (dropped, and the direct conversation left).
- **FR-005**: The person makes a contact link (a one-use invite to a new direct conversation); opening one makes
  both friends. A link to anything else than a Chat conversation is refused.
- **FR-006**: The sender's side turns a request into a friend once the other joined; anyone else joining the
  conversation is banned at once.
- **FR-007**: Each side writes its name into the conversation, so the other learns it; the person may rename a
  contact for themselves.

**Chat (an app with instances, spec 009)**

- **FR-008**: Chat lists the person's conversations (direct ones under the friend's name), shows messages live,
  sends, edits and deletes one's own.
- **FR-009**: Groups: anyone creates one (private, they own it); the owner adds friends; by default only the owner
  adds people and moderates; the owner grants a member "add people", "moderate" (delete messages, ban) or "admin"
  (everything but ownership, moderation settings included) and takes it back.
- **FR-010**: Adding a friend to a group sends them an invite inside their direct conversation; they join with one
  click there.

**Calls between apps (the shell)**

- **FR-011**: Any dynamic site may ask: open a chat with a key, open a key's contact page (each honored only during
  a click on that page), send a friend request (the shell asks the person, showing the name the site gave and the
  key).
- **FR-012**: A site declaring the `contacts` permission in `site.json` may list, accept, decline, remove, rename,
  and make or open contact links, after the person allowed it once ("Let X see and manage your contacts?").
  Without it, `NOT_ALLOWED`.
- **FR-013**: Every guard has a test that fails when the guard is off.

**Out of scope**: public rooms (Q2), blocking (decline is enough for now), voice and files in chat, a "typing…"
or read receipts, a sealed DM inbox reachable while the sender is offline.

### Key Entities

- **Contact**: key, name, state (friend / incoming / outgoing), its direct conversation's key, when.
- **Conversation**: a private Chat instance; direct (2 people) or group (owner, members, roles).
- **Message**: author, text, time; editable by its author, deletable by its author or a moderator.

## Success Criteria *(mandatory)*

- **SC-001**: Two people online and findable become friends in under 30 s from the request (local DHT: under 10 s).
- **SC-002**: A message reaches the other online friend in under 5 s (local DHT: 2 s).
- **SC-003**: No site without the contacts permission ever reads a contact (tests with the guard off fail).
- **SC-004**: A removed group member reads nothing written after the removal (test).
- **SC-005**: Tibo makes a friend on his PC and laptop, chats, makes a group and hands out a right, without help.

## Assumptions

- Spec 009 (apps with instances) is merged; spec 012 (device pairing) may land before or after: contacts live in
  the person's settings, which follow devices either way.
- SwarmFS gains private sites (`createSite(name, { private: true })`): a Chat conversation's messages are sealed.
- The engine runs a small DHT presence of its own for requests (Hyperswarm, composed), apart from hypergraph's.
- The official Chat and Contacts apps are published by Tibo and named in the shell's preset; their keys tell the
  engine which app owns direct conversations.
