# 030 Identities

Named identities on one computer, so what a person does under one can't be linked to another (SimpleX's lesson).
Decided with the maintainer (hypergraph `docs/decisions.md`, 2026-11-21; research hypergraph `specs/029`, RQ2, RQ3).
This step: the ID manager. Later: secure chats, the vault (hidden identities, nested, memory-only site sessions),
Tor mode (one onion address and circuit per identity, an "only over Tor" switch).

## Decisions

- **One identity open at a time.** Switching closes the window (every site view, the tray, the popups), stops the
  engine, starts it on the other identity's folder and opens a new window. Side by side can come later.
- **Nothing shared.** Each identity has its own engine folder (identity key, device key = swarm key pair, personal
  space, contacts, circles, held data, its own copies of the official apps), its own desktop (`shell.json`) and its
  own site sessions (`persist:<id>-site-<key>`).
- **The id is random** (8 bytes, hex), never derived from a key.
- **The list** is `identities.json` in the app's data folder: `{ current, list: [{ id, name, dir }] }`, outside any
  identity's folder. No list yet (an install from before): the existing `engine` folder becomes **Main**
  (renamable) with nothing moved; its desktop stays `shell.json` and its sessions `persist:site-<key>`.
- **Delete** a closed identity only: show its recovery phrase first, warn that nothing brings it back without it,
  then remove its folder, its desktop file, and its site sessions (cleared, then their folders removed). What
  couldn't be removed (a file still open) goes at the next start, before any view opens.
- **No vault yet**: the recovery phrase stays a file in each folder. The docs say plainly that identities aren't
  hidden from someone who has the computer.
- **Without Tor identities share the IP**: allowed, with one warning line in the manager.
- `hyperbrowser.log` names no identity.
- The helper (`engine/helper.js`) is unaffected.

## UI

- The "HyperBrowser ▾" menu's first row is the open identity's name; under it, one item per other identity
  ("Switch to <name>"), **New identity…** and **Manage identities…**. With two or more identities the top bar
  says "HyperBrowser · <name> ▾".
- **Identities** window: each identity with **Open** (the others), **Rename**, **Show recovery phrase**, **Delete…**
  (the others); a name field and **Create**; the warning: "Identities share your IP address unless you use Tor
  (coming soon); people you meet under two identities may link them."
- Keyboard: every control is a button or a field in the window's order; Escape closes it.

## Tests

- two identities: different identity keys, device keys and swarm key pairs; A's space and contact never under B;
- upgrading a single-account folder yields Main with the same identity key;
- a site's localStorage and IndexedDB set under A aren't seen under B (and are still there under A);
- after a switch no engine process of A is left, the window and tray are new;
- deleting B removes its folder, desktop file and site data, and leaves A intact.
