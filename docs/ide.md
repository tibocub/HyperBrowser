# The IDE

HyperBrowser's IDE makes sites and apps. It is a site like Chat (`sites/ide`), built on the `projects` site calls
([site-api.md](site-api.md#projects)). It asks once for your projects, the files it edits.

## For everyone: a site with pages

1. Open **IDE** on the desktop. Under **New project**, type a name, keep **A site with pages**, and click **Make it**.
2. The left side lists your **pages** by their titles. Click one to write it. **New page** asks for a title.
3. The toolbar formats text: **Heading**, **Bold**, **Italic**, **Link**, **Image**, **List**, **Quote**.
   - **Image** picks a picture from your computer.
   - **Link** takes an address, or the title of another of your pages.
4. **Your work saves as you type.** Click **Preview** to see the site beside the page; it follows your typing.
   Drag the line between the page and the preview to give either more room (or press F6, then the arrows).
5. Under **The site**, set its title, an icon (**Choose a picture**) and whether it is **invite-only**.
6. Click **Publish**. Visitors get this version; the IDE shows the site's address.
   Saving never publishes: you publish when you choose.

The project is also a folder in `Documents/HyperBrowser/<name>`, so you can edit it with any program.
It syncs with your other computers while they are online.

### Working together

- **…** → **People**: **Make an invite link** (one use), or **Invite a contact…** (sent in your chat with them).
- They paste the link in their IDE: **…** → **Join with an invite**.
- Co-authors edit everything and may publish.
- **Only invite people whose code you would run**: their files reach your folder like yours.
- If you both change one file at the same moment, both versions are kept. The other one is named `name (<who>'s copy)`.
- The line under the title says who is online: your other devices, and co-authors.

### Versions

- **…** → **Versions** lists what this computer published. **…** next to an older version → **Publish this version
  again**: it becomes the newest.
- Versions are kept on the computer that published them.

### Leaving

- **…** → **Leave this project**: it leaves your list on every device; its folder stays on this computer.
- **Delete this project**: its files are deleted from this computer too. A `.git` folder stays.

## For developers

- **…** → **Show the files**: the project's files, as a tree.
  - Click a folder to open or close it; click a file to edit it.
  - **Right-click** a row (or the Menu key, or Shift+F10) for its actions: Open, Rename (in place: Enter renames,
    Escape cancels), Delete, Cut, Copy, Paste, New file, New folder.
  - Right-click the empty space below for New file, New folder and Paste. Keyboard: arrows, Home, End, Enter, F2.
  - **New file**, **New folder** and **Upload** are above the tree.
  - Files changed since your last git commit are marked •.
  - The line under the title shows the git branch and how many files changed. The IDE reads git; it never runs it.
- **Hide file explorer** (top right) gives the editor the whole width; **Show file explorer** brings it back. Remembered.
- **…** → **Editor settings**: wrap long lines, line numbers, tab size (2, 4, 8), text size (12 to 20 px). Saved for
  you, on all your devices.
- Code opens in an editor with search (Ctrl+F), undo and redo. It knows JS, HTML, CSS, JSON and Markdown/HyperMD.
  **Ctrl+S** saves. The preview reloads on each save.
- **New project** offers templates:
  - **A blank site (HTML)**;
  - **An app with its own space (JavaScript)**: notes in its space, through `window.hyper` ([site-api.md](site-api.md)).
- An app's preview runs on a **throwaway space**, never the real site's data. **…** → **Reset the preview's data**
  starts it empty.
- **…** → **Site setup** edits `site.json`:
  - title, first page, icon, invite-only, permissions, and record types with their fields;
  - **Edit as JSON** for the raw file.
  - It is checked exactly as HyperBrowser checks it before it is written.
  - Types and fields can only be added once published.
  - Roles are not in `site.json`: an app makes them while it runs (`hyper.defineRole`).
- Pages written in HyperMD (`.hmd`) are built into `.html` on each save, by HyperMD running in the IDE:
  - The built pages are kept **outside your folder**, on this computer, in HyperBrowser's own folder. So they never
    sync, never reach git, and co-authors never get conflict copies of them; your folder holds only what you wrote.
  - The preview and Publish use your files plus the built pages.
  - **What you wrote wins.** If you write `about.html` yourself and also have `about.hmd`, your `about.html` is used.
    The IDE says so when you preview or publish.
  - Older versions of the IDE wrote built pages beside the `.hmd` files. Those are removed at the next build, but
    only if they are exactly what the build makes.
  - `_layout.hmd` wraps every page;
  - its `::menu` lists the pages (`::page{order=N}`);
  - root `.css` files style every page.
- `.git` and `node_modules` never sync, and the IDE can't open them. Each computer keeps its own git; GitHub stays
  the place for pull requests.
- **…** → **Open a copy of a site…**: a site's published files (by its key) become your project. No posts or
  messages are copied. Publishing it makes a new site under your key.
- **Open a folder…**: any folder, e.g. a cloned repo.
- `.wasm` files are files: the preview runs them.

### Not in this version

A word-processor editor, a debugger or console, reading a site's data, diffs between versions, running git, a WASM
compiler.

## How it is made

- `sites/ide/app.js` is the page. It fits the window (`<body class="hb-app">`): the tree and the editor scroll,
  never the page.
  Its "…" menus stay inside the window: under their button, flipped right, left or up where they would not fit
  (`fitMenu`). Full-width fields are `border-box`, and the page's text area is a block, so nothing pushes a
  right border out of its box. The self-test checks these at 1400 and 770px.
  Its editor panel is a `div role="main"`, not a `<main>`: the theme gives `<main>` a HyperMD page's window
  (1140px at most, margins), which would leave blank space beside the editor. The self-test checks the editor
  fills the space left over, with the list shown and hidden, at three widths.
- `sites/ide/lib/tree.js` is the file tree, a component with nothing of the IDE's. HyperBrowser's file manager will
  reuse it: a site loads only its own files, so that app takes a copy.
  - `fileTree(element, { label, open(path), rename(from, to), menu(path, kind) → [[label, fn] | null], mark(path) })`
    returns `{ set(items), select(path), rename(path), selected, expanded }`.
  - `items` are `[{ path, folder? }]`; a file's folders are implied, and empty folders are listed as folders.
  - `rename` may throw: the old name is kept. A `menu` item's `fn` runs once the menu has closed; `null` draws a
    separator.
  - `nest(items)` is the pure part (tested).
  - The menu floats at the click and moves nothing. It also opens with the Menu key and Shift+F10; Escape closes it
    and the focus goes back to the row.
  - Roles: `tree`, `treeitem`, `aria-expanded`, `aria-selected`.
  - The rows aren't buttons, so a click never shifts them. They are `div`s, not `li`s: the theme's list style (a
    bullet, `text-indent: -2ch`) would cut names' first two letters. A long name is cut at its end; its
    tooltip has the whole path.
- Previews and Publish build every HyperMD page first (so `sites/home` previews with `entry: index.html`), into the engine's `builds/<project>/` through `hyper.projects.build`.
- `sites/ide/lib/site.js` does the work: templates, HyperMD built in the page, pages by title, `site.json` changes,
  Publish. `test/ide.test.js` runs it on Node and Bare.
- `sites/ide/vendor/editor.js` (CodeMirror 6: JS, HTML, CSS, JSON, Markdown, search, undo) is loaded the first time
  code is opened. It sits in a shadow root, so its styles don't turn off HyperBrowser's default theme.
- `vendor/hmd.js` holds HyperMD and the engine's `site.json` check.
- Both bundles are made by `node scripts/ide-vendor.mjs` (pinned versions; HyperBrowser gains no dependency).
- **The preview beside the page is HyperBrowser's.** A site can't show another site, so the shell docks the draft's
  view next to the IDE in its tab (`hyper.projects.preview`). It needs the shell for that reason only.

Costs, as measured by `npm run perf:ide` on one machine:

| What | Cost |
|---|---|
| IDE start | ~340 ms |
| CodeMirror's first load | ~520 ms more |
| Memory | 101 MB, then 106 MB with the editor |
| A preview's reload | ~12 ms |
| `editor.js` | 539 KB (187 KB gzipped) |
| `hmd.js` | 148 KB (46 KB gzipped) |

Known limits:
- An invite-only site's co-authors can't publish it: they can't reach it by its key (it needs an invite of its own).
  Invite co-authors to public sites, or publish invite-only ones yourself.
- Two co-authors publishing a site's very first version at the same moment make two sites.
