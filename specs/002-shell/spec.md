# Feature Specification: 002 — the shell's interface

**Feature Branch**: `002-shell`

**Created**: 2026-11-07

**Status**: Built (2026-11-07); FR-006's bytes held and FR-008's kept whole: spec 003

**Input**: "Spec 002, the shell's interface" (lead session, 2026-11-07), from the milestone-1 design
(hypergraph `specs/research/hyperbrowser-milestone-1.md`, "Visual identity" and "The shell", Tibo
2026-11-07) and the approved mockup (claude.ai artifact Vo3NWXhGwF6SXY74qKZRe5: `Desktop`, `Main`, `Thread`).
The forum's own pages are `sites/forum`, a later spec. Choices made without Tibo are under Assumptions.

Words used below (spec 001's, plus):
- **Frame**: everything HyperBrowser draws itself: the top bar, the tabs, the toolbar, the desktop, menus.
- **Tab**: one open site (or the desktop), shown in the taskbar.
- **Desktop**: the home: a grid of site icons.
- **Installed site**: an icon on the desktop for a site kept whole on disk, never evicted, and seeded.
- **Bookmark**: a lighter icon for a site that is cached and evicted as usual.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Launch HyperBrowser and open a site by key (Priority: P1)

Tibo runs one command. A window opens with the top bar ("HyperBrowser ▾", then the tabs), the toolbar and the
desktop. He pastes a site's full key in the address field and presses Enter: the site opens in a new tab, its
content under the toolbar, its name and a short key in the address, its state on the right.

**Why this priority**: it is the first thing Tibo can try, and every other story sits on it.

**Independent Test**: launch, paste a key published with the command line, see the site's page in a tab.

**Acceptance Scenarios**:

1. **Given** HyperBrowser is not running, **When** Tibo runs the launch command, **Then** one window opens on
   the desktop tab, with the top bar, the taskbar and the toolbar.
2. **Given** the desktop tab, **When** a full site key is pasted in the address field and Enter pressed,
   **Then** the site opens in a new tab, which becomes the current one.
3. **Given** a site tab, **When** the address field is not being edited, **Then** it reads
   `<site title> · <first 6 characters>…<last 3>`; **When** it is focused, **Then** it shows the full key.
4. **Given** text that is not a site key, **When** Enter is pressed, **Then** the frame says so and nothing
   opens.
5. **Given** a key no peer serves, **When** opened, **Then** the tab shows "loading" and then a message in the
   frame that the site could not be reached; the shell keeps working.

---

### User Story 2 - Tabs as a taskbar (Priority: P1)

Each open site is a tab in the taskbar. Tabs share the bar's width; they are not dragged or resized. Switching
tabs keeps the others open in the background (their pages keep running). The desktop is always the first tab
and can't be closed.

**Independent Test**: open two sites, switch between them, a page's state is kept; close one.

**Acceptance Scenarios**:

1. **Given** two site tabs, **When** Tibo clicks the other one, **Then** it shows without reloading, and the
   first keeps running.
2. **Given** a site tab, **When** its close control is clicked, **Then** the tab and its view go away and the
   tab to its left becomes current.
3. **Given** a site already open in a tab, **When** its key is entered again, **Then** that tab becomes current
   (no second tab).

---

### User Story 3 - The toolbar (Priority: P1)

Under the top bar, the current tab's toolbar: back, forward and reload (pixel icons), the address, a bookmark
button, and the site's state on the right: complete or loading, the number of peers, and what this device holds.

**Independent Test**: follow a link in a site, go back and forward; bookmark it; watch the state.

**Acceptance Scenarios**:

1. **Given** a site where Tibo followed a link, **When** back is pressed, **Then** the previous page shows;
   forward goes again; reload reloads the page. Back and forward are disabled when there is nowhere to go.
2. **Given** a site tab, **When** the state changes (a peer connects, the site becomes complete), **Then** the
   state on the right follows within a few seconds.
3. **Given** a site tab, **When** the bookmark button is pressed, **Then** the site gets a bookmark icon on the
   desktop and the button shows it is bookmarked; pressed again, the bookmark goes.

---

### User Story 4 - The desktop (Priority: P2)

Home is a desktop: a grid of 1-bit icons, each site's own (from its `site.json`), its title under it. Installed
sites have a solid frame; bookmarks a lighter, dotted one. The official site and forum are preset. Icons can be
dragged to another place on the grid and stay there after a restart. An icon's menu installs, makes a bookmark,
or removes it.

**Independent Test**: bookmark a site, drag its icon, restart: it is where it was left.

**Acceptance Scenarios**:

1. **Given** a first launch, **When** the desktop shows, **Then** the official site and forum are on it
   (installed), even before their keys are known to this build (then marked "not published yet").
2. **Given** an icon, **When** it is double-clicked (or Enter on it), **Then** its site opens in a tab.
3. **Given** an icon dragged to an empty cell, **When** HyperBrowser restarts, **Then** it is still there.
4. **Given** an icon's menu, **When** "Install" is picked, **Then** the icon shows as installed and the site is
   in "Installed" in the HyperBrowser menu.

---

### User Story 5 - The HyperBrowser menu and the look (Priority: P2)

"HyperBrowser ▾" opens a menu over everything: your identity (short key), installed sites (each opens), "Open a
site by key…", settings (light, dark or as the system; the accent), "About". The whole frame follows the visual
identity: black and white plus one accent, Cozette, pixel icons, box-drawing separators; dark mode is the same
design inverted.

**Independent Test**: open the menu over a site, pick dark, restart: still dark.

**Acceptance Scenarios**:

1. **Given** the menu open, **When** an installed site is picked, **Then** it opens (or its tab is selected).
2. **Given** dark mode picked, **Then** the whole frame shows inverted, and the choice holds after a restart.
3. **Given** the menu open over a site tab, **When** Escape is pressed or a click lands outside the menu,
   **Then** it closes.

---

### User Story 6 - A site can't fake the frame (Priority: P1)

A site draws only inside its own view, which sits under the toolbar; the frame is never inside a site's view,
and a site has no way to reach the frame's controls or messages.

**Independent Test**: the sandbox self-test, plus a site page that sends the frame's messages.

**Acceptance Scenarios**:

1. **Given** any site, **Then** its view starts below the toolbar and never covers the top bar or the toolbar
   (menus of the frame draw over the site, never the reverse).
2. **Given** a site's page, **When** it tries to send the frame's messages, **Then** they are refused.
3. **Given** spec 001's sandbox self-test and its control run, **Then** both still give their expected result.

### User Story 7 - The taskbar row is the title bar (Priority: P1) *(Tibo, after trying the first build)*

There is no OS window frame and no File/Edit/View menu bar. The top bar is the window's title bar: our own 1-bit
minimize, maximize/restore and close buttons at its right end; its empty parts move the window, and a
double-click on an empty part maximizes it. Tabs, "+", "HyperBrowser ▾" and the buttons stay clickable. "+"
sits right after the last tab, as in Firefox and Chrome. Every pixel icon is drawn on whole pixels: the tab's ×
and the "+" are perfect pixel crosses.

**Independent Test**: drag the window by the empty bar, snap it to a screen edge, double-click to maximize, use
the three buttons; copy and paste in the address and in a site.

**Acceptance Scenarios**:

1. **Given** the window, **Then** it has no OS frame and no menu bar.
2. **Given** the empty part of the top bar, **When** dragged, **Then** the window moves (and snaps to screen
   edges on Windows); **When** double-clicked, **Then** it maximizes (again: restores).
3. **Given** the window buttons, **Then** they minimize, maximize or restore, and close.
4. **Given** no app menu, **Then** Ctrl+W, reload (F5, Ctrl+R), copy, cut, paste, undo in sites and in the
   address, and devtools (F12, Ctrl+Shift+I, in development only) still work.

### Edge Cases

- A site whose `site.json` has no icon, or an icon that isn't an image: a generic icon.
- A site that stops being served while open: the state shows no peers; the page already shown stays.
- The engine stops: the shell says so and exits (spec 001's behaviour).
- Many tabs: tab names shorten with an ellipsis, then narrow tabs show their icon only; the bar never scrolls
  (past ~35 tabs on a 1280 px window the last ones are cut off: Ctrl+Tab still reaches them).
- A preset site whose key isn't known yet: its icon shows, opening it says "not published yet".
- The desktop file is missing or unreadable: the preset desktop.
- Linux: a window without an OS frame must still move and resize (not tested by hand yet).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: One launch command opens the window on the desktop tab; it is in `README.md` and stays the same.
- **FR-002**: The top bar holds "HyperBrowser ▾" then the taskbar; a "+" right after the last tab goes to the
  desktop with the address focused; the window's buttons at the right end.
- **FR-003**: Tabs share the bar's width equally (up to a maximum), no dragging or resizing; background tabs
  keep running; the desktop tab is first and can't be closed.
- **FR-004**: The toolbar: back, forward, reload, the address, the bookmark button, the state. On the desktop
  tab: back, forward, reload and bookmark are disabled; the state shows the engine (online, sites open).
- **FR-005**: The address shows `title · short key` and the full key while edited; a full key (52 characters)
  or an `hg:` link opens the site; anything else is refused with a message in the frame.
- **FR-006**: The state: complete or loading, peers (a count), and what this device holds of the site when the
  engine can say it.
- **FR-007**: The desktop: icons from each site's `site.json` icon, title under it; installed = solid frame and
  shadow, bookmark = dotted frame; arranged by dragging on a grid; kept across restarts; preset official site and
  forum.
- **FR-008**: Install keeps the site whole on disk and seeds it; a bookmark is cached and evicted as usual
  (SwarmFS app storage). Until SwarmFS can keep a visited site whole (request F4), install is recorded and shown,
  and installed sites are opened in the engine at launch (so seeded) while HyperBrowser runs.
- **FR-009**: The HyperBrowser menu: identity, installed sites, open by key, theme (system/light/dark), accent,
  about. Escape or a click outside closes it.
- **FR-010**: The frame is drawn by HyperBrowser only: site views are placed under the toolbar; the frame's
  messages are accepted from the frame only.
- **FR-011**: Spec 001's sandbox self-test and its control run keep their results.
- **FR-012**: The look: 1-bit black and white plus one accent, Cozette for the frame, pixel icons on whole
  pixels (a crisp cross beats a centred blur), box-drawing separators, dark = inverted.
- **FR-013**: No OS window frame, no app menu: the top bar's empty parts drag the window (double-click
  maximizes, OS snapping kept), its controls don't; our own minimize, maximize/restore and close buttons. The
  keys a menu would give (close tab, reload, copy/paste, devtools in development) keep working.

### Key Entities

- **Tab**: a site key (or the desktop), its title, its view; one current tab.
- **Desktop icon**: site key (or none yet, for a preset), title, icon image, kind (installed or bookmark),
  grid cell.
- **Settings**: theme, accent.

## Success Criteria *(mandatory)*

- **SC-001**: From the launch command to the window on screen: under 5 s on Tibo's machine.
- **SC-002**: A key pasted on a local test network shows its site in a tab within 15 s (spec 001's SC-001).
- **SC-003**: Switching tabs shows the other site at once (under 100 ms), without reloading it.
- **SC-004**: No site, whatever it draws, can place anything over the top bar or the toolbar.
- **SC-005**: The sandbox self-test passes and its control run fails, as in spec 001.
- **SC-006**: Desktop arrangement, bookmarks, installs and theme survive a restart.

## Assumptions

- A key entered in the address opens a new tab (a browser's "same tab" can come later); an already-open site
  selects its tab.
- The preset official site and forum keys are not published yet: they live in `shell/preset.json` with no key,
  filled in once Tibo publishes them.
- "What you hold" needs a SwarmFS count of bytes held per site (request F5); until then the state shows
  complete/loading and peers only.
- Accent choices: the mockup's three (blue, orange, green); blue by default.
- Mentions, folders, the tray, hyperDNS names, `hyper://` links from the OS, phone layout: later.
- The desktop is part of the frame (HyperBrowser's own page), not a site.
