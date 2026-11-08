# Feature Specification: 009 — federated apps (the forum as an app with instances)

**Feature Branch**: `claude/009-federated-apps-143ff9`

**Created**: 2026-11-08

**Status**: Draft — open questions go to Tibo through the lead (see plan.md, "Open questions")

**Input**: lead session, 2026-11-08: make the official forum a federated app. One app (its code, in the app's
site space, published by Tibo) whose instances anyone can create and own. Each instance is a space of its own,
owned by its creator; the app creates, joins (invite or public link), lists and leaves instances; the site API
acts on an instance with the same safety (an app reaches only the instances made with it or joined through it,
never other sites' spaces). Tibo owns only the official "HyperBrowser" instance. A fix to the app's code reaches
every instance. Model: hypergraph's forum example (`test/next/forum/`: `createForum` makes forums owned by their
creator). Goal: the easiest kit for server-less social apps; what is awkward for an app author is fixed in the
API, not in the app.

## Words

- **App**: a dynamic site whose code (pages, scripts, record types) can run many communities. Published by its
  author, like any site today.
- **Instance**: one community run by an app (one forum). Its data lives apart from the app's code and from every
  other instance; its creator owns it (owner role) and decides its members, admins and moderators.
- **App author**: who publishes the app (Tibo for the forum). Has no say in an instance they didn't create.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Anyone creates a forum of their own (Priority: P1)

Dave opens the forum app and makes a forum, "Woodworkers". He is its owner: he makes its boards, its invites
and its moderators. Tibo, who wrote the app, can't post there unless Dave lets him in, and can't moderate it.

**Why this priority**: the point of the feature; without it, every forum is Tibo's.

**Independent Test**: two engines on a local DHT; each person, through the app's site API, creates an instance;
each is owner of their own and has no role in the other's; a write by one into the other's (a board, a role,
a moderation) is refused.

**Acceptance Scenarios**:

1. **Given** the forum app, **When** a person creates an instance named "Woodworkers", **Then** it is listed in
   their instances with them as owner, and the app's record types work in it.
2. **Given** two people who each created an instance, **When** one tries to make a board, give a role or hide a
   post in the other's, **Then** it is refused.
3. **Given** an instance, **When** the app's author (not invited) tries to read or write it, **Then** they can't
   (an invite-only instance) or can only do what any member may (a public one): never an admin's acts.

---

### User Story 2 - Join a forum by its link, and leave it (Priority: P1)

Dave sends Erin an invite to "Woodworkers". Erin pastes it into HyperBrowser's address field: the forum app
opens on "Woodworkers", and she is a member. She also joins Alice's public forum by its public link. Her app
lists both. Later she leaves "Woodworkers": it is gone from her list and from her device.

**Why this priority**: an instance nobody can join is useless; links are how people find each other today.

**Independent Test**: a third engine joins both instances, one by invite and one by public link, through the
app's site API; both are listed; after leaving one, it is no longer listed nor reachable from the app.

**Acceptance Scenarios**:

1. **Given** an invite link to an instance, **When** a person opens it, **Then** the app that made the instance
   opens on that instance, and they are a member.
2. **Given** the app open, **When** the person pastes an instance's link inside the app ("join"), **Then** the
   same happens without leaving the app.
3. **Given** a person in two instances of the app, **When** the app lists their instances, **Then** both are
   listed with their names and the person's role in each.
4. **Given** an instance the person is in, **When** they leave it, **Then** it is no longer listed, the app can't
   reach it any more, and this device drops its data. Their membership stays (they can come back with a link).

---

### User Story 3 - One fix reaches every forum (Priority: P1)

Tibo fixes a bug in the forum app and publishes it again. Everyone opening any forum made with the app (his own
"HyperBrowser" forum, Dave's, Alice's) runs the fixed code; their data is untouched.

**Why this priority**: the reason for one app and many instances instead of many copies of the code.

**Independent Test**: the app is published; two instances exist; the app is published again with a changed page
and a new record type; both instances' pages are the new ones, and the new type works in an instance once its
owner or an admin opens it.

**Acceptance Scenarios**:

1. **Given** two instances of an app, **When** the app's author publishes a new version, **Then** opening either
   instance runs the new version.
2. **Given** a new version adding a record type, **When** an instance's owner or admin opens it, **Then** the
   instance gains the type (additions only, as for sites today).

---

### User Story 4 - An app reaches only its own instances (Priority: P1)

A site, malicious or buggy, tries to reach a space it didn't make or join: another site's space, an instance of
another app, the official forum, a space it guessed. It can't.

**Why this priority**: constitution I (sites are strangers, non-negotiable).

**Independent Test**: through the site API, an app asks to act on another site's space key, on another app's
instance, and to "join" a link to another site; each is refused; the same calls with the guard turned off pass
(the control run).

**Acceptance Scenarios**:

1. **Given** app A and a space that is not an instance made with or joined through A, **When** A asks to act on
   it, **Then** it is refused (`NOT_ALLOWED`).
2. **Given** a link to another site (or to an instance of another app), **When** app A asks to join it, **Then**
   it is refused and nothing of that site is reachable from A.
3. **Given** the person removed their consent for app A, **Then** A reaches none of its instances.

---

### User Story 5 - The official forum is the app plus Tibo's instance (Priority: P2)

HyperBrowser's start page and bookmarks lead to the official forum as before. It is now Tibo's instance
("HyperBrowser") of the forum app: same pages, same features. Someone opening the app with no instance chosen
sees their own instances, a way to create one, a way to join one by link, and the official forum.

