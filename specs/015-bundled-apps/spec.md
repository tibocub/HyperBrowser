# Feature Specification: 015 — bundled apps

**Feature Branch**: `claude/015-bundled-apps-e5eff6`

**Created**: 2026-11-09

**Status**: Draft (design chosen by Tibo through the lead session)

**Input**: `npm run apps:publish` publishes Home, Forum, Apps, Chat and Contacts from Tibo's owner folder and
stops, so nobody serves them: a new install can't open its own desktop. Copies of the app files were rejected
(they drift, and Chat's key is what friend requests trust). Chosen: ship each app's own signed P2P data (same
keys) inside HyperBrowser; a new install starts with it, and peers update it as usual.

## Words

- **Snapshot**: what a visitor of a public site would download of it, written to a folder: its space, its
  pages sub-space, their decisions and writers' logs (all signed by their writers), and the bytes of its files
  too big to sit in a record. Nothing else: no keys, no identity, no personal space, no settings.
- **Bundle**: the snapshots of the preset apps, packed by `npm run build` into the app.

## User Scenarios

### US1 — A new install opens its apps offline (P1)

A person installs HyperBrowser and starts it with no network (or with nobody serving the apps). The desktop's
preset apps open at once, every page; they are installed (kept and served) as before.

**Acceptance**: a fresh engine imports the bundle with no network; every page of every bundled app reads.

### US2 — The apps still update from peers (P1)

Tibo publishes a new version of an app after the build. An install that started from the bundle gets it from
any peer holding it, as if it had always been a visitor; a bundle never takes an app back to an older version.

**Acceptance**: an edit published after the snapshot reaches the importing engine from a peer (local DHT); an
engine holding a newer version than a bundle keeps the newer one after importing it.

### US3 — Tibo builds a release with the apps (P1)

`npm run build -- --apps-from <owner engine folder>` packs the preset apps' snapshots. Without `--apps-from` the
build ships no apps and warns.

### US4 — A bad snapshot can't forge an app (P1)

A snapshot is untrusted input. One whose data was changed is refused (nothing of it is used); one naming a
space that isn't public is refused; an import never lets anyone write what the site's rules don't let them.

## Requirements

- **FR-001** Export a public site held on an engine folder to a folder: its space, its public sub-spaces held
  there, their decision logs and accepted logs, whole, and the bytes of its non-inline pages and uploads held
  there. Refused for a space that isn't public.
- **FR-002** No private material in an export: no secret key, identity, device, personal space, settings, or
  any space not asked for (a test checks the folder).
- **FR-003** Import a snapshot into an engine folder: every block checked against its writer's signature as
  replication does, every log checked by the space's rules as a peer's would be, every file checked against its
  hash in a signed record. Any check failing: the import fails and no space of it is kept.
- **FR-004** Imported data is the same as replicated data: later blocks from peers append; nothing already held
  is replaced by older data (never downgrade).
- **FR-005** The build takes `--apps-from <dir>` and writes each preset app's snapshot into the app; without it,
  no apps and a warning.
- **FR-006** At start, the engine imports the bundle when this engine folder hasn't imported this bundle yet or
  holds a bundled app no more (one marker per engine folder); otherwise it costs nothing. A failed import is
  logged and the start goes on (the apps then come from peers, as before).
- **FR-007** The preset apps are installed as before (spec 004, desktop icons from the preset); with the bundle
  imported, installing needs no peer.
- **FR-008** Forum: the app is bundled. Its official instance is invite-only while testing, so it is not public
  and is not bundled (a visitor couldn't download it either); the forum icon needs a peer and an invite as before.

## Success Criteria

- **SC-001** A fresh install with no network shows every bundled app's pages within seconds of starting.
- **SC-002** A tampered snapshot is refused in every test run.
- **SC-003** A version published after the build reaches a bundled install from a peer.
- **SC-004** An export contains none of the owner's secrets (checked by a test).

## Assumptions

- The apps are small (≈ 1 MB together); the bundle's size is not a concern.
- The bundle is as fresh as the owner folder at build time; Tibo builds from his owner folder after
  `npm run apps:publish`.
- Builds and tests never touch Tibo's real owner folder except the release build he runs himself.
