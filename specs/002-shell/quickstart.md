# Quickstart: 002 — the shell's interface

1. Publish a test site (one terminal, stays open):

   ```bash
   node engine/cli.js publish shell/selftest/site --dir E:/Code/P2P/.tmp/hb-owner
   ```

   It prints `key: …`.

2. Launch HyperBrowser (another terminal):

   ```bash
   npm start
   ```

   Expected: the window, "HyperBrowser ▾", the Desktop tab, the toolbar, the desktop with the official site and
   forum ("not published yet").

3. Paste the key in the address, Enter: a new tab with the site; the address reads `Title · abcdef…xyz`; the
   state on the right shows peers and complete/loading.

4. Back/forward after following a link; ☆ adds a bookmark on the desktop; drag it to another cell; restart:
   still there. Menu → Settings → Dark: the frame inverts.

5. Tests: `npm test`, then `npm run test:bare`, then `npm run test:sandbox` (one after another).
