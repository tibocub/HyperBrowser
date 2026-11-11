# Quickstart: validating 016 — notifications

Set `TEMP` and `TMP` to `E:\Code\P2P\.tmp` first.

## Automated

```bash
node test/notifications.test.js
npm test
npm run test:bare
npm run test:sandbox
npm run framecheck
npm run perf
```

Expected:
- `notifications.test.js`, two engines on a local DHT, no site view: a message notifies; own records don't; a late
  arrival and a clock-ahead author both notify; a first yes and a joined history don't; a block stops it; a restart
  catches up with one summary; more places than the limit are all reached within one turn.
- Sandbox self-test: a page can't read notifications or settings, and `viewing` can't silence another app. Those checks
  fail in the control run.
- Frame check: counter, list, icon counts, Configuration page.
- In hypergraph, for B7: its tests, the forum scenario, `npm run perf`; then SwarmFS's suite.

## By hand (Windows and Linux)

Two HyperBrowsers with `--dir`, one in the tray:
1. Send a message: the popup shows with the text, the tray is marked.
2. Click it: the conversation opens at the latest message, and the counter goes down.
3. Look at the conversation, window focused: no popup.
4. Configuration: hide content, then block Chat: text gone, then nothing.
