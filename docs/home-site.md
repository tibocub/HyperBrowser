# The official site (`sites/home`, spec 005)

HyperBrowser's own site: user documentation and news. Written in [HyperMD](../../HyperMD), static (no
hypergraph API, no script yet). One source, two outputs:

- **in HyperBrowser**: the built folder published with the engine's `publish` command, opened by its key;
- **on the normal web**: the same built folder on GitHub Pages.

HyperBrowser serves files as they are (it doesn't render HyperMD itself yet), so the pages are built to HTML
first, with `hypermd build`, for both.

## Files

| | |
|---|---|
| `index.hmd`, `start.hmd`, `publish.hmd`, `news.hmd` | the pages; `::page{order=N}` sets their place in the menu |
| `_layout.hmd` | the frame around every page: the menu (`::menu`), the page (`::content`), the footer |
| `style.css` | the look (linked from every page by the builder) |
| `fonts/` | Cozette (MIT, the same files as the shell's) and IBM Plex Mono, latin (SIL OFL 1.1); licences next to them |
| `icon.svg` | the 32×32 1-bit icon the desktop shows (`site.json` `icon`) |
| `site.json` | `entry: index.html`: the built page |

The look: each page is a System 1 window, its first `# heading` the striped title bar; black and white, the
links in the one accent; dark mode (the system's) is the same with ink and paper swapped.

## Edit and preview

```bash
npm run home:build                         # → out/home (gitignored)
python -m http.server 8765 -d out/home     # or any static server; open http://localhost:8765
```

## Publish in HyperBrowser

```bash
npm run home:publish                       # builds, then: node engine/cli.js publish out/home
```

It prints the site's key and stays online. The key belongs to the folder (`out/home` in this checkout) and the
engine folder (`~/.hyperbrowser`): publish from the same checkout every time to keep the key. Rebuilding while
it runs updates what visitors see. Once the official key is known, it goes in `shell/preset.json` (`preset:hb`).

## Publish on GitHub Pages

`.github/workflows/pages.yml` builds `sites/home` with HyperMD (checked out from `tibocub/HyperMD`) and deploys
it on every push to `main` that touches `sites/home`. Once, in the GitHub repo: Settings → Pages → Source:
**GitHub Actions**. The builder makes links relative, so it works under `/<repo>/`; `--url` adds `sitemap.xml`.

By hand instead: `node node_modules/hypermd/bin/hypermd.js build sites/home --out _site --url https://<you>.github.io/HyperBrowser/`,
then publish `_site`.

## Tests

`test/home-site.test.js` (in `npm test`, Node and Bare): every page builds, every link, anchor, script, style
and font resolves inside the built site; the built folder published by one engine is read file by file, byte
for byte, by a second engine.
