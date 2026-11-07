# Quickstart: 006 — try the forum

1. Publish it (a terminal that stays open: the owner's engine):

   ```bash
   node engine/cli.js publish sites/forum --dir E:/Code/P2P/.tmp/forum-owner --invite admin
   ```

   It prints `key: …` and `invite: hg:…`.
2. In another terminal, `npm start`, paste the `hg:` link in the address field, allow the identity question.
3. You are an admin: make a board (☰ Boards → New board), a thread, a reply; vote.
4. Make a member invite from Members → Invite, open it in a second HyperBrowser (`npm start -- --dir <another
   folder>`) and reply from there: the first window shows it without reloading.

Tests: `npm test -- test/forum.test.js` (Node) and `npm run test:bare -- test/forum.test.js` (Bare).
