# Feature Specification: 025 — the IDE (v1)

**Feature Branch**: `025-ide` · **Created**: 2026-11-17 · **Status**: Draft (grilled with Tibo, 2026-11-17) ·
**Needs**: spec 024 (projects, publish, preview, co-authors)

HyperBrowser's IDE: one place to make sites and apps, for people who have never coded (making a HyperMD site should
feel as easy as writing a document) and for developers (JS/WASM apps on a hypergraph space). A site like Chat and
Forum (`sites/ide`), using the `projects` permission (024). Light: every feature earns its place; no bloat that slows
the rest down.

## Decided (Tibo, 2026-11-17)

- **D1 Everyone**: beginners get simple, high-level actions in plain words (no file jargon needed for a HyperMD
  site; title, icon, public or invite-only easy to reach); developers get files, code and the space's setup. Word was
  only an example of how easy; don't copy its features or look.
- **D2 A site** (`sites/ide`), published as an official app like the others (preset), unless a feature truly needs
  the shell (the worker says which and why).
- **D3 Editor**: CodeMirror 6, only the parts needed (JS, HTML, CSS, JSON, Markdown/HyperMD modes, search, undo);
  bundled, loaded lazily; measure its size and the IDE's start time.
- **D4 HyperMD in the page**: `.hmd` pages built in the IDE itself (HyperMD running in the page; check it can, first),
  so a HyperMD site needs no terminal.
- **D5 Live preview** beside the editor: HyperMD as you type; JS apps reloaded on save; a dynamic app on its throwaway
  space (024 D7) with "Reset data".
- **D6 Beginners' HyperMD editing**: a toolbar (heading, bold, italic, link, image, list, quote), images added by
  picking a file, the page shown live beside it. A true WYSIWYG editor is later.
- **D7 Developers' setup**: a form for `site.json` (title, icon, entry, public/invite-only, permissions, record types
  and their fields, roles) with a raw JSON view, validated as the engine validates it.
- **D8 Projects**: list, new (from a template: HyperMD site, blank static site, dynamic app on a space), open a copy
  by key, open a folder; file tree (new, rename, delete, upload); Publish; versions and Roll back; invite co-authors
  (link or contact); members of a project; sync state (other devices, co-authors online); git state of the folder
  (branch, changed files: shown only, no git commands).
- **D9 Not in v1**: WYSIWYG, debugger/console, reading a site's data, diffs between versions, running git, a WASM
  compiler (`.wasm` files are files; the preview runs them).

## Requirements

- **FR-001** A beginner makes and publishes a HyperMD site with a title, an icon and two pages without seeing a file
  name or JSON (a scenario test through the page, plus the self-test).
- **FR-002** A developer opens a copy of Chat by its key, changes its JS, sees the change in the preview on a
  throwaway space, publishes it as their own site, and rolls back (a test).
- **FR-003** Two people co-author one project: both edit, either publishes (a test with two engines).
- **FR-004** Accessible (keyboard, labels), Tibo's UI rules (no cluttered lists, "…" menus, no layout shift),
  the shell's look.
- **FR-005** Docs (`docs/ide.md`, a user guide in plain words, and how to develop an app with it), regression tests,
  the sandbox/self-test checks of the IDE, perf (IDE start time, preview reload time, memory) in `perf/`.

## Not covered

D9's items.
