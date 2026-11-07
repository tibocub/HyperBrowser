# The engine and the shell (spec 001)

HyperBrowser has two parts:

- **the engine** (`engine/`): holds your identity, the network and every site's data (hypergraph + SwarmFS).
  It runs on Bare in the app, or on Node/Bare without a window (the command line).
- **the shell** (`shell/`): the window. Each site opens in its own sandboxed view; only the shell talks to the
  engine for a site. Its real interface (tabs, address bar, desktop) is spec 002.

How they talk: `specs/001-engine/contracts/protocol.md`. What a site's page gets: [site-api.md](site-api.md).

## Setup

The repos sit side by side: `hypergraph`, `SwarmFS` and `HyperBrowser` in one folder (`E:\Code\P2P\` on
Windows, `~/P2P/` on Linux). In each: `npm i` (hypergraph and SwarmFS first).

## Publish a site (owner, no window)

A site is a folder with a `site.json` and its pages:

```json
{ "title": "HyperBrowser", "entry": "index.html", "icon": "icon.png", "permissions": [] }
```

`permissions: ["space"]` makes it a **dynamic** site (its scripts get the API for its own space); without it the
site is **static** (scripts run, no API). Then:

```bash
node engine/cli.js publish path/to/site
```

It prints `key: …` and stays online: visitors read the site from you while it runs, and edits you make in the
folder reach them. The same folder always gets the same key (keep the engine folder: `~/.hyperbrowser` by
default, `--dir` to choose another; the official site's and forum's keys live in Tibo's).

## Open a site

```bash
node engine/cli.js open <key>          # prints the title and the entry page's size, stays online
npm start -- --open <key>              # the site in a window
```

The command line runs the same on Bare: `bare engine/cli.js …` (`npx bare` from this repo).

## Tests

```bash
npm test               # Node: protocol, engine, sites, site API, two engines, the worker's heartbeat
npm run test:bare      # the same on Bare (the worker test is Node only: it is skipped there)
npm run test:sandbox   # the sandbox self-test, then its control run (guards off), which must fail
npm run selftest       # the self-test alone, in a window: last line SELFTEST PASS
```

On Windows, put test temp folders on the SSD: `set HG_TEST_TMP=C:/Users/<you>/AppData/Local/Temp/hg-tests`
(PowerShell: `$env:HG_TEST_TMP = '…'`). `HB_TEST_JOBS=2` runs two test files at a time.

## Linux (not tested yet: Tibo)

The same commands. Expect from the spike:

```bash
npm run test:sandbox    # both tests pass
npm start -- --open <key>
```

If Electron stops with "The SUID sandbox helper binary was found, but is not configured correctly", fix the
helper; never use `--no-sandbox` (it turns off the OS sandbox the site views rely on):

```bash
sudo chown root node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

## Notes

- The engine stops by itself if the shell stops sending heartbeats for 6 s (a crashed or killed shell on
  Windows gives the engine no other sign).
- The first time the engine goes online on Windows, Windows Firewall may ask about `bare.exe`: allow it on
  private networks, or other devices on your network can't reach it directly.
- The sandbox: one view per site with its own storage, only `hyper://<its key>/` loads, no Node, no files, no
  web, no pop-ups, no device permissions; the shell takes the site from the view, never from the page.
