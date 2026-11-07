# HyperBrowser

A peer-to-peer browser: sites live with their owner and their visitors, not on a server.

- Built on [hypergraph](../hypergraph) (spaces, identity, roles), [SwarmFS](../SwarmFS) (a site's files)
  and [HyperMD](../HyperMD) (pages), on the Holepunch stack.
- Desktop shell on Pear (`pear-runtime`): Windows and Linux. Android and iOS later.
- Milestone 1: the official HyperBrowser site and the official forum, opened by key.
  Design: [docs/design-milestone-1.md](docs/design-milestone-1.md).

Status: early work (spec 001: the engine and serving sites). How to run it: [docs/engine.md](docs/engine.md);
writing a site: [docs/site-api.md](docs/site-api.md).

```bash
npm i
node engine/cli.js publish <folder>     # prints the site's key
npm start -- --open <key>               # the site in a window
npm test && npm run test:bare && npm run test:sandbox
```

License: MIT.
