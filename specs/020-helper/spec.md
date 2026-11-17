# Feature Specification: 020 — helper (v1, command line)

**Feature Branch**: `020-helper`

**Created**: 2026-11-17

**Status**: Draft (grilled with Tibo, 2026-11-17)

**Input**: An always-on helper on Tibo's VPS (Ubuntu 24.04 x86_64, 50 GB and 150 GB free) that keeps the official
apps online 24/7 and joins a circle as a holder, so two people who are never online together still get each other's
messages. Builds on 018/019 (circles), hypergraph 023/024 (holding, 5 copies), `apps:seed` (6cd8c63). ROADMAP
"Helper" (2026-11-11): our headless engine, its own key, joins a circle like a person.

## Clarifications

### Session 2026-11-17 (Tibo)

- Q1 v1 is a command-line helper managed over SSH. Later, and optional: a helper built into HyperBrowser for people
  with an always-on computer (pairing code, managed from the window).
- Q2 The helper has **its own identity**, shown as a member named "Helper (<hostname>)": one of the 50, one of each
  space's 5 copies, holding always on. Never a device of the person's identity.
- Q3 Apps: an ordinary reader that keeps every file of each app, no owner key on the VPS. When Tibo runs
  `npm run apps:seed` on his PC, the helper gets the new versions like any HyperBrowser does, **live, no restart**.
- Q4 Joining: `--join hg:…` at first start, or `join = hg:…` in the config file (Q12). The helper does **not** answer
  invites in v1. Leaving or removal: from the Members list, as for a person.
- Q5/Q11 No hard-coded settings: a config file with sensible defaults (below).
- Q6/Q13 Installed with `git clone` + `npm ci` + a systemd service; an install script. No open ports.
- Q7 Code in HyperBrowser (`engine/cli.js helper`) unless it needs code that doesn't belong there: then the worker
  stops and tells the lead (a separate repo).
- Q9 No change to `apps:publish`/`apps:seed`: the helper receives updates as any instance does.
- Q14 One helper per VPS, each its own identity; both may be in the same circle (2 of 5 copies).

## Requirements

**Running**

- **FR-001** `node engine/cli.js helper [--config <file>] [--dir <folder>] [--join hg:…]` starts the engine headless on
  Node, stays online until stopped (SIGINT and SIGTERM close it cleanly), and logs to stdout (the journal).
- **FR-002** The config file: `~/.config/hyperbrowser-helper.conf` by default (`--config` for another). Plain
  `key = value` lines, `#` comments, repeated keys for lists (`join`, `seed`). Precedence: command line, then file,
  then defaults. A missing file is written with every setting commented out and its default shown. An unknown key or a
  bad value is logged and ignored (the helper keeps running). The file is read again when it changes: `name`, `share`,
  `join`, `seed`, `apps` apply without a restart; `dir` needs one (logged).
- **FR-003** Settings and defaults:
  - `dir = ~/.local/share/hyperbrowser-helper` — its engine folder (identity, data).
  - `name = Helper (<hostname>)` — its name as members see it.
  - `share` — GB for its circles; default half the free disk at first start, at most 100 GB. Checked as the app does
    (018 FR-006): at most free space + held − 2 GB; above that it uses the most allowed and logs it.
  - `apps = official | none` — `official`: every app in the repo's `shell/preset.json` (a `git pull` follows the list).
  - `seed = <key>` (repeatable) — other sites or spaces to keep.
  - `join = hg:…` (repeatable) — circle invites.

**Circles**

- **FR-004** Each `join` link is redeemed once (018's `circles.join`); the helper remembers the links it used (joined or
  refused) and never retries them; the result is logged ("joined "Family"", "refused: already used or expired").
  Holding is always on, with `share` as its budget.
- **FR-005** The helper is a member like a person: listed with its name, holds its circles' spaces (hypergraph
  023/024), counted in `holders`. It answers no invites.

**Apps**

- **FR-006** Each kept app is held whole (every file, not only what a page read) and followed live: a new version
  published or seeded by its owner reaches the helper while both are online, with no restart, and is then served to
  others. If the engine doesn't do this today for a non-owner, the worker makes it (and says how).

**Install**

- **FR-007** `scripts/helper-install.sh` (Ubuntu 24.04, run with sudo): creates a `hyperbrowser` system user with no
  login, checks Node ≥ 22 (says how to get it if missing), puts the code in `/opt/hyperbrowser` (`git clone`, or
  updates it), `npm ci --omit=dev` (or what the engine needs), installs and enables
  `scripts/hyperbrowser-helper.service` (restart on failure, starts at boot). The config is the `hyperbrowser`
  user's. Updating: `git pull`, `npm ci`, `systemctl restart hyperbrowser-helper` (documented).
- **FR-008** Logs: one line per change (joined, refused, an app's new version, share full, share capped) and an hourly
  summary (circles, members, GB held of share, apps kept and their versions).

## Not covered (decided)

The HyperBrowser-embedded helper and pairing code; answering invites; a `status` command; Docker; Windows or ARM
service files (ARM may just work; untested); private SwarmFS files (not encrypted at rest yet: ROADMAP).

## Success criteria

- Three engines (A, B, helper H) in one circle, A and B friends: B writes to A while A is offline, B goes offline, A
  comes online and reads it with only H online (a test).
- H keeps an app; its owner publishes a new version while H runs; H has it within 30 s, no restart (a test).
- Tibo's manual run: the install script on a fresh Ubuntu 24.04 VPS, the helper joins his circle from the config file,
  and the official apps open on another computer while his PC is off.
