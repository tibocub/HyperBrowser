# Plan: 005 — the official site

- **HyperMD, ahead of time.** The shell serves a site's files as they are; rendering `.hmd` in the shell would
  need a page list it doesn't have (for the menu) and is milestone 1's open "how the shell renders HyperMD".
  So `sites/home` is the source, and its `hypermd build` output is both what `publish` sends and what GitHub
  Pages serves. Relative links (the builder's) work under `hyper://<key>/` and `/<repo>/` alike. The shell
  rendering HyperMD itself can come later without changing the source.
- **HyperMD as it is**: `build`, `applyLayout` (via `_layout.hmd`), `siteMenu` (via `::menu`), `::page`, `::toc`,
  `:::note`, tables. Nothing was missing: no HyperMD change.
- **HyperBrowser depends on HyperMD** (dev only: the test and `home:build`), `file:../HyperMD` like hypergraph.
- **Look in CSS only**: the first `h1` of `<main>` is the title bar (stripes from `::before` / `::after`); no
  close box (a page can't close).
- **Fonts**: Cozette Vector 1.30.0 woff2 from `shell/ui/fonts` (MIT); IBM Plex Mono 400, 400 italic, 700,
  latin subset, from `@fontsource/ibm-plex-mono` 5.2.5 (OFL 1.1; copyright line IBM's).
