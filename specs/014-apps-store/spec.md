# Feature Specification: 014 — the Apps store

**Feature Branch**: `claude/014-apps-store-6f3a69`

**Created**: 2026-11-09

**Status**: Answered (Tibo, 2026-11-09)

**Input**: Tibo is tired of publishing each official app by hand and pasting keys into `shell/preset.json`. He
chose: first a publish-all script that writes the keys (`npm run apps:publish`, done before this spec), then an
"Apps" site: an index of app keys with one-click install, so new apps reach people without a HyperBrowser release.
Bundling app files inside HyperBrowser was rejected (copies drift; chat conversations point to Chat's key).

## Clarifications

### Session 2026-11-09 (Tibo)

- Q1 Which apps a new HyperBrowser has installed → **Home, Forum, Apps, Chat, Contacts**. Chat stays preset:
  its key is what friend requests trust, so everyone needs the same one from the first start. The store lists
  Chat and Contacts too.

### Decided here (recommended, Tibo may change)

- How Tibo adds an app to the store → **a line in `scripts/apps.js`** (its folder) and a `description` in its
  `site.json`; `npm run apps:publish` publishes it and writes or updates its entry. No form, no new UI: the
  store's records are written by the same command that publishes. An owner-only form for apps not in this repo
  (someone else's key) is a later step.

## Words

- **App**: an ordinary site (usually dynamic). The store holds nothing of it but an entry.
- **Entry**: an `app` record in the store's own space: `key`, `title`, `about` (one line), `icon` (a `data:image/`
  URL), `order`. Only the store's owner and its admins write entries (the type's `put` and `editable` need
  `decide`).

## User Scenarios

### US1 — Find and install an app (P1)

A person opens Apps (preset on the desktop): a list, each with its icon, title, one line, and **Install** (or
**Open** when installed). Install asks HyperBrowser's own question, "Install "<the app's own title>"?", with
the key; yes puts it on the desktop as installed (kept and served, spec 004). Open opens it in a tab.

**Acceptance**: the list shows the entries in `order`; Install → the shell's dialog → yes → installed, the button
says Open; no → nothing changes and the page says so.

### US2 — Tibo adds an app (P1)

Tibo adds a line to `scripts/apps.js`, a `description` to the app's `site.json`, runs `npm run apps:publish`:
the app is published, its key written in `preset.json` if it is preset, its entry added (or updated) in the store.
Everyone with Apps sees it, no HyperBrowser release.

**Acceptance**: a rerun with nothing changed writes nothing; a changed description updates the entry.

### US3 — A site can't install anything by itself (P1)

**Acceptance**: `hyper.apps.install` and `hyper.apps.open` outside a click resolve `false` and do nothing; a click
still needs the person's yes in HyperBrowser's dialog; the title in the dialog is the app's own (its site.json),
never the asking page's text. A person who isn't the store's owner or an admin can't add an entry
(`NOT_ALLOWED`).

## Requirements

- **FR-001** `sites/apps/`: a dynamic site, type `app` (`put`/`editable`: `decide`), the list live, Install/Open.
- **FR-002** `hyper.apps` for every dynamic site: `installed(key)`, `install(key)`, `open(key)` (contract:
  `docs/site-api.md`). Handled in the shell (`shell/main.js`), like `hyper.people`.
- **FR-003** `npm run apps:publish` also publishes the store and writes the entries of the apps marked `list`.
- **FR-004** `preset.json`: `preset:apps` added (Home, Forum, Apps, Chat, Contacts).
- **FR-005** Tests: Node + Bare (entries listed, a non-owner refused, the rerun idempotent); sandbox self-test
  (install without a click: nothing; with a click, the person's no: nothing; yes: installed).

## Out of scope / later

- Entries for apps not in this repo (an owner-only form in the store).
- Removing an entry when its line leaves `scripts/apps.js` (shortcut: delete it by hand from the store's owner).
- A new preset entry reaching desktops saved before it (the frame adds preset icons only to a new desktop):
  people who installed HyperBrowser before 014 open Apps by its key or a link from the home site.
- Ratings, versions, categories, search.
