# HyperBrowser: guide for contributors and agents

A P2P browser: an Electron shell (`shell/`), an engine on Bare and Node (`engine/`), and the official apps as
sites (`sites/`). Start with [README.md](README.md); setup and workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

## Run the tests

```bash
npm run typecheck && npm test && npm run test:bare && npm run test:sandbox && npm run selftest
```

Tests write to the system temp folder (`HG_TEST_TMP` to change it).

## Where things are written down

- `docs/`: how each part works now, for developers ([index](docs/README.md)). Update the doc with the code.
- `sites/home/`: the user documentation (the official site).
- `specs/`: design history, one folder per feature. Don't edit past specs.

## Types

`npm run typecheck` must pass with no error (a test enforces it): TypeScript in strict mode over JSDoc, nothing
compiled. One config per runtime: `jsconfig.json` (engine, scripts, `shell/updater.js`: Node and Bare),
`shell/jsconfig.json` (Electron), `shell/ui/jsconfig.json` (the frame page), `sites/jsconfig.json` (pages: the DOM,
no Node). Real `@typedef`s, and the libraries' own types for their values (hypergraph, SwarmFS, HyperMD); `any`,
casts and `@ts-expect-error` only with a one-line reason. A cast never starts a line: without semicolons, `(` there
joins the line above. The site API is `sites/hyper.d.ts`: change it with `shell/site-preload.cjs` and
`engine/index.js` (a test checks it lists what the preload gives). Untyped packages: `types/modules.d.ts`.

## Comments

A comment says why the code is the way it is, when the code can't: a subtle bug it avoids, a security choice,
a platform quirk, a measured limit. Keep it short. No comment that restates the code, no spec numbers, no dates.
