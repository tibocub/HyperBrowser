# Contract: the windowless engine

```bash
node engine/cli.js publish <folder> [--dir <engine folder>]
node engine/cli.js open <key | hg:link> [--dir <engine folder>]
bare engine/cli.js ...        # the same on Bare
```

Options: `--dir` (default `~/.hyperbrowser`), `--bootstrap host:port[,host:port]` (a test network),
`--once` (stop after the first output instead of staying online: scripts and tests).

- `publish`: prints `key: <z32 key>` (and `created` the first time), then stays online seeding and publishing
  the folder's edits until Ctrl+C. Exit 1 with the reason on a bad folder or `site.json`.
- `open`: prints `key:`, `title:`, `entry:`, `dynamic:`, and `entry bytes: <n>`, then stays online holding
  what it read. Exit 1 with the error code and message if it can't open.
- Ctrl+C (SIGINT) closes the engine cleanly.
