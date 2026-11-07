# Using HyperBrowser (the shell, spec 002)

```bash
npm start
```

The window has two bars, drawn by HyperBrowser itself (a site only ever draws below them):

- **The top bar**: "HyperBrowser ▾" (your identity, installed sites, open a site by key, the look: system,
  light or dark, and the accent), then **the tabs** as a taskbar. Tabs share the width; other tabs keep running
  in the background. The desktop is always the first tab. `+` goes to the desktop with the address ready.
- **The toolbar**: back, forward, reload, the address, the bookmark button, and the site's state on the right
  (`■ complete` or `□ loading`, peers).

## Opening a site

Paste a site's whole key (52 letters and digits) in the address and press Enter. The address shows
`Title · abcdef…xyz`; click it to see the whole key. A key already open selects its tab. If nobody serving the
site is online, the tab says so: "Try again" or "Close tab".

## The desktop

Each site's icon (from its `site.json`), its title under it.

- **Installed** (solid frame, shadow): kept and seeded. For now: opened in the engine at launch, so served
  while HyperBrowser runs; kept whole on disk comes with SwarmFS (request F4).
- **Bookmark** (dotted frame): cached and evicted as usual. The toolbar's bookmark button adds or removes one.
- Double-click (or Enter) opens; right-click: open, install or bookmark, remove; drag to another cell.
- The official site and forum are preset; until their keys are published they say "not published".

The desktop, bookmarks and the look are kept in `shell.json` in the app's data folder
(`%APPDATA%\HyperBrowser` on Windows).

## Keys

| | |
|---|---|
| Ctrl+L | the address |
| Ctrl+T | the desktop, address ready |
| Ctrl+W | close the tab |
| Ctrl+Tab, Ctrl+Shift+Tab | next, previous tab |
| F5, Ctrl+R | reload |
| Alt+Left, Alt+Right | back, forward |
| Escape | close a menu |

## Not yet

"What you hold" in the state (SwarmFS request F5), install keeping a site whole (F4), Mentions, folders on the
desktop, the tray, `hyper://` links from the system, phone layout.
