# Tasks: 009 — federated apps

**Input**: `specs/009-federated-apps/` (spec, plan, research, data-model, contracts/site-api.md, quickstart)
**Tests**: first, through `start(ipc)` and the site API (constitution II); Node and Bare.
**Hold**: Phase 7 (`sites/forum/`) waits for the lead's go (008-ui-polish merged).

## Phase 1: Setup

- [x] T001 SwarmFS worktree `E:\Code\P2P\SwarmFS\.claude\worktrees\app-instances`, branch `007-app-instances` from `main`
- [x] T002 This worktree tests against that branch: junction `node_modules/swarmfs` → the SwarmFS worktree (say so in the report)

## Phase 2: Foundational — SwarmFS F7 (blocks every story)

- [x] T003 Failing test in SwarmFS `test/` (new `app-instances.test.js`): `createSite(name, { app, types })` makes no pages
      sub-space, `site.app` is the app key, `site.read()` → `NOT_FOUND`; a member (not decider) can't put a `site`
      record; `visit(invite)` of an instance gives a Site with `app`; a site made without `app` has `app === null`
- [x] T004 SwarmFS `lib/types.js`: `site` type fields `{ pages: 'space', app: 'string' }` (addition at the end)
- [x] T005 SwarmFS `lib/swarmfs.js` `createSite` (`app`: no pages sub-space, record `{ app }`), `site()` (a record
      with `app` and no pages: no wait for pages); `lib/site.js` (`app` getter; `pages` may be null: `read`,
      `makePublic`, `keep`, `held` cope); docs (README/API page) and SwarmFS's full suite

## Phase 3: US1 — anyone creates an instance (P1)

- [x] T006 [US1] Failing tests in `test/instances.test.js`: A and B publish nothing; an app is published by T;
      A and B open it, allow it, `instances.create('A forum')` / `('B forum')` → each `getRole(self)` owner on
      theirs; B's `createSubspace`, `setRole`, `moderateAction`, `createInvite` on A's: refused; T has no role in
      either; `create` name rules ("1 to 200 characters"), `public` must be boolean
- [x] T007 [US1] `test/helpers.js` `siteApi()`: `instances.{list,create,join,leave}`, `instance(key)` (same api, `instance` param)
- [x] T008 [US1] `engine/index.js`: `instances.create` (sfs.createSite(name, { app: key, types: manifest.types }),
      `makePublic` if asked, adds to the setting `hyperbrowser/app/<key>/instances`, max 1000 → `TOO_BIG`);
      `instances.list` (`[{ key, name, role, public }]`); `instance` param in `target()` (listed + `site.app === key`,
      else `NOT_ALLOWED`), its scopes cached per site and closed in `release()`; `info` gains `app`

## Phase 4: US2 — join and leave (P1)

- [x] T009 [US2] Failing tests in `test/instances.test.js`: C joins A's by invite and B's (public) by public link;
      `list` shows both with names and roles; C posts in both, A and B see it; `leave(A's)` → not listed,
      `NOT_ALLOWED`, not in `hg.spaces()` here
- [x] T010 [US2] `engine/index.js`: `instances.join(link)` (`sfs.visit`; `site.app !== key` → `NOT_ALLOWED`,
      and `sfs.leave` if it wasn't held before), `instances.leave(key)` (listed only; release its scope,
      `sfs.leave`, drop from the setting)
- [x] T011 [US2] Failing test then `engine/index.js` `site.open` of an instance's key or link → `{ key: app, instance,
      manifest, dynamic }`, the instance added to its app's list (opened by the person)

## Phase 5: US3 — one fix reaches every instance (P1)

- [x] T012 [US3] Failing test: publish again with a changed page and a new type → both instances' app reads the
      new page; owner A reaching their instance gets the new type (`types()`), a member's write of it before that
      is `INVALID_TYPE`
- [x] T013 [US3] `engine/index.js` `target()` for an instance: when the app's manifest types have what the instance
      lacks and the person may decide, `declareTypes` (once per open)

## Phase 6: US4 — an app reaches only its instances (P1), and hosting (Q7)

- [x] T014 [US4] Failing tests: `instance` = another site's key, another app's instance key (listed for that app),
      an unlisted key, a non-key → `NOT_ALLOWED` / `INVALID_KEY`; `join` of a site's public link and of another
      app's instance's invite → `NOT_ALLOWED` and not held after; consent refused → `NOT_ALLOWED`; `instances.*`
      from a static site → `NOT_ALLOWED`
- [x] T015 [US4] Failing test (hosting): C joins A's instance (invite-only), closes every tab, grace passes
      (`grace: 50`), restart (sweep) → still in `hg.spaces()` and reachable; same for an owned instance
- [x] T016 [US4] `engine/index.js`: `hosted()` true for a space listed in any app's list (sweep and `leaveLater`
      skip it); the guards of T014
- [x] T017 [US4] Shell: `shell/site-preload.cjs` (`hyper.instances`, `hyper.instance(key)`), `shell/main.js`
      (`bridge` passes `instance` from the page; `openSite` of an instance → app view with `?instance=`),
      `shell/frame.js` (the tab's address stays the instance's key)
- [x] T018 [US4] Sandbox self-test `shell/selftest/`: a page naming another site's key as `instance` is refused;
      the control run (guards off) lets it through

## Phase 7: US5 — the official forum as app + instance (P2) — after the lead's go

- [x] T019 [US5] `test/forum.test.js` against an instance (`siteApi(e, app).instance(key)`); its checks unchanged
- [x] T020 [US5] `sites/forum`: `public` app; start page with no instance (your forums, create, join by link, the
      official forum); `lib/` handed `hyper.instance(key)`; `?instance=`
- [x] T021 [US5] `engine/cli.js` `publish --instance "<name>"` (once per folder + engine folder), `--invite` to it;
      `package.json` `forum:publish`; report: the preset's forum key changes (Tibo republishes, lead updates)
- [x] T022 [US5] `docs/forum.md`, `sites/home/forum.hmd`

## Phase 8: Polish

- [x] T023 `docs/site-api.md` "Instances" section; `specs/requests-to-swarmfs.md` F7 status
- [x] T024 Suites one after another: SwarmFS `npm test` (its worktree), here `npm test`, `npm run test:bare`,
      `npm run test:sandbox`; hypergraph unchanged (no HyperBBS/hyperDNS run needed)
- [x] T025 Hand-over note in the shared notes folder; report branches (not merged)

## Dependencies

T001–T005 → everything. US1 (T006–T008) → US2, US3, US4. T017–T018 after T008, T010–T011. Phase 7 after the
lead's go. No parallel writers: one person, one worktree per repo.

## MVP

US1 + US4's guards: an app that makes instances and reaches nothing else.

## Done (2026-11-08)

- Built beyond the tasks: `hyper.instance(key).mine` (each forum's read state apart, under the app's one cap):
  the forum's pruning of read state would otherwise drop the other forums' entries (fixed in the API, not the app).
- Not checked: the real shell by hand (`npm start`): the start page was looked at in a browser with a stubbed
  `window.hyper` only; two shells on one machine.
