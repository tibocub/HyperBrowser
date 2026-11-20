# Contributing

## Set up

You need Node 22 or newer and git. HyperBrowser uses sibling checkouts as `file:` dependencies, so clone them
side by side in one folder:

```
P2P/
  swarmwire/   hypergraph/   SwarmFS/   hyperDNS/   HyperMD/   HyperBrowser/
```

Run `npm install` in each, in that order, then `npm start` in `HyperBrowser`. The [README](README.md) has the
big picture; [docs/](docs/README.md) explains each part.

`npm run typecheck` reads the siblings' own types: run `npm run types` in each of them too (they build
`dist/types/`, which a `file:` link doesn't make).

## Test

```bash
npm run typecheck      # TypeScript, strict, over the JSDoc: no error
npm test               # every test/*.test.js on Node, in parallel
npm run test:bare      # the same files on Bare
npm run test:sandbox   # Electron: the sandbox self-test, its control run, the frame check, the tray
npm run selftest       # the sandbox self-test alone, in a window: its last line is SELFTEST PASS
```

`npm run test:all` runs the first three. One file: `node scripts/test-runner.js test/forum.test.js`.

Tests write many temp folders. `HG_TEST_TMP` chooses where (it also sets `TMP` and `TEMP` for the test
processes); put it on a fast disk with a few GB free. `HB_TEST_JOBS=2` runs two files at a time instead of one
per core.

Some changes have a cost check under `perf/` (`npm run perf`, `perf:circles`, `perf:helper`, `perf:names`,
`perf:projects`, `perf:ide`). Run the one for the part you touched.

On Linux, if Electron stops with "The SUID sandbox helper binary was found, but is not configured correctly",
fix the helper's permissions; never use `--no-sandbox`, which turns off the OS sandbox the site views rely on:

```bash
sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Send a change

1. Branch from `main`.
2. Keep the change to one thing. A new feature usually starts as a spec in `specs/` (see the existing ones).
3. Add or update a test next to the ones for that part (`test/`, or the self-test in `shell/main.js` for
   anything only a real window shows).
4. Update the doc in `docs/` that describes the part, and `sites/home` if people using HyperBrowser see it.
5. Run the test commands above; all must pass, `npm run typecheck` included.
6. Open a pull request saying what changed and why.

## Style

- [standard](https://standardjs.com/) JavaScript style: no semicolons, two spaces.
- Types in JSDoc, checked by `npm run typecheck` ([CLAUDE.md](CLAUDE.md), "Types", says how).
- A comment says why the code is the way it is, when the code can't. Don't restate the code, and don't refer
  to spec numbers, dates or people: that history lives in `specs/` and git.
- Docs describe how things work now, not how they got there.
- No new dependency for a few lines of code.
