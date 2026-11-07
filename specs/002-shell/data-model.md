# Data model: 002 — the shell's interface

## Tab (in memory, main process)

| field | |
|---|---|
| `id` | number; `0` is the desktop |
| `key` | site key (z32, 52 chars) |
| `title` | `site.json` title, or the short key until it is known |
| `icon` | data URL of the site's icon, or null |
| `status` | `opening` · `ready` · `error` |
| `error` | message when `status` is `error` |
| `canBack`, `canForward`, `loading` | from the view |
| `state` | `{ complete, peers }` from `site.state`, or null |

One current tab. The desktop tab is always first, never closed.

## Desktop icon (`shell.json` → `desktop.icons[]`)

| field | |
|---|---|
| `id` | the site key, or `preset:<name>` for a preset with no key yet |
| `key` | site key or null |
| `title` | text under the icon |
| `icon` | data URL or null (then `glyph`) |
| `glyph` | name of a built-in pixel icon (`hb`, `forum`, `site`) |
| `kind` | `installed` · `bookmark` |
| `col`, `row` | grid cell, integers ≥ 0; one icon per cell |

Rules (`shell/model.js`): a new icon takes the first free cell, row by row, in 8 columns; a move to an occupied
cell swaps the two; a preset whose key gets known keeps its cell (its `id` becomes the key).

## Settings (`shell.json` → `settings`)

`theme`: `system` · `light` · `dark` (default `system`). `accent`: `#1f4fd1` · `#c2410c` · `#0b7a52`
(default `#1f4fd1`).
