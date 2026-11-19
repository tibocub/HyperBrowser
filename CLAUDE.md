# HyperBrowser: guide for contributors and agents

A P2P browser: an Electron shell (`shell/`), an engine on Bare and Node (`engine/`), and the official apps as
sites (`sites/`). Start with [README.md](README.md); setup and workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

## Run the tests

```bash
npm test && npm run test:bare && npm run test:sandbox && npm run selftest
```

Point the temp folders at a disk with room. On this machine C: is nearly full, so use E: (PowerShell):

```powershell
$env:TMP = 'E:\Code\P2P\.tmp\tmp'; $env:TEMP = $env:TMP; $env:HG_TEST_TMP = $env:TMP
```

## Where things are written down

- `docs/`: how each part works now, for developers ([index](docs/README.md)). Update the doc with the code.
- `sites/home/`: the user documentation (the official site).
- `specs/`: design history, one folder per feature. Don't edit past specs.

## Comments

A comment says why the code is the way it is, when the code can't: a subtle bug it avoids, a security choice,
a platform quirk, a measured limit. Keep it short. No comment that restates the code, no spec numbers, no dates.
