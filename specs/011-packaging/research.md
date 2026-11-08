# Research: 011 — packaging and P2P updates

Read 2026-11-08. Sources:
- `node_modules/pear-runtime` 1.3.1 (README, `index.js`).
- `node_modules/pear-runtime-updater` 3.4.0 (README, `index.js`).
- `holepunchto/hello-pear-electron` at `ad51b38` (2026-10-29): README, `forge.config.js`, `electron/main.js`, `workers/main.js`, `agent_docs/*`.
- docs.pears.com: deployment, build-desktop-distributables, deployment-releasing-apps-p2p, CLI reference, troubleshooting.

## How a pear-runtime app updates

- **The channel is a Hyperdrive**, named by a pear link (`pear touch` makes one). The app carries it in
  `package.json` `"upgrade"`. The drive holds a **deployment folder**:
  `/package.json` (its `version` is the release's) and `/by-arch/<platform>-<arch>/app/<file>`.
  Here `<file>` is named after `productName`: `HyperBrowser.exe`, `.AppImage`, `.app` or `.msix`.
- **Updater** (`pear-runtime-updater`, inside `new PearRuntime(opts)`):
  - It joins the drive's discovery key as a client only, with its own corestore in `<dir>/pear-runtime/`.
  - It checks at boot, and on every append to the drive.
  - An append within 60 s of boot is fetched at once. Later appends wait a random delay of up to 1 h (`delay`), to spread the load on seeders.
  - It acts only on a strictly higher semver. There is no downgrade: a rollback is a new, higher version.
  - It mirrors only this host's `/by-arch/<host>/app/<name>` into `<dir>/pear-runtime/next/<length>.<fork>`, then emits `updated`.
- **`applyUpdate()`** swaps the file in place. The running app keeps running; the next launch runs the new file.
  - macOS `.app` and Linux `.AppImage`: `fs-native-extensions` `swap` (atomic exchange).
  - Windows `.msix`: `msix-manager` `addPackage`.
  - Windows `.exe`: a rename dance on **one file**. It copies the new file next to the old one, then renames old → `HyperBrowser-<old version>.exe` and new → `HyperBrowser.exe`. The old copy is left there.
  - It is one-shot: a failed apply is not retried in that process.
- **Restart** belongs to the app. The template calls `app.relaunch()`. On Linux it relaunches `$APPIMAGE` with `--appimage-extract-and-run`. On Windows (MSIX) it only quits.
- **Seeding**: installed apps never seed (client-only join). Someone runs `pear seed <link>` on a reachable machine. An app that starts while no seeder is up looks again about every 15 min.
- **Release flow (Pear v3 CLI)**:
  - `pear touch` → link; `pear seed <link>`; set `package.json` `upgrade`.
  - Bump `version`, make the distributables, `pear build --package package.json --win32-x64-app … --linux-x64-app … --target <outside the app>`.
  - `pear stage <link> <folder>`.
  - Production adds `pear provision` + `pear multisig`: quorum signing, so the drive is not tied to one machine. The docs say stage-only is fine for a proof of concept.
  - `pear release` is gone in v3.
- **Write access**: a staged (or provisioned) drive's key pair lives in the Pear platform's corestore, on the machine that ran `pear touch`. It is never in the repo or the app.
  - Lose that folder and the link is dead. Recovery: touch a new link, and every installed copy is moved by hand (installed copies follow the link they were built with).
  - Multisig removes that single point of failure. It needs ≥3 machines online to commit.

## What this means for HyperBrowser

- **pear-runtime already in use.** `shell/main.js` uses only `PearRuntime.run` (the Bare engine). The updater is the other half of the same library, so Pear stays: no fallback needed.
- **Windows, no certificate**:
  - MSIX (the template's path) installs only when signed by a certificate the machine trusts.
    - A self-signed one means importing it into "Trusted People" as admin on every PC.
    - It must stay the same certificate forever, or updates are refused.
    - Windows 10 can't install unsigned MSIX at all.
  - The updater's other Windows format is a **single `.exe`**. An Electron app is a folder, but electron-builder's **portable** target packs it into one self-extracting `.exe`. Tried first:
    - No install and no admin.
    - `PORTABLE_EXECUTABLE_FILE` names the file to swap.
    - Each launch unpacks to `%TEMP%` first: a few seconds, about 300 MB on disk while it runs.
  - **Found when tested**:
    - the portable launcher holds its `.exe` open while the app runs, so pear-runtime's rename gets `EBUSY`;
    - every launch unpacks ~430 MB of new files and takes 34–43 s, against 7 s for a folder already run once.
  - The updater also mirrors a **folder** release (a "directory bundle"); only its `applyUpdate()` is file-only on Windows. **Chosen: the folder** (`win-unpacked`, zipped for download), swapped by HyperBrowser itself once it quits (plan D2).
- **Linux**: AppImage. Holepunch's AppImage maker (`pear-electron-forge-maker-appimage`) wraps electron-builder's `app-builder-lib`. So **electron-builder** makes both files: one tool, no Forge.
- **macOS**: electron-builder `--mac zip` (an `.app`) builds only on a Mac. Unsigned, Gatekeeper blocks it on other Macs. Configured, **not tested** (no Mac here).
- **asar off**: pear-runtime starts Bare workers from real file paths (template `agent_docs/packaging.md`).
- **Linked siblings**: `hypergraph`, `swarmfs` (and SwarmFS's own `../hypergraph`, `../swarmwire`) are `file:` links and junctions.
  - The build copies each into `out/vendor/<folder>`, without `.git`, `.claude`, tests, docs or specs. hypergraph's `.claude/` alone is 44 MB.
  - `npm install --install-links` then installs real copies, never links.
- **Data folder**: Electron's `userData` is `%APPDATA%\HyperBrowser` on Windows and `~/.config/HyperBrowser` on Linux. It comes from `productName`, not from where the program file lives.
  - From source, `npm start` uses the same folder. An installed copy and a source checkout share identity, sites and settings, but not at the same time (one HyperBrowser a data folder, spec 010).
  - The updater's own corestore goes in `<userData>/pear-runtime/`, beside the engine's `engine/`.
- **Seeding by the tray app**: possible (join the release drive as a server), but each copy holds only its own OS's file. `pear seed` on Tibo's machine holds every file and is the one with write access. See plan.md, decision D4.

## Not checked here

- The Pear v3 CLI itself (`pear build`, `pear stage`, `pear seed`). This machine has an older Pear (v0.9609, no `pear build`), and upgrading it is Tibo's call. The update check writes the channel drive directly, with the same layout. `docs/packaging.md` gives the v3 commands as documented.
- Whether `pear build` accepts a folder for Windows (its docs show only `.msix`). Not needed: `scripts/release.js` makes the same layout.
