# Using HyperBrowser (the shell, spec 002)

```bash
npm start
```

The window has no OS frame and no menu bar: two bars drawn by HyperBrowser itself (a site only ever draws
below them):

- **The top bar** is the window's title bar: "HyperBrowser ▾" (your identity, installed sites, open a site by
  key, your devices, the look: system, light or dark, and the accent, and what closing the window does), then **the tabs** as a taskbar, `+` right after the
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
- Preset: the official site, the forum, Apps, Chat and Contacts; until their keys are published they say "not
  published". (A desktop saved before an entry was added doesn't get it: preset icons only fill a new desktop.)

## Apps (spec 014)

Apps (`sites/apps`) is an ordinary site: a list of apps, each with Install (or Open once installed). Its entries
are `app` records only its owner and admins write (`npm run apps:publish` writes them from each app's
`site.json`: see [engine.md](engine.md)). Installing goes through HyperBrowser (`hyper.apps`, [site-api.md](site-api.md)):
a click on the page, then HyperBrowser's own question, "Install "<the app's title>"?", with its key. Yes is the
same install as the desktop's right-click. Any site may ask the same way; none can install without both.

The desktop, bookmarks and the look are kept in `shell.json` in the app's data folder
(`%APPDATA%\HyperBrowser` on Windows).

## Notifications (spec 016)

Apps you allow can tell you about new messages and mentions, even while they are closed, as long as HyperBrowser
runs (the tray counts). Quit fully and nothing arrives; at the next launch, one popup sums up what came meanwhile.

- **The counter** (between the address bar and the peers): how many are unread. Click it: one row per conversation,
  newest first (the latest 200 kept). A row opens that conversation and counts it as read.
- **Desktop icons** show their app's count. **Popups** come when the window isn't focused or you are on another
  tab: one per conversation (the newest replaces the last). **The tray icon** gets a red mark while something is
  unread. What you are looking at, window focused, never pops up and isn't counted.
- **Friend requests** notify too, under Contacts.
- Each app asks once ("Let "Chat" notify you?"). Reading on one of your computers clears the others, and your
  answers follow you.

## Configuration (spec 016)

"HyperBrowser ▾" → **Configuration…**:

- **Notifications**: per app **Allowed** / **Blocked** and **Hide text** (popups and the list say "New message");
  per conversation **Mute**.
- **When the window closes**: **Stay in the tray** or **Quit** (moved here from the menu).
- **Devices**: **Your devices…** opens the Devices window.

## Devices: one identity on two computers (spec 012)

"HyperBrowser ▾" → **Configuration…** → **Your devices…**: this computer and your other devices, one identity.

- **Add a device** (on the computer already set up): a code (about 100 letters), valid once, for 10 minutes.
  **Copy** it and send it to yourself (mail, a chat), or type it.
- **Join with a code** (on the other computer): paste it, **Join**. This computer becomes a device of that
  identity, without a restart: the key in the menu changes, open tabs close, then within a minute the forums
  you joined, your roles there, your answers to "use your identity?", sites' own data and your installed
  sites arrive (installed sites appear on the desktop and are kept on this computer too).
- **What doesn't follow**: bookmarks, the look and the tray choice stay per computer.
- **This computer's own identity is replaced**: its engine folder is renamed `engine-before-join-<date>` in the
  data folder (`%APPDATA%\HyperBrowser` on Windows, `~/.config/HyperBrowser` on Linux); nothing is deleted.
  The window warns first, and lists the sites that identity owns: nobody updates them from here any more.
  **To switch back**: quit HyperBrowser (tray → Quit), rename `engine` to anything, rename the
  `engine-before-join-…` folder to `engine`, start HyperBrowser.
- A failed join (bad or expired code, the other computer offline): the old folder is put back, nothing changes.
- **Remove** (next to another device): for a lost or given-away computer. What it does from then on counts for
  nobody; that computer's Devices window says it was removed.
- **Recovery phrase**: 24 words that are your identity; adding or removing a device needs them. Show them,
  write them down; **Protect** keeps them on this computer behind a password (asked from then on, in the
  Password field).
- Install or uninstall on one computer: the other follows within about 10 s while it runs.
- Wait a minute after joining before quitting: a quit in the first seconds can hang (a hypergraph issue,
  `specs/requests-to-hypergraph.md` B4).

## The tray (spec 010)

Closing the window doesn't quit: HyperBrowser stays in the tray (Windows: the notification area, by the
clock) and keeps serving your installed sites, your own sites and the forums you joined. The first time, a
notice says so. The tray icon (right-click) has:

- **Open HyperBrowser** (a click on the icon does it too): the window comes back as you left it, tabs open.
- **hosting 3 sites**: how many sites this computer serves right now.
- **Quit**: stops everything.

Tabs left open while the window is hidden keep running, and their sites keep being served; close a tab to let
its site go after the usual 5 minutes.

To turn the tray off: "HyperBrowser ▾" → **Configuration…** → **When the window closes** → **Quit**. Closing the window then quits
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

## Updates (spec 011)

An installed HyperBrowser (the Windows folder, `HyperBrowser.AppImage`: `npm run build`) follows its
release channel, `package.json` `"upgrade"`:

- `shell/updater.js`, a Bare worker with pear-runtime's updater, downloads a higher version while
  HyperBrowser runs. It replaces the installed file at once on Linux, and when HyperBrowser quits on Windows.
  The next launch runs it.
- Until then, **HyperBrowser ▾** shows "Update ready (x.y.z): restart", in the accent. About shows the
  running version.
- What it did goes to `hyperbrowser.log` in the data folder.
- From source (`npm start`) there are never updates.

Building, releasing, installing: [packaging.md](packaging.md).
