# Feature Specification: 024 — site files and projects (the IDE's groundwork)

**Feature Branch**: `024-site-files` · **Created**: 2026-11-17 · **Status**: Draft (grilled with Tibo, 2026-11-17) ·
**Followed by**: spec 025 (the IDE v1), later the file manager (which reuses this)

Today a site is published by linking a folder on disk to its pages (`site.publish`, SwarmFS `Site.publish`): SwarmFS
keeps them in sync, so every save goes live, and no version is kept. Pages can't read or write files. The IDE (025)
needs projects it can edit freely, synced across the person's devices and shared with co-authors, and an explicit
Publish.

## Decided (Tibo, 2026-11-17)

- **D1 Project = a folder on disk** (editable with any tool, git-friendly) **backed by a private SwarmFS space**
  readable only by its members: the person's devices, and co-authors they invite. Edits sync between members while
  online. Saving never publishes.
- **D2 Publish is explicit**: a project's files are copied into its site's pages at once (a new version for visitors);
  never a live link. The site is created on the first Publish.
- **D3 Versions**: each Publish keeps a snapshot of what was published (local, in the project's space or beside it:
  the worker picks and says why); "Roll back" publishes an older one again.
- **D4 Sync ignores** `.git` and `node_modules` (and the project's own ignore file), so each device keeps its own
  git; GitHub stays the place for PRs (the official apps).
- **D5 Co-authors**: invite people to a project (an invite link, as circles and chats do, also "invite a contact");
  co-authors edit the project's files and **may publish** the site: they are the site's admins (SwarmFS sites: pages
  are written by the owner and admins). Roles: owner, co-author (publishes), viewer (reads the project) — the worker
  checks what SwarmFS/hypergraph roles already give and maps to them.
- **D6 Open a copy**: a site's published files (by its key) become a new project of the person's; publishing it gives
  a new site under their key. No data (posts, messages) copied. "Open a folder" makes a project from any folder
  (e.g. a cloned GitHub repo).
- **D7 Preview**: a project's files run as a draft site on this device only; a dynamic app's draft gets a throwaway
  space ("Reset data" makes a new one). Nothing reaches the real site or its data.
- **D8 Permission**: a site may ask for `projects` (granted once by the person, as `space` is today): list, create,
  read, write, rename, delete files of the person's projects; open a copy; publish, roll back; preview; invite
  co-authors. It never reaches other sites' data, the person's contacts beyond "invite a contact", or files outside
  projects. Every path checked (no `..`, no absolute paths, no links out of the project folder).

## Requirements

- **FR-001** Engine: project calls behind the `projects` permission (D8), each tested, including path escapes and a
  site without the permission (refused).
- **FR-002** Two devices of one person: an edit on one shows on the other while both are online; `.git` and
  `node_modules` never sync. Two devices editing the same file at once: what SwarmFS does today is measured first; the
  result must keep both versions or say which won (never lose one silently) — if SwarmFS can't, the worker stops and
  reports.
- **FR-003** Publish copies the project into the site's pages as one version; visitors get it; a broken `site.json`
  (bad entry, missing icon) is refused before anything is published; Roll back works.
- **FR-004** Co-authors: invite, join, edit, publish; a removed co-author can no longer publish or read new edits.
- **FR-005** Open a copy by key; Open a folder.
- **FR-006** Preview with a throwaway space; Reset data.
- **FR-007** Docs (`docs/site-api.md`: the `projects` permission and calls; `docs/engine.md`), regression tests, perf
  (`npm run perf` and a projects scenario: sync of 1000 small files, publish time), Node and Bare, sandbox.
- **FR-008** SwarmFS or hypergraph changes, if needed, in their repos with their suites (and SwarmFS's after a
  hypergraph change); anything beyond small additions: stop and tell the lead first.

## Not covered

The IDE's interface (025). Running git from the IDE. A viewer role (reads the project, never writes): needs
hypergraph H6 (a role without `post` gets no key in a private space); co-authors only until then (lead, 2026-11-17). Reading a site's data for debugging (with the debugger, later).