**Why this priority**: the visible outcome; it rides on stories 1–4.

**Independent Test**: the preset's forum entry opens the forum app on Tibo's instance; the forum's test suite
(boards, threads, replies, votes, moderation, unread, mentions, names, icons) passes against an instance.

**Acceptance Scenarios**:

1. **Given** a fresh HyperBrowser, **When** the person opens the forum from the start page, **Then** the
   official instance opens in the forum app.
2. **Given** the app opened with no instance, **Then** the person sees their instances, "create", "join by link"
   and the official forum.

### Edge Cases

- **Instance owner offline**: an instance works like any space: members read and post with whoever is online; an
  invite needs a member able to record decisions online (hypergraph's rule, unchanged).
- **App updated, instance's types older**: members read with the instance's types; a write of a type the
  instance doesn't have yet is refused until its owner or an admin opens the new version (it declares the
  additions). Older app versions keep working on a newer instance (additions only).
- **App author unpublishes, or the app's peers are gone**: instances keep their data; opening them needs the
  app's pages (held on this device if installed or cached; otherwise "the app isn't reachable").
- **A link to an instance opened by someone who never opened the app**: the app opens; the person is asked once
  to let the app use their identity, which then covers every instance of that app.
- **Same instance joined through two apps** (a hostile app's author makes their own instance claim to be "of
  app X"): the instance names the app it was made with; only that app reaches it. A space claiming an app it
  wasn't made with only fools that app into showing the claimer's own data (harmless: as any instance).
- **Leaving an instance the person owns**: allowed, with the same rule as hypergraph (their other devices keep
  it; the space lives on with its members). Nothing is deleted for others.
- **Malformed input from a page**: instance names (length, type), links (not a link, a link to a sub-space),
  keys (not a key) are refused with `INVALID_PARAMS` / `INVALID_KEY`, as for sites today.
- **Many instances**: a person in dozens of instances of an app; hypergraph opens spaces while used (spec 017),
  so only the shown ones are open.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An app (a dynamic site) MUST be able to create an instance: a space of its own, owned by the
  person creating it, holding the app's record types, and recording which app it was made with.
- **FR-002**: An app MUST be able to join an instance by an invite link or a public link of that instance, and
  only an instance made with that same app.
- **FR-003**: An app MUST be able to list the person's instances of that app (on every device of the person),
  with each one's name and the person's role.
- **FR-004**: An app MUST be able to leave an instance (drops it from this device and from the app's list).
- **FR-005**: The whole site API available today on the app's own space (records, queries, live views, events,
  roles, moderation, invites, sub-spaces) MUST be available on each of the app's instances, with the same
  limits and the same consent.
- **FR-006**: An app MUST NOT reach any space that isn't one of its instances (made with it, or joined through
  it): not another site's space, not another app's instance, not a guessed key. Every such guard has a test
  with a control run (constitution I).
- **FR-007**: Opening an instance's link (invite, public link or key) in the address field MUST open the app it
  was made with, on that instance.
- **FR-008**: Publishing a new version of an app MUST change the code every instance runs, with no step per
  instance; record types added by the version MUST reach an instance when its owner or an admin opens it.
- **FR-009**: The app's author MUST have no role in an instance they didn't create or join.
- **FR-010**: The person's consent to let an app use their identity MUST be asked once per app and cover its
  instances (recommendation; see plan.md Q6).
- **FR-011**: Instances the person owns MUST stay hosted (as their own sites today); instances they joined are
  hosted while the app shows them, plus the grace period (spec 004's rule; see plan.md Q7).
- **FR-012**: The official forum MUST run as the forum app plus Tibo's "HyperBrowser" instance, opened from the
  start page and preset as today.
- **FR-013**: Docs MUST explain instances to app authors (`docs/site-api.md`), the forum's switch
  (`docs/forum.md`), and members (the official site's forum page).

### Key Entities

- **App**: a site with `site.json` (title, entry, permissions, types). Its pages are the code of every instance.
- **Instance**: a space owned by its creator; holds the app's types, a name, and an unforgeable mark naming its
  app (set at creation by its owner; nobody else may change it). Members, roles, invites, sub-spaces: as any
  space.
- **The person's instances of an app**: which instances the person made or joined through the app; kept on
  the person's devices (their settings), never in any space, out of other sites' reach.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the tests, two people each create an instance, and every act of authority (board, role,
  moderation, invite) by one in the other's instance is refused: 0 accepted.
- **SC-002**: A third person joins both (one by invite, one by public link) and posts in both.
- **SC-003**: After the app is published again, both instances run the new code, with no step per instance.
- **SC-004**: Every attempt by an app to reach a space that isn't its instance is refused; each guard's control
  run shows the attempt would otherwise succeed.
- **SC-005**: The forum's existing test suite passes unchanged in what it checks, run against an instance.
- **SC-006**: An app author adds instances to their app with at most five new calls to learn (create, join,
  list, leave, act on one), documented on one page.

## Assumptions

- The existing test forum's data (invite-only, test data) is dropped; the official instance starts empty
  (plan.md Q3).
- Anyone who allowed the app may create an instance; nothing in the app's author's hands limits this (Q4).
- Instances get the app's record types and their additions; an instance doesn't declare types of its own (Q5).
- Finding instances: links (invite, public link) plus the person's own list in the app; no public directory in
  this feature (Q1). The official instance is shown on the app's page with no instance chosen (Q2).
- Device pairing doesn't exist yet: "every device of the person" is the person's settings, as for `hyper.mine`.
