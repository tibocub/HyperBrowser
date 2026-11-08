# Feature Specification: 011 — packaging and P2P updates

**Feature Branch**: `claude/011-packaging-8f5d01`

**Created**: 2026-11-08

**Status**: Built (for Tibo to make the first release)

**Input**: lead session, 2026-11-08. HyperBrowser runs only from source (`git pull`, `npm install`, `npm start`).
Tibo wants anyone to install it and get updates without git, over P2P through Pear, the way Keet's arrive.
The milestone 1 design ("Distribution") says the same. Research first: `research.md`.

## User Scenarios & Testing

### User Story 1 - Install without git (Priority: P1)

Someone downloads and runs HyperBrowser: on Windows `HyperBrowser.zip`, extracted once, then `HyperBrowser.exe` inside it; on Linux `HyperBrowser.AppImage`.
There is no installer, no admin rights and no git.

**Independent Test**: `npm run build` makes the file; `npm run test:update` launches it (steps 2–3).

1. **Given** the repo on Windows, **When** `npm run build`, **Then** `out/dist/win-unpacked/` (the folder) and `out/dist/HyperBrowser.zip`, its
   file. **Given** the repo on Linux, **Then** `out/dist/HyperBrowser.AppImage`. On macOS (not tested),
   `out/dist/HyperBrowser.zip` with the `.app`.
2. **Given** the file, **When** it runs, **Then** HyperBrowser as from source, its data in the usual folder.

### User Story 2 - Updates arrive by themselves (Priority: P1)

Tibo releases version N+1 on his channel. Installed copies on his PC and his laptop download it while they
run, swap it in for the installed file, and start it at the next launch. The HyperBrowser ▾ menu shows a
quiet "Update ready (N+1): restart" item to start it now.

**Independent Test**: `npm run test:update` (scripted, local DHT, throwaway channel).

1. **Given** N installed and running, **When** N+1 is staged on its channel, **Then** N downloads it (its log
   says `update: ready N+1`) and it replaces the installed file: at once on Linux, when N quits on Windows.
   On Windows the old folder is then deleted.
2. **Given** the swap, **When** HyperBrowser is launched again, or "restart" in the menu is used, **Then** it runs N+1.
3. **Given** N+1 running, **Then** nothing newer is fetched (only a higher version is taken).

### User Story 3 - The data stays (Priority: P1)

**Given** an update, **Then** the same data folder: the same identity, installed sites, forums and settings.

**Independent Test**: `npm run test:update` steps 5 (identity, `shell.json` settings, `engine/`).

### User Story 4 - Development unchanged (Priority: P1)

**Given** the repo, **When** `npm start` (or `--dir`, the checks, the tests), **Then** as before 011: never
any update. A source run and an installed copy share the data folder (not at once: spec 010).

## Requirements

- **FR-001** `npm run build` (`scripts/build.js`):
  - The build for this OS, made with electron-builder: the Windows folder and its zip, `.AppImage`, or `.app` zip.
  - Built from a copy of `shell/` and `engine/` with the linked siblings copied in as real folders (no links). `asar` is off.
  - `--version`, `--upgrade`, `--out` options; caches under `out/cache`.
- **FR-002** The release channel: a pear link in `package.json` `"upgrade"`, made once with `pear touch` on
  Tibo's PC. The key pair stays in his Pear folder; the repo has only the public link.
- **FR-003** `npm run release -- <files>` (`scripts/release.js`): the folder `pear stage` takes,
  `package.json` + `by-arch/<os>-<arch>/app/HyperBrowser.<ext>`, so `pear build` is not needed.
- **FR-004** `shell/updater.js`, a Bare worker started by `shell/main.js` only in an installed build with a
  channel: pear-runtime's updater (client only, its own corestore in `<data folder>/pear-runtime`), lines
  `updating` / `ready <version> [<new folder>]` / `error …` to main. Linux, macOS: `applyUpdate()` at once.
  Windows: the new folder downloaded beside the installed one; `main.js` swaps them after the quit (plan D2).
- **FR-005** The menu: "Update ready (v): restart" (the accent), hidden otherwise; restart relaunches the
  installed file (AppImage: `--appimage-extract-and-run`, as Holepunch's template). About shows the version.
- **FR-006** `<data folder>/hyperbrowser.log` in an installed build (no console): version, channel, engine
  identity, update lines. Cut at 1 MB.
- **FR-007** `npm run test:update` (`scripts/update-check.js`): the N → N+1 path with data kept.
- **FR-008** Docs: `docs/packaging.md` (build, release, seed, install, what Windows and Linux show), the
  official site's start page ("Get HyperBrowser").

## Decisions

See `plan.md` (D1–D6).
