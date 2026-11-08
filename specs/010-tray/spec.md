# Feature Specification: 010 — the tray

**Feature Branch**: `claude/010-tray-6ce988`

**Created**: 2026-11-08

**Status**: Built (for Tibo to try)

**Input**: lead session, 2026-11-08: the engine stops when the window closes, so Tibo's official forum is online
only while a window (or `forum:publish`) runs. The milestone 1 design
(`hypergraph/specs/research/hyperbrowser-milestone-1.md`) says: a tray, on by default, easy to turn off.

## User Scenarios & Testing

### User Story 1 - Closing the window keeps hosting (Priority: P1)

Tibo closes the window. HyperBrowser stays in the tray and keeps serving his installed sites, his own sites
and his joined forums. The first time, a notice says so and where to turn it off.

**Independent Test**: `test/sandbox.electron.js` "the tray: …" (`--traycheck quit`).

1. **Given** the default settings, **When** the window closes, **Then** it hides, the engine keeps answering
   past its heartbeat, and the tray shows "hosting N sites".
2. **Given** the first close to the tray, **Then** the notice "HyperBrowser keeps running in the tray to host
   your sites; turn this off in HyperBrowser ▾" (Windows: a balloon; Linux: a notification); never again,
   at any later launch (`settings.trayNoticed` in `shell.json`).
3. **Given** the tray, **When** "Open HyperBrowser" (or a click on the icon, Windows), **Then** the window
   comes back as it was (tabs and pages kept).

### User Story 2 - Quit, or turn it off (Priority: P1)

**Independent Test**: the same test, `--traycheck quit` then `--traycheck off` on the same data folder.

1. **Given** the tray, **When** its Quit, **Then** the process ends (engine stopped, its folder free: the next
   launch starts an engine on it).
2. **Given** "HyperBrowser ▾" → When the window closes → **Quit**, **Then** no tray icon, and closing the
   window ends the process, as before 010. Remembered (`settings.tray`).

### User Story 3 - One HyperBrowser (Priority: P1)

**Given** HyperBrowser in the tray, **When** launched again, **Then** the second launch shows the first one's
window and ends, without starting a second engine on the same folder.

## Requirements

- **FR-001** `shell/tray.js`: the tray (icon `shell/icons/tray.png`, 16×16, 1-bit: hb.png at 2×, a black
  ring and a white inside so it reads on dark and light taskbars), its menu: Open HyperBrowser, the status
  line (a disabled item, refreshed every 10 s from the engine's `hosting`), Quit.
- **FR-002** `shell/frame.js`: `settings.tray` (default true) and `settings.trayNoticed`; the window's
  `close` is prevented and the window hidden while there is a tray; Quit destroys the window, which takes
  the existing path (`closed` → views closed → `window-all-closed` → `shutdown()` → `app.quit()`).
- **FR-003** `shell/main.js`: `app.requestSingleInstanceLock()`; `second-instance` shows the window. Not with
  `--dir` (another folder is another HyperBrowser: the two-peer setups in the quickstarts) nor in the checks.
- **FR-004** Engine: `hosting` → `{ sites }`, the top-level spaces joined here (installed, own, joined
  instances, open or in their grace period).
- **FR-005** Linux: a tray only if the session bus has `org.kde.StatusNotifierWatcher` (asked with `gdbus`);
  otherwise none, and closing quits rather than leaving a process nobody can see.

## Decisions

- **Open tabs stay when the window hides.** Kept, not closed: reopening shows the window as it was (closing
  them would lose the tabs: the frame doesn't restore tabs), and Chromium throttles hidden pages. The cost: a
  site open in a tab is served for as long as HyperBrowser runs in the tray, not only 5 minutes after the
  window closes. Close its tab to let 004's grace period apply.
- **Quit = destroy the window**, not `app.exit()`: the views close with it first (`app.exit()` with views
  still open left the process running, Windows, Electron 42), then the same shutdown as closing without a
  tray. The test checks the process ends, and that the engine folder is free afterwards.
- **The heartbeat is unchanged**: the shell's ping runs in the main process, which keeps running with the
  window hidden (checked: the engine answers after 2 heartbeats hidden).

## Not done

- A second launch with `--open <key>` doesn't open that key in the first window (it only shows it).
- Start with the system (login item): not asked; Pear packaging comes next.
- macOS (not a target of milestone 1).
