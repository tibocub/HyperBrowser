# Plan: 006 — the official forum

**Branch**: `claude/006-forum-4ac663` | **Spec**: [spec.md](spec.md) | **Date**: 2026-11-07

## Summary

`sites/forum` is a dynamic site: plain HTML, CSS and ES modules, no build step, no dependency. Its data code
(`sites/forum/lib/`) takes a `hyper` object (the page's `window.hyper`) and nothing else, so the tests run the
forum's own code through the site API, against two engines on a local DHT, on Node and Bare. Three small engine
additions make the forum writable through the site API without workarounds (see research R1–R3).

## Technical Context

- **Language**: JavaScript (ES modules): the page in Electron's sandboxed view; `lib/` also on Node 22 and Bare.
- **Dependencies**: none new. The engine's `hypergraph` (spec 019's types), `swarmfs` (`createSite({ types })`).
- **Storage**: the forum's site space (records); the person's settings for read state (R2).
- **Testing**: `brittle`, `test/forum.test.js` (Node and Bare), `test/helpers.js` engines on `hypergraph/testing`.
- **Target**: HyperBrowser desktop (Windows, Linux); phone width in CSS.
- **Constraints**: no web, no other site, no scripts in posts (the view's CSP allows inline; the forum never
  inserts HTML it didn't escape).
- **Scale**: milestone 1's test forum: tens of members, hundreds of threads, thousands of replies.

## Constitution Check

- I. Sites are strangers: the forum is a site like any other; nothing new crosses the boundary but `mine.*`
  (R2), which reaches only the site's own entries of the person's settings. Pass.
- II. Test-first: engine changes (manifest `types` and `public`, `mine.*`, CLI `--invite`) get tests in
  `test/site-api.test.js` / `test/engine.test.js` first; the forum's flows in `test/forum.test.js`. Pass.
- III. Node and Bare: `lib/` is plain JS, tested on both. Pass.
- IV. Compose: no hypergraph or SwarmFS code copied; gaps go to the requests files (R2 noted there). Pass.
- V. Smallest: no framework, no bundler, no markdown library: a small escape-first renderer for the subset.
  Pass.

Re-checked after design: unchanged.

## Structure

```text
sites/forum/
  site.json          title, permissions ["space"], public false, types (data-model.md)
  index.html         the one page; hash routes (#/b/<id>, #/t/<id>, #/mentions, #/you, #/members, #/mod)
  style.css          the look (sites/home's tokens and fonts)
  fonts/             copied from sites/home (Cozette, Plex Mono, licences)
  icon.svg           32×32 1-bit
  app.js             the DOM: renders state, wires events
  lib/forum.js       data: boards, threads, replies, votes, mentions, moderation, invites, names, icons, read state
  lib/view.js        pure: sort, tree, unread, lively, relative time
  lib/text.js        pure: the HyperMD subset → escaped HTML; mentions in and out
  lib/icon.js        pure: 16×16 1-bit icons (from a key, to and from bytes, as SVG)
engine/index.js      manifest types and public at publish; mine.all / mine.set
engine/manifest.js   types (object), public (boolean)
engine/cli.js        --invite member|admin
shell/site-preload.cjs  hyper.mine
test/forum.test.js   two engines: every flow of the spec
```

## Slices (each one commit with its tests and docs)

1. Engine: `site.json` `types` and `public`, `mine.*`, CLI `--invite`; forum skeleton: boards, threads, the front
   page. (US1, US3.1–2)
2. Thread page: reply tree with folding, votes, edit, delete. (US2)
3. Moderation and members: report, hide/show, ban/unban, roles, invites in the UI. (US3)
4. Sorting, unread, mentions, names and icons. (US4, US5)
5. Docs (`docs/forum.md`, `sites/home/forum.hmd`), screenshots, full runs.
