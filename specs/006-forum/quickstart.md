# Quickstart: 006 — try the forum

1. Publish it (a terminal that stays open: the owner's engine):

   ```bash
   npm run forum:publish -- --dir E:/Code/P2P/.tmp/forum-owner --invite admin
   ```

   It prints `key: …` and `invite: hg:…`.
2. In another terminal, `npm start`, paste the `hg:` link in the address field, allow the identity question.
3. You are an admin: pick your name, make a board (**+ New board** under the boards), a thread, a reply; vote.
4. Make a member invite from Members → Invite, open it in a second HyperBrowser (`npm start -- --dir <another
   folder>`) and reply from there: the first window shows it without reloading.

Tests: `npm test -- test/forum.test.js` (Node) and `npm run test:bare -- test/forum.test.js` (Bare).
