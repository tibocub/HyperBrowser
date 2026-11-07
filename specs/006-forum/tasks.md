# Tasks: 006 — the official forum

Slices: each one commit, with its tests and docs. `[test]` = written first, fails before.

## Slice 1 — engine additions, boards and threads (US1, US3.1–2)

- [ ] T001 [test] `test/engine.test.js`: `site.json` `types` and `public` checked (`INVALID_MANIFEST`)
- [ ] T002 [test] `test/site-api.test.js`: a site's own types written by a visitor-member; `public: false` keeps
  strangers out, an invite lets them in; `mine.all` / `mine.set` on the person's settings, refused before consent
- [ ] T003 `engine/manifest.js`, `engine/index.js` (publish with types, declare on republish, public),
  `mine.*`; `shell/site-preload.cjs` `hyper.mine`; `engine/cli.js --invite`
- [ ] T004 `sites/forum`: `site.json` with the types, `index.html`, `style.css`, fonts, icon, `lib/forum.js`
  (boards, threads), `app.js` (front page)
- [ ] T005 [test] `test/forum.test.js`: owner publishes, invites; member joins; boards (admins only, sub-boards);
  threads listed on both peers
- [ ] T006 docs: `docs/site-api.md` (types, public, mine), `docs/engine.md` (`--invite`), requests-to-hypergraph B3

## Slice 2 — a thread (US2)

- [ ] T007 [test] replies tree, votes (latest per member, taken back), edit (marked), delete (refused for others;
  replies stay)
- [ ] T008 `lib/view.js` tree; `lib/text.js` subset; the thread page with folding, votes, reply, edit, delete

## Slice 3 — members and moderation (US3)

- [ ] T009 [test] report → reports list; hide / reveal; ban → posts refused; admin makes a moderator; invites from
  the forum
- [ ] T010 members page (roles, invite), moderation page, report / hide / ban buttons

## Slice 4 — sorting, unread, mentions, who you are (US4, US5)

- [ ] T011 [test] the four sorts; unread and new across a restart (`mine`); mentions list, name change shown;
  icon from key, drawn icon seen by others
- [ ] T012 sort bar, unread marks, Mentions page, mention suggestions, You page (name, icon editor)

## Slice 5 — docs and screenshots

- [ ] T013 `docs/forum.md`, `sites/home/forum.hmd` (+ menu), README; screenshots light and dark (front page,
  thread)
- [ ] T014 `npm test`, `npm run test:bare`, `npm run test:sandbox`, one after another

## Left

(filled at the end)
