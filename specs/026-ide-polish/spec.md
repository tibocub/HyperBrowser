# Feature Specification: 026 — IDE polish (Tibo's first try by hand)

**Feature Branch**: `026-ide-polish` · **Created**: 2026-11-18 · **Status**: Draft (from Tibo's hand test of 025, via
the lead) · **Needs**: 024, 025 (merged in main 0244f5d)

Tibo tried the IDE by hand. HTML, CSS and JS previews work; "the IDE even edits and previews itself". What follows
is his feedback.

## Bugs

- **B1 HyperMD preview.** Opening `sites/home` (HyperMD) and previewing fails: "site.json names index.html, which
  isn't in the folder (INVALID_MANIFEST)". With `entry: index.hmd` the preview is blank. `index.html` is the right
  entry: `.hmd` pages compile to `.html`. Every `.hmd` is built before the preview (and Publish) checks the manifest,
  all of them, not only the open one.

## Layout (all our apps)

- **L1 Toolbars wrap.** The Preview/Publish/… bar and the Undo/Redo/Search/Save bar wrap or rearrange when the window
  is narrow, never overflow.
- **L2 Width.** "About 50% of a full-screen window goes unused." The shared theme's max width goes up about 1.5×,
  and apps get a way to use the full width (the IDE and Chat use it; the Forum already does).
- **L3 App pages never scroll as a whole.** Apps (Chat, Forum, IDE) fit the window exactly; only specific parts
  scroll. Simple sites (the home site) keep a normal scrolling page.
  - IDE: the editor fills what is left and scrolls inside; the file tree scrolls.
  - Chat: the messages and the contacts/groups list scroll. Today, below some window size, Chat's main panel shrinks
    slower than the window and the page gets a scrollbar: it fits at every size, down to a small window.
  - Checked by resizing the window (self-test or framecheck): no page scrollbar at several sizes.
- **L4 Custom scrollbars** that fit the pixel-perfect look ("everything is custom except the scrollbars"), in the
  shared theme so every app gets them.
- **L5 Buttons overlapping when pressed.** Square buttons stacked with no gap (the IDE's file rows) slightly cover the
  one below when clicked (the diagonal press shift); the "…" buttons don't. Tibo: "put enough space between stacked
  buttons so overlapping never happens", rather than layering tricks. In the theme.

## IDE

- **I1 The file tree**, like a simpler VS Code explorer: folders that open and close, nesting, icons for folders and
  files, selection, rename in place.
  - **Right-click** opens the context menu (no per-row "…"): the current actions plus copy, cut, paste, new file,
    new folder; keyboard access (Menu key, Shift+F10).
  - A reusable component: HyperBrowser's own file manager (a SwarmFS client) is the next app and reuses it.
  - The beginners' page list stays as it is ("Tibo likes it"); folders for grouping pages come later.
- **I2 Show/hide the file tree** with a button, for more editor room; the choice remembered.
- **I3 IDE settings**: line wrapping on/off and a few editor controls (tab size, font size, …): a small first set,
  saved per person (`hyper.mine`).

## Design guidance (Tibo)

The Macintosh inspiration shouldn't make things too minimal or retro. For the IDE (and the Forum) the UI may be
slightly richer so it covers the features comfortably; "the old file list was too simple". The overall look is
"nailed": keep it.

## Requirements

- **FR-001** B1: preview and publish `sites/home` as a project with `entry: index.html` (a regression test).
- **FR-002** L1–L5 in the shared theme (`shell/ui/theme.css`) and the apps; the self-test or framecheck resizes the
  window and finds no page scrollbar in the apps at several sizes.
- **FR-003** I1–I3; the tree a reusable component with a documented API; its menu reachable by keyboard.
- **FR-004** Docs (`docs/ide.md`, the theme's docs), regression tests, self-test/framecheck checks, perf
  (`npm run perf:ide`: what the tree or the scrollbars cost), Node, Bare and sandbox suites.

## Not covered

Folders in the beginners' page list. The file manager app itself (next).
