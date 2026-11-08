# Implementation Plan: 013 — contacts and chat

**Branch**: `claude/sharp-yalow-64e929` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

## Summary

Contacts live in the engine (the person's settings, on every device of theirs). A friend request makes a private
Chat instance (spec 009) owned by the sender, with a one-use invite; the invite travels over the DHT (an engine
Hyperswarm on a topic derived from the recipient's identity) or as a contact link. Accepting redeems it. Chat is an
ordinary app with instances: direct conversations and groups are its private instances; group rights are
hypergraph roles. Other sites get three shell-mediated calls (`hyper.people`); a `contacts` permission gives the
two official apps the whole list.

## Technical Context

**Language/Version**: JavaScript (ESM), Node ≥ 22 and Bare ≥ 1.27; Electron 42 for the shell.
**Primary Dependencies**: hypergraph/next, SwarmFS (+ `createSite({ private })`, SwarmFS spec 008), hyperswarm,
hypercore-crypto, framed-stream, z32 (all already in the tree; now declared).
**Testing**: brittle, `npm test` / `npm run test:bare` (local DHT), `npm run test:sandbox` (shell guards).
**Target Platform**: Windows and Linux desktop.
**Constraints**: sites are strangers (constitution I); the engine is test-first (II); Node and Bare (III).
**Scale**: ≤ 1000 contacts, ≤ 100 incoming requests, a few groups of ≤ 50 people.

## Constitution Check

- I. Sites are strangers: a site reaches contacts only with the `contacts` permission, asked once and remembered
  per site; `hyper.people` asks the person (request) or needs a click (open). Guards tested with them off. ✅
- II. Test-first: `test/contacts.test.js` (engine, two/three engines), sandbox self-test for the shell. ✅
- III. Node and Bare: the engine part uses Bare-compatible modules only (hyperswarm, framed-stream). ✅
- IV. Compose: hypergraph's private spaces, roles, invites; SwarmFS sites; Hyperswarm for presence. One gap fixed in
  SwarmFS (private sites, its own branch, its own test). Gaps not worked around, filed:
  `requests-to-hypergraph.md` B5 (an invite bound to one identity) and B6 (a rendezvous on hypergraph's swarm,
  instead of a second DHT node). ⚠️ Justified: a second Hyperswarm is a composition, not a reimplementation;
  it is the smallest thing that works until B6.
- V. Smallest: no blocking, no rooms, no inbox for offline senders, no read receipts. ✅

## Research (decisions)

- **R1 Requests travel as invites.** The invite to the new direct conversation is signed by its maker: the
  recipient reads the sender's identity from it (`hypergraph/lib/invites.js` `decodeLink`), never from the
  message. No new signing, no new crypto.
- **R2 Presence.** Topic = `hash('hyperbrowser/contacts/1/' + identity)`. A findable person's engine joins it as
  server; a sender joins it as client while a request is undelivered. Messages: one JSON frame each way
  (framed-stream), `{ t: 'request', link, name }` → `{ t: 'ok', chat }`. At most 4 KB a frame. Anyone can announce
  under someone's topic (risk in spec edge cases; B5 would close it).
- **R3 The sender watches its pending conversations** (every 2 s, only pending ones: shortcut, a `members` event
  per space later): the expected identity joined → friend; anyone else → banned. A contact link's first joiner
  becomes the friend.
- **R4 Names.** Each side writes SwarmFS's `profile` record (`{ name }`, one per member) into the conversation;
  the person's name is SwarmFS's `name` setting. The request carries the sender's name for the first display.
- **R5 Chat's app key.** The shell tells the engine (`apps.set { chat }`) from its preset; tests do the same.
- **R6 Group rights** are hypergraph roles: `member` (post only), a Chat-defined `inviter` (`post`, `invite`),
  `moderator`, `admin`. Group invites are records inside the direct conversation (a link + the group's name).
- **R7 Clicks.** The preload honors `hyper.people.chat/contact` only while `navigator.userActivation.isActive`.

## Project Structure

```text
engine/contacts.js          contacts, requests, links, the watch loop, presence (Hyperswarm)
engine/index.js             routes contacts.*, apps.set, site.permit; instances.create { private }
shell/main.js               'people' IPC (open chat/contact, request with a dialog); permission dialog; apps.set
shell/site-preload.cjs      hyper.contacts.*, hyper.people.*
shell/frame.js              open(key, query) for the shell's own calls
shell/preset.json           chat and contacts entries (keys once published)
sites/chat/                 the Chat app (instances: direct conversations, groups)
sites/contacts/             the Contacts app
test/contacts.test.js       engine: requests (DHT), links, accept/decline/remove, guards, permission
test/chat.test.js           Chat's lib on the site API: messages, groups, rights, a removed member
docs/site-api.md, docs/chat.md, sites/home (start page)
```

## Contracts

[contracts/site-api.md](contracts/site-api.md): the engine messages and the site API.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| A second Hyperswarm in the engine | requests by key need a rendezvous hypergraph doesn't offer | a mailbox space can't be found from a key alone |
