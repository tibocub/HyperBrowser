# Feature Specification: 012 — device pairing

**Feature Branch**: `claude/012-device-pairing-af65d1`

**Created**: 2026-11-08

**Status**: Built (for Tibo to try)

**Input**: lead session, 2026-11-08: Tibo's PC and laptop should be one identity in HyperBrowser (same
identity key, same installed sites and settings, same roles in forums). hypergraph already pairs devices
(`hg.addDevice`, `Hypergraph.open(dir, { joinCode })`, `hg.devices()`, `hg.removeDevice`, the recovery phrase);
SwarmFS passes `joinCode` and `deviceName` through.

## User Scenarios & Testing

### User Story 1 - The laptop joins the PC (Priority: P1)

On the PC, Tibo opens HyperBrowser ▾ → Devices → **Add a device**: a code shows (text, with Copy). On the
laptop, Devices → **Join with a code**, pastes it. The laptop goes on as the PC's identity (no restart): same key in
the menu, the same forums with the same roles, the same answers to "use your identity?", the same site data,
and the sites installed on the PC appear on its desktop.

**Independent Test**: `test/devices.test.js` "pair two engines" (Node and Bare).

1. **Given** engine A, **When** `devices.add`, **Then** a code; **When** engine B starts with `init { joinCode }`
   in an empty folder, **Then** B's identity is A's, and both list two devices (`devices.list`), each knowing
   which one it is.
2. **Given** paired A and B, **When** A answers "use your identity?" for a site (a setting), **Then** B sees
   the same answer.
3. **Given** paired A and B, **When** A installs a site, **Then** B lists it installed (`site.installed`), and
   the shell puts it on B's desktop as installed.
4. **Given** a wrong or expired code, **Then** the join fails with `INVITE_INVALID` and the laptop is as before
   (its folder back in place, its identity unchanged).

### User Story 2 - The laptop already had an identity (Priority: P1)

**Given** the laptop has its own identity, **When** it joins, **Then** first a warning: "This computer's
identity is replaced. Its folder is kept as `engine-before-join-<date>`." and, if that identity owns sites,
"It owns N sites (names): nobody will update them from here until you switch back." Switching back = quit,
rename the folders (documented in `docs/shell.md`).

### User Story 3 - Remove a lost device (Priority: P1)

**Given** paired A and B, **When** A removes B (Devices → Remove), **Then** B is gone from A's list, and B's
writes fail with `DEVICE_REMOVED`; B's Devices panel says "This computer was removed from your identity".

### User Story 4 - The recovery phrase (Priority: P2)

Devices → **Show recovery phrase**: the 24 words. **Protect with a password**: after that, showing it, adding
and removing a device ask for the password. A wrong one: `NOT_ALLOWED`, said in the panel.

## Requirements

- **FR-001** Engine `init` takes `joinCode`, `deviceName`, `joinTimeout` (passed to SwarmFS / hypergraph).
- **FR-002** Engine calls: `devices.list`, `devices.add`, `devices.remove`, `devices.phrase`, `devices.protect`,
  event `devices`; `site.installed`. Errors keep hypergraph's codes. Sites can't call them (they are not
  `site.call` methods).
- **FR-003** Shell: "Devices…" in HyperBrowser ▾ opens a Devices window: this computer's name, the list
  (Remove on the others), Add a device (the code, Copy), Join with a code (with the warning), the recovery
  phrase (Show, Protect with a password).
- **FR-004** Join: the shell stops the engine, renames `engine/` to `engine-before-join-<date>`, starts the
  engine on a new `engine/` with the code; success → the frame goes on with it (tabs closed, the new identity,
  installed icons kept again); failure → the new folder is deleted, the old one renamed back and started again;
  either way the Devices window says what happened.
- **FR-005** The desktop follows installs: every 10 s the shell asks `site.installed`; a site installed on
  another device gets an installed icon here; an icon installed here that no device keeps any more becomes a
  bookmark.
- **FR-006** This device's name is the computer's name (`os.hostname()`).

## Decisions

- **Join is a fresh start, not a merge** (Tibo, 2026-11-08): the old identity's folder is moved aside with a
  warning listing the sites it owns; nothing is deleted; there's no ownership transfer.
- **Only installed sites follow the desktop** (Tibo, 2026-11-08): theme, accent, tray and bookmarks stay per
  computer.
- **The fresh install has no separate first-run choice**: a new install starts with a new, empty identity
  (as before); "Join with a code" replaces it the same way (no sites owned, so no warning beyond the
  folder). One path, one test.
- **No restart after a join** (found while testing, 2026-11-08): closing an engine seconds after its join can
  hang in hypergraph (`specs/requests-to-hypergraph.md` B4), and a process killed in that hang left a folder
  that didn't open again. The shell keeps the joined engine running instead.
- **No QR code**: it needs a library and the laptop has no camera to scan with; the code is text with Copy
  (send it to yourself, or type it).

## Not done

- Ownership transfer of a site, merging two identities.
- Bookmarks, theme and tray following the person.
- `forgetRecoveryPhrase` in the UI (the engine keeps the phrase plain until protected, as hypergraph does).
- A first-run screen.

## Success Criteria

- **SC-001** Pairing two engines on a local DHT completes within 30 s, and the paired one sees the first one's
  settings and installs within 15 s (the test).
- **SC-002** A failed join leaves the computer exactly as before (same identity at the next launch).
