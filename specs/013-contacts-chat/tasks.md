# Tasks: 013 — contacts and chat

## Phase 1: Setup

- [x] T001 SwarmFS branch `008-private-sites`: `createSite(name, { private })`, test on Node and Bare
- [x] T002 Worktree `node_modules`: junctions to the main checkout's, `swarmfs` → the SwarmFS worktree
- [ ] T003 package.json: declare hyperswarm, hypercore-crypto, z32 (already in the tree)

## Phase 2: Foundational (engine)

- [ ] T004 [US1] test/contacts.test.js: request by key over the DHT, accept, both friends, one conversation (fails first)
- [ ] T005 [US1] engine/contacts.js: settings, request, accept, decline, remove, rename, presence, watch loop
- [ ] T006 [US2] tests + code: contact links (one use; a non-Chat link refused); findable off never announces
- [ ] T007 [US4] tests + code: `contacts` permission (`NEEDS_PERMISSION`, `site.permit`, `NOT_ALLOWED` without),
  each guard with a control (guard off → test fails)
- [ ] T008 [US3] engine: `instances.create(name, { private })`

## Phase 3: Apps

- [ ] T009 [US1] sites/chat: conversations list, messages live, send/edit/delete (lib + page)
- [ ] T010 [US3] sites/chat: groups (create private, add friends by invite in the direct conversation, rights)
- [ ] T011 [US3] test/chat.test.js: Chat's lib on three engines: grant inviter, a moderator deletes, a removed member reads nothing new
- [ ] T012 [US1] sites/contacts: list, requests, add by key or link, my name and findable, a contact's page

## Phase 4: Shell (calls between apps)

- [ ] T013 [US4] preload: `hyper.people.*` (click rule), `hyper.contacts.*`; main: 'people' IPC, request dialog, permission dialog, `apps.set` from the preset
- [ ] T014 [US4] sandbox self-test: a site without the permission gets NOT_ALLOWED; people.chat without a click opens nothing

## Phase 5: Polish

- [ ] T015 docs/site-api.md, docs/chat.md (users), sites/home start page, package.json scripts (chat:publish, contacts:publish)
- [ ] T016 requests-to-hypergraph.md B5, B6; README
- [ ] T017 Full suites: Node, Bare, sandbox
