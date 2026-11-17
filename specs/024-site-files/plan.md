# 024 — plan (facts first)

## Facts

**1. Two devices edit one file at once** — SwarmFS keeps both. Never loses one silently.
- Each edit carries `base` (the version it replaced). The edit whose base lost the race becomes
  `name (<device>'s copy).ext` on both devices (`lib/sync.js` `editLocal`, `remote`, `conflictCopy`).
- Apart (both offline, then reconnect): SwarmFS's own `test/conflict.test.js` (8 tests) and `shared.test.js` (two people).
- **Both online, same second** (FR-002, measured 2026-11-17): scratch test on SwarmFS `e66f204`, 3 runs, 3/3:
  both devices end with `a.txt` (one version) + `a (laptop's copy).txt` (the other), same on both, in 10–16 s.
  Script: `E:\Code\P2P\.tmp\024sf\online-conflict.test.mjs`. Becomes an engine regression test (two engines).
- Gaps: none found. The copy shows up as a new file: the IDE (025) should show it.

**2. Roles**
| Spec role | Project (SwarmFS files space, private) | Site (SwarmFS site, closed/public) |
|---|---|---|
| owner | `owner` | `owner` (whoever published first) |
| co-author | `editor` (SwarmFS invite: edits every file; invites set `admins`: only owner invites) | `admin`: writes pages (pages sub-space `writeRoles: ['admin']`), may publish |
| viewer | **not possible today**: hypergraph H6 (a role without `post` in a private space never gets the key, reads nothing; SwarmFS refuses reader invites in private spaces, `NOT_SUPPORTED`) | — |
- Only an owner gives `admin` (hypergraph: roles below one's own). So the **site owner's engine grants it**: on the
  project space's `members` event and on every publish, each project member gets `admin` on the site; one removed
  from the project loses it. Joining needs a decider online anyway, so the grant lands at once in practice.
- Removed co-author: project space is private → hypergraph rotates the key on removal: no new edits readable.
  Site `removeRole` → their page writes no longer count.
- **Blocker (asked the lead)**: viewer needs hypergraph H6 (key grants to members who can't write). Proposal: 024
  ships owner + co-author; viewer when H6 lands.

**3. Where versions live** — local, beside the project, in the engine folder: `<engine dir>/versions/<site key>/<n>/`.
- Why not the project's space: a version must keep its bytes to be rolled back to. The space would keep only
  hashes; once the files change, no one holds the old bytes. Local copies always have them.
- Each version is a read-only folder; files unchanged since the previous version are hard links (no extra disk).
- The site's pages are a linked folder `<engine dir>/published/<site key>/` (as `site.publish` today): Publish =
  copy the new version over it (changed files only, removed ones deleted); SwarmFS syncs that as normal edits.
- Roll back to n = publish version n's files again as a new version (history stays linear).
- Limit: a co-author's versions are on their device; each device rolls back to what it published.

## Design (smallest that meets D1–D8)

- Project list: a person setting `hyperbrowser/projects` `{ [space key]: { name } }` (every device of the person).
  Each device links the project space to `<projects dir>/<name>` (init `{ projects }`, default `<dir>/projects`;
  the shell passes `Documents/HyperBrowser`). A co-author's engine adds the project on join.
- The site's key: `.hyperbrowser.json` `{ "site": key }` in the project (synced to devices and co-authors, never
  published: a copy of the site gets a new site). Two co-authors publishing first at once: two sites (edge, noted).
- Ignored (D4): `.swarmfsignore` gets `.git/` and `node_modules/` before every link (written if missing);
  Publish skips the same rules plus `.swarmfsignore` and `.hyperbrowser.json`.
- Publish refuses a bad `site.json` (parse, entry/icon present) before writing anything.
- Preview (D7): a draft key served from the project folder on disk (this device); its space: a throwaway private
  site (never public, nobody invited). Consent for the draft's `space` is implied (its data is throwaway);
  other permissions are asked as for any site. Reset data: leave it, make a new one.
- Permission `projects` (D8): asked once like `contacts` (`site.permit`). Calls: `projects.list, create, files,
  read, write, rename, remove, openCopy, openFolder, publish, versions, rollBack, preview, resetPreview, invite,
  inviteContact, members, removeMember, join`. Paths: `sitePath` (no `..`, no absolute, no `\`) + realpath
  check that the target stays inside the project folder (no link out).
- No SwarmFS or hypergraph change needed (except H6 for viewer).

## Tests (first), docs, perf
- `test/projects.test.js` (one engine): permission refused/asked, path escapes, CRUD, publish/versions/rollback,
  bad site.json refused, open a copy, open a folder, preview + reset.
- `test/two-engines` style: two devices sync an edit, `.git`/`node_modules` stay; same file at once → both kept;
  co-author invite → edit → publish; removed → refused.
- Docs: `docs/site-api.md`, `docs/engine.md`. Perf: `perf/projects.mjs` (sync of 1000 small files, publish time).
