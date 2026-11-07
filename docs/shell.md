# Using HyperBrowser (the shell, spec 002)

```bash
npm start
```

The window has no OS frame and no menu bar: two bars drawn by HyperBrowser itself (a site only ever draws
below them):

- **The top bar** is the window's title bar: "HyperBrowser ▾" (your identity, installed sites, open a site by
  key, the look: system, light or dark, and the accent), then **the tabs** as a taskbar, `+` right after the
  last tab (goes to the desktop with the address ready), empty space, and the window's buttons (minimize,
  maximize/restore, close). Drag the empty space to move the window (Windows snaps it to screen edges);
  double-click it to maximize. Tabs share the width; other tabs keep running in the background. The desktop is
  always the first tab.
- **The toolbar**: back, forward, reload, the address, the bookmark button, and the site's state on the right
  (`■ complete` or `□ loading`, peers, what this device holds of the site, and `kept` when it is installed;
  the bytes refresh about every 10 s).

## Opening a site

Paste a site's whole key (52 letters and digits) in the address and press Enter. The address shows
`Title · abcdef…xyz`; click it to see the whole key. A key already open selects its tab. If nobody serving the
site is online, the tab says so: "Try again" or "Close tab".

## The desktop

Each site's icon (from its `site.json`), its title under it.

- **Installed** (solid frame, shadow): every page and upload kept on this device, never evicted, and served
  to others. Remembered across restarts. An install that couldn't be done (the site unreachable) is tried
  again at the next launch.
- **Bookmark** (dotted frame): cached and evicted as usual. The toolbar's bookmark button adds or removes one.
  Making an installed site a bookmark, or removing its icon, hands its files back to the cache.
- Double-click (or Enter) opens; right-click: open, install or bookmark, remove; drag to another cell.
- The official site and forum are preset; until their keys are published they say "not published".

The desktop, bookmarks and the look are kept in `shell.json` in the app's data folder
(`%APPDATA%\HyperBrowser` on Windows).

## Keys

| | |
|---|---|
| Ctrl+L | the address |
| Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Z | as usual, in sites and in the address |
| F12, Ctrl+Shift+I | devtools (from `npm start` only, not in a packaged build) |
| Ctrl+T | the desktop, address ready |
| Ctrl+W | close the tab |
| Ctrl+Tab, Ctrl+Shift+Tab | next, previous tab |
| F5, Ctrl+R | reload |
| Alt+Left, Alt+Right | back, forward |
| Escape | close a menu |

## Linux

Not tried yet. The window has no OS frame: it moves by the top bar; resizing at the edges depends on the
window manager (some Wayland desktops give none).

## Not yet

Mentions, folders on the desktop, the tray, `hyper://` links from the system, phone layout.
