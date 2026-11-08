# The engine and the shell (spec 001)

HyperBrowser has two parts:

- **the engine** (`engine/`): holds your identity, the network and every site's data (hypergraph + SwarmFS).
  It runs on Bare in the app, or on Node/Bare without a window (the command line).
- **the shell** (`shell/`): the window. Each site opens in its own sandboxed view; only the shell talks to the
  engine for a site. Its interface (tabs, address bar, desktop): [shell.md](shell.md).

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

An invite-only site (`"public": false`) is closed to anyone without an invite. `--invite member` or
`--invite admin` prints a one-use invite link after the key (dynamic sites):

```bash
node engine/cli.js publish sites/forum --invite admin
```

Paste the `hg:` link into HyperBrowser's address field: that HyperBrowser is in, as an admin.

## Open a site

```bash
node engine/cli.js open <key>          # prints the title and the entry page's size, stays online
npm start -- --open <key>              # the site in a tab of the shell
```

The command line runs the same on Bare: `bare engine/cli.js …` (`npx bare` from this repo).

## Which sites this device serves (spec 004)

- **Installed** (`site.keep(true)`) and **your own** sites: joined and served from engine start, tab or not.
- **Any other site**: joined while a tab shows it (`site.open` … `site.close`), and for a grace period after
  its last tab closes (5 min: `init`'s `grace`). Then the engine leaves its space (SwarmFS `leave`, hypergraph
  `leaveSpace`): it is no longer announced or served, and its records go from this device. Its files stay
  in app storage; opening it again joins it again (someone must be online) and reuses them.
- **At start**: before anything else, every site held here that is neither installed nor yours is left
  (sites joined by older versions, which never left one).
- **Eviction** (app storage over its cap) deletes cached files whether the space is joined or not; a site
  that isn't installed is left within the grace period of its last tab anyway.

## Tests

```bash
npm test               # Node: protocol, engine, sites, site API, hosting, two engines, the worker's heartbeat, the official site, the forum
npm run test:bare      # the same on Bare (the worker test is Node only: it is skipped there)
npm run test:sandbox   # the sandbox self-test, its control run (guards off, must fail), the frame check, the textures at 100/125/150 %
npm run selftest       # the self-test alone, in a window: last line SELFTEST PASS
npm run framecheck     # the frame alone (no OS frame, no app menu, sites under the bars): FRAMECHECK PASS
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
  WebAssembly is allowed (CSP `'wasm-unsafe-eval'`, spec 008): it runs in that same sandbox.
