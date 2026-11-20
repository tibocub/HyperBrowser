# HyperBrowser

A peer-to-peer browser. A site lives with its owner and its visitors, not on a server: you open it by its key
(or a name such as `blog@bobsDNS`), and every visitor helps serve it. HyperBrowser comes with its own apps,
built as ordinary sites: a forum, Chat, Contacts, an app store and an IDE for making sites.

<!-- TODO: screenshot of the desktop and a site open in a tab (docs/screenshot.png) -->

Status: early. Windows and Linux; macOS builds but is untested.

## Quick start

HyperBrowser depends on sibling checkouts (`file:` dependencies). Put them side by side in one folder:

```
P2P/
  swarmwire/   hypergraph/   SwarmFS/   hyperDNS/   HyperMD/   HyperBrowser/
```

Run `npm install` in each, in that order (each one's `file:` dependencies first), then in `HyperBrowser`:

```bash
npm start
```

To have a site to open, publish the demo site in another terminal. It prints a key and stays online; paste the
key into the address bar.

```bash
node engine/cli.js publish sites/demo
```

Tests:

```bash
npm test && npm run test:bare && npm run test:sandbox
```

More on the tests, and on temp folders: [CONTRIBUTING.md](CONTRIBUTING.md).

## Types

HyperBrowser is plain JavaScript typed with JSDoc and checked by TypeScript in strict mode
(`npm run typecheck`), with nothing to compile; editors show the types as you write. The site API a page gets,
`window.hyper`, is typed in [sites/hyper.d.ts](sites/hyper.d.ts): a site's own editor reads it too
([docs/site-api.md](docs/site-api.md), "Types for your site").

## How it is built

```
 ┌──────────────── shell (Electron, shell/) ────────────────┐
 │  window, tabs, desktop, tray                             │
 │  ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
 │  │ site view│ │ site view│ │ site view│  one sandboxed   │
 │  │ (Chat)   │ │ (Forum)  │ │ (a site) │  view per site   │
 │  └────┬─────┘ └────┬─────┘ └────┬─────┘                  │
 │       └── window.hyper (preload) ── checked by the shell │
 └───────────────────────────┬──────────────────────────────┘
                             │ framed messages over one stream
 ┌───────────────────────────┴──────────────────────────────┐
 │ engine (Bare worker, engine/)                            │
 │ identity, devices, sites, notifications, circles,        │
 │ projects, contacts, names                                │
 │      hypergraph (spaces, roles)   SwarmFS (files)        │
 │      HyperDNS (names)             Hyperswarm (network)   │
 └──────────────────────────────────────────────────────────┘
```

- **The shell** (`shell/`) is the Electron window. Each site runs in its own sandboxed view: it loads only
  `hyper://<its key>/`, with no Node, no file system and no web. Only the shell talks to the engine, and it
  names the site from the view, never from the page.
- **The engine** (`engine/`) holds the identity, the network and every site's data. It runs as a Bare worker in
  the app, or on Node or Bare from the command line (`engine/cli.js`), for example on a server
  ([the helper](docs/helper.md)).
- **Sites** (`sites/`) are folders with a `site.json`. A static site serves files; a dynamic site's pages get
  `window.hyper`, the hypergraph API for the site's own space. The official apps live here: `home`, `forum`,
  `chat`, `contacts`, `apps`, `ide`.
- **SwarmFS** stores and syncs a site's files; **hypergraph** gives spaces, identities, roles and records.

## Where next

- [docs/](docs/README.md): how each part works, for developers.
- [docs/site-api.md](docs/site-api.md): writing a site.
- [CONTRIBUTING.md](CONTRIBUTING.md): setting up, testing and sending a change.
- `specs/`: the design history of each feature.

License: MIT.
