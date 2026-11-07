# Quickstart: validating 001

Prerequisites: `hypergraph` and `SwarmFS` next to this repo (`E:\Code\P2P\` or `~/P2P/`), `npm i` in each.

```bash
npm i
npm test               # engine, protocol, site API, two engines: Node
npm run test:bare      # the same on Bare
npm run selftest       # the sandbox self-test: last line "SELFTEST PASS"
npm run selftest -- --no-guards   # the control run: must end "SELFTEST FAIL"
```

By hand:

```bash
node engine/cli.js publish shell/selftest/site --dir .data/owner     # prints key: ...
node engine/cli.js open <key> --dir .data/visitor                     # title, entry, bytes
npm start -- --open <key>                                             # the site in a window
```

Expected: the same key on a second `publish`; the visitor's entry bytes equal the file's size.
On Windows set `HG_TEST_TMP` to an SSD folder for the tests.
