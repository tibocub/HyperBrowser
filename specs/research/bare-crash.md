# Bare test processes dying with 0xC0000409 (2026-11-18)

Seen: `renew.test.js` (11-17), `instances.test.js` (11-18), `sites.test.js` (11-11), SwarmFS `pause.test.js`
(11-14), all on Bare under the runner's load, exit 3221226505 (0xC0000409). Each passes alone.

## Cause: not a native fault

1. A test step failed: an awaited RPC call rejected with `NOT_FOUND` "not a site: KEY" (stderr from the lead's
   logs, `E:\Code\P2P\.tmp\r024-bare.log`, `rm25-run_test:bare.log`).
2. brittle re-throws a test body that throws, so it becomes an uncaught error (Node: exit 1).
3. Bare aborts on an uncaught error once a native addon is loaded: exit 0xC0000409 on Windows. Measured:
   a plain script `throw` → exit 1; the same with rocksdb-native loaded, an engine running, or brittle → 0xC0000409.
4. "not a site" was a timeout in disguise: SwarmFS `site()` waits up to `timeout` for the space's `site` record and,
   if it hasn't arrived (`complete: false`), says `NOT_FOUND` "not a site" (requests-to-swarmfs F10). Under load
   the records of a just-reached site or instance take longer than the 10 s / 30 s timeouts.

Which call it was can't be told from those logs: the runner kept only lines matching "Error", and an RPC error's
stack ends in `protocol.js` (made when the reply arrives).

## Done

- `engine/protocol.js`: a rejected request carries `method` (brittle prints it with `code`).
- `scripts/test-runner.js`: on a failed file, the whole `Uncaught …` block, and on Bare's 3221226505 with one,
  "(uncaught error: Bare aborts on one, not a native crash)".

## Reproduce (what the exit code is)

```js
// E:\Code\P2P\.tmp\bc\br.mjs, run with node_modules/bare/bin/bare: exit 3221226505
import test from 'brittle'
test('body rejects', async (t) => { await new Promise((r) => setTimeout(r, 10)); throw new Error('x') })
```

## The app

The engine runs as a Bare worker; an error escaping anywhere in it aborts the worker the same way, and the shell
then quits ("engine stopped without a word", `shell/main.js`). Bare offers `Bare.on('uncaughtException', err)` and
`Bare.on('unhandledRejection', reason, promise)` (bare-process maps them to `process.on`); with a listener, Bare
doesn't abort. `engine/worker.js` has none today. Not added here: logging and carrying on would hide real bugs;
a decision for Tibo.

## Rates

Before: 2 seen on 11-17/18 in the lead's full Bare runs (how many runs: not recorded). Here: 0 in 4 full runs (6 jobs) and 0 in 3 runs
of renew + instances ×4 with heavy files at 12 jobs: too rare to measure an after rate. The branch's own full runs: Bare 129/129; Node 127/128, `notifications.test.js`
failed with the same "not a site: KEY" (exit 1 there): the same timing failure, on Node too. The timing itself isn't
changed by this branch; the next one will name its call.
