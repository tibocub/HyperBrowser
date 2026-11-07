# HyperBrowser

A peer-to-peer browser: sites live with their owner and their visitors, not on a server.

- Built on [hypergraph](../hypergraph) (spaces, identity, roles), [SwarmFS](../SwarmFS) (a site's files)
  and [HyperMD](../HyperMD) (pages), on the Holepunch stack.
- Desktop shell on Pear (`pear-runtime`): Windows and Linux. Android and iOS later.
- Milestone 1: the official HyperBrowser site and the official forum, opened by key.
  Design: [docs/design-milestone-1.md](docs/design-milestone-1.md).

Status: early work. Spec 001: the engine and serving sites; spec 002: the shell's interface; spec 003: install;
spec 004: installing decides which sites this device serves; spec 005: the official site (`sites/home`); spec 006:
the official forum (`sites/forum`).
Using the shell: [docs/shell.md](docs/shell.md); the engine and the command line: [docs/engine.md](docs/engine.md);
writing a site: [docs/site-api.md](docs/site-api.md); the official site: [docs/home-site.md](docs/home-site.md);
the forum: [docs/forum.md](docs/forum.md).

## Launch

```bash
npm i
npm start
```

`npm start` opens HyperBrowser on its desktop; paste a site key in the address field. To have a site to open,
publish the demo site in another terminal (it prints its key and stays online):

```bash
node engine/cli.js publish sites/demo
```

`npm start -- --open <key>` opens that site in a tab at launch.

## Tests

```bash
npm test && npm run test:bare && npm run test:sandbox
```

License: MIT.
