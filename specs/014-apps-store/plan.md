# Implementation Plan: 014 — the Apps store

## Summary

An ordinary dynamic site (`sites/apps`) whose `app` records only its owner/admins write; the page lists them and
asks the shell to install or open an app (`hyper.apps`, shell-side, a click + the person's yes, as `hyper.people`).
`npm run apps:publish` (scripts/apps.js) publishes the store and writes its entries from the apps' `site.json`.

## Research (decisions)

- **Who may write entries**: hypergraph type permissions (`put: { permission: 'decide' }`, as the forum's
  `board`): enforced by every peer when applying, so nothing in the page needs to check.
- **How entries are written**: by `apps:publish` on the owner's engine, through `site.call` (the owner consents
  for its own engine, as `cli.js --instance`). Matched by `key`: put when missing, edit when a field differs.
- **Icons**: the page can't load another site's files (one origin per view), so the entry carries the icon as a
  `data:image/…` URL (≤ 16 KB; the official icons are < 3 KB). The page shows only `data:image/` URLs.
- **The install question**: the shell opens the app (`site.open`) and puts the app's own title and its short key
  in the dialog; the asking page's words are never shown. Install = the frame's install (icon kind `installed`,
  `site.keep`), the same as the desktop's right-click.
- **installed(key)**: tells a page whether one key it names is installed. A small leak (a site can probe keys it
  knows); accepted: the store needs it for Install/Open, and only installs, not other sites, are visible.

## Project Structure

```
sites/apps/          site.json (type app), index.html, app.js, icon.svg
shell/site-preload   hyper.apps → ipc 'apps'
shell/main.js        apps(): click check, dialog, frame install/open; self-test checks
shell/frame.js       install(key, title), installed(key) on startFrame's return
scripts/apps.js      APPS (+ Apps, `list`), entries written after publishing
test/apps.test.js    entries, non-owner refused, rerun
shell/selftest/site  hyper.apps without a click
```

## Contracts

`docs/site-api.md` "Apps: install or open another site".
