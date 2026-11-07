# Research: 002 — the shell's interface

## R1. How the frame is drawn above sites

- **Decision**: one `WebContentsView` for the frame (a local page, `file://shell/ui/index.html`, sandboxed,
  context-isolated, its own preload), added after the site views so it is on top (Electron re-raises a view
  when added again). Its bounds: the bars only while a site shows; the whole window on the desktop tab, while a
  tab has no page yet (loading, error), and while a menu is open (transparent background then, so the menu
  draws over the site).
- **Rationale**: a site's view can never cover the bars (it is placed under them) and the frame is never part
  of a site's page. One frame page keeps all the look in one place.
- **Alternatives**: a `BrowserWindow` page with sites in child views (same thing, less control over order);
  native Electron menus (can't take the System 1 look); drawing the bars in each site's view (a site could fake
  them: refused by the design).

## R2. Frame ↔ main messages

- **Decision**: `ipcMain.handle('frame', …)` accepts only the frame view's `webContents`; main pushes the whole
  frame state (`frame-state`) after every change. Contract: [contracts/frame.md](contracts/frame.md).
- **Rationale**: one small state object is easy to render without a framework; tens of tabs at most.

## R3. A site's state

- **Decision**: engine method `site.state { key }` → `{ complete, peers }`: hypergraph's `isComplete()` of the
  site's space and its pages' space, and `peers().length` of the site's space. The frame polls it every 2 s for
  open site tabs.
- **"What you hold"**: SwarmFS has no per-site count of bytes held: request F5. Not shown until then.
- **Alternatives**: `site.on('peers')` events (push): later, polling is enough for a status line.

## R4. Install vs bookmark

- **Decision**: the desktop records the kind. SwarmFS has no "keep this visited site whole, never evict" call:
  request F4. Meanwhile installed sites are opened in the engine at launch, so their space is joined and served
  while HyperBrowser runs.

## R5. Storage of the desktop and settings

- **Decision**: one JSON file, `<userData>/shell.json`, written whole after each change (small). Icons keep
  their image as a data URL so the desktop draws offline.
- **Alternatives**: the person's hypergraph settings (synced across devices): later, once the desktop layout
  is settled; noted.

## R6. Fonts and look

- Cozette Vector 1.30.0 (MIT), regular and bold woff2 from the mockup's asset store, in `shell/ui/fonts/`.
- Pixel icons: 8×8 SVG paths from the mockup (`shape-rendering: crispEdges`).
- Dark mode: `filter: invert(1)` on the frame, the accent pre-inverted so it shows its light variant (the
  mockup's rule). Site views are not inverted: a site has its own look.
