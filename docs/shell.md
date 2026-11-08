# Using HyperBrowser (the shell, spec 002)

```bash
npm start
```

The window has no OS frame and no menu bar: two bars drawn by HyperBrowser itself (a site only ever draws
below them):

- **The top bar** is the window's title bar: "HyperBrowser ▾" (your identity, installed sites, open a site by
  key, the look: system, light or dark, and the accent, and what closing the window does), then **the tabs** as a taskbar, `+` right after the
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
  to others whenever HyperBrowser runs, with or without a tab open. Remembered across restarts. An install
  that couldn't be done (the site unreachable) is tried again at the next launch.
- **Bookmark** (dotted frame): cached and evicted as usual. The toolbar's bookmark button adds or removes one.
  Making an installed site a bookmark, or removing its icon, hands its files back to the cache.
- **Who serves what**: your installed sites and your own published sites, always. Any other site (a
  bookmark, or one you only visited) only while a tab shows it, and for 5 minutes after you close its last
  tab; then HyperBrowser stops serving it (and at the next launch, it isn't served at all). Its files stay
  in the cache: opening it again reuses them, but needs someone serving it online to find it.
- Double-click (or Enter) opens; right-click: open, install or bookmark, remove; drag to another cell.
- The official site and forum are preset; until their keys are published they say "not published".

The desktop, bookmarks and the look are kept in `shell.json` in the app's data folder
(`%APPDATA%\HyperBrowser` on Windows).

## The tray (spec 010)

Closing the window doesn't quit: HyperBrowser stays in the tray (Windows: the notification area, by the
clock) and keeps serving your installed sites, your own sites and the forums you joined. The first time, a
notice says so. The tray icon (right-click) has:

- **Open HyperBrowser** (a click on the icon does it too): the window comes back as you left it, tabs open.
- **hosting 3 sites**: how many sites this computer serves right now.
- **Quit**: stops everything.

Tabs left open while the window is hidden keep running, and their sites keep being served; close a tab to let
its site go after the usual 5 minutes.

To turn the tray off: "HyperBrowser ▾" → **When the window closes** → **Quit**. Closing the window then quits
HyperBrowser, as before. **Stay in the tray** turns it back on.

Launching HyperBrowser while it already runs shows the running one's window: one HyperBrowser per data
folder (one started with `--dir <another folder>` is another HyperBrowser, for testing with two peers).

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

## The look

"HyperBrowser ▾" → Look: **System** follows Windows' light or dark setting, **Light** and **Dark** force one.
It applies to the window and to every site (a site's `prefers-color-scheme`), at once, without a reload.

A site page with no stylesheet of its own gets HyperBrowser's default theme (`shell/ui/theme.css`): the
official site's fonts, colours and dithered background. Sites with their own CSS keep their look.

## Icons: where they are, how to redraw one

- **The window's icons** (tabs, toolbar, menu, window buttons, desktop): one PNG each in `shell/icons/`,
  named after what it is (`back.png`, `reload.png`, `close.png`…). 8×8 pixels; the window buttons
  (`plus`, `close`, `min`, `max`, `restore`) are 5×5. Each pixel shows as 2×2 on screen.
- **A site's icon** (its desktop icon and tab): the file its `site.json` names in `icon`, in the site's
  folder: `sites/home/icon.svg`, `sites/forum/icon.svg`, `sites/demo/icon.svg`. Any image works (PNG, SVG…);
  a 16×16 1-bit picture fits the look.

To redraw a window icon: open its PNG in any paint program (Paint, Paint.NET, GIMP, Aseprite, Krita…), zoom
in, draw in **black**; everything else **white** (or transparent). Keep the size (8×8 or 5×5) and save as
PNG under the same name. Restart `npm start` to see it. Black takes the colour of the text around it (white
in dark mode, the accent on the bookmark button), so don't use colours or grays: a pixel is black or not.
A new icon: add `<name>.png`, then use `name` where the window's code names icons (`shell/ui/`).

## Linux

Not tried yet. The window has no OS frame: it moves by the top bar; resizing at the edges depends on the
window manager (some Wayland desktops give none).

The tray depends on the desktop: KDE, Cinnamon, XFCE and most others show it; GNOME shows it only with the
AppIndicator extension. HyperBrowser asks the desktop at start (`gdbus`); with no tray, closing the window
quits, rather than leaving a HyperBrowser running that you can't see or stop.

## Not yet

Mentions, folders on the desktop, starting with the system, `hyper://` links from the system, phone layout.
