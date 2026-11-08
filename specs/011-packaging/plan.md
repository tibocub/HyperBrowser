# Plan: 011 — packaging and P2P updates

Facts behind each choice: `research.md`.

## Decisions

- **D1 Pear stays.** The updater is pear-runtime's own (`pear-runtime-updater`), the channel a pear link,
  releases `pear stage`d and `pear seed`ed. No blocker was found, so there is no fallback to plain Electron.
- **D2 Windows: an app folder (a zip to extract), not MSIX, not one `.exe`.**
  - MSIX needs a certificate the PC trusts. A self-signed one means an admin import on every PC, and it must
    never change, or updates are refused. Windows 10 won't install unsigned MSIX at all.
  - pear-runtime's updater can also swap one `.exe` by renaming it. So the first build was electron-builder's
    `portable` target: one `.exe` that unpacks itself to `%TEMP%` at each launch. `npm run test:update`
    found three problems with it:
    - its launcher keeps its own file open while HyperBrowser runs, so pear-runtime's rename fails (EBUSY);
    - the launcher's exit kills its children, including a rename step started at the quit;
    - worst, every launch unpacks ~430 MB of new files, and new files start slowly here: 34–43 s each launch,
      against 7 s for files already run once (most likely Windows Defender scanning them; not confirmed).
  - So Windows ships the **folder** electron-builder makes (`win-unpacked`, zipped for download), extracted
    once where the person likes. pear-runtime's updater mirrors a folder release as well as a file (its
    "directory bundle"). Its `applyUpdate()` only handles `.exe` and `.msix` on Windows, so main.js does the
    swap ("custom install logic" via `updater.next`, which pear-runtime's README offers):
    - the updater downloads into `<folder>.update\`, on the same drive;
    - when HyperBrowser quits, a PowerShell step waits for it, renames the installed folder away (retrying
      while its Bare workers still hold files), moves the new one in, and puts the old one back if that
      fails, otherwise deletes it;
    - that step is started through WMI (`Win32_Process.Create`), not as a child of HyperBrowser;
    - "Restart" also starts the new `HyperBrowser.exe`;
    - if HyperBrowser never quits cleanly (power cut), the next launch gets the update again from its own
      store, which takes a second.
  - The folder also makes updates smaller. pear-runtime mirrors file by file, so files that didn't change
    (Electron's, ~300 MB) are not downloaded again. Expected from how mirroring works, not measured.
  - Holepunch's template turns Windows updates off unless MSIX; we turn them on for the folder. When Tibo has
    a certificate, MSIX can come back.
- **D3 Apply on download, start at the next launch, plus a quiet menu item.**
  - When a download completes, the updater swaps the installed file at once (Linux, macOS), or the folder at
    the quit (Windows, D2). The running version goes on; the next launch is the new one.
  - Because the tray (010) keeps HyperBrowser running for days, the HyperBrowser ▾ menu also shows "Update
    ready (v): restart", in the accent, and nothing else: no dialog, no badge.
  - Not "restart by itself": that would close Tibo's pages and stop hosting without asking.
  - Timing (pear-runtime's): an update is checked at every launch. A release staged while it runs is fetched
    at once in the first minute after start, otherwise after a random wait of up to an hour (spreads load).
- **D4 Keys and seeding.**
  - The channel's key pair is in Tibo's Pear folder, on his PC: Pear's corestore (`%APPDATA%\pear` here),
    never in the repo. Losing it = a new channel, and every installed copy is moved by hand. So it gets
    backed up with that folder.
  - Seeding: `pear seed <link>` on Tibo's PC, the machine that staged, which holds every OS's build.
  - The tray HyperBrowser **should not** seed releases for now. Each installed copy downloads only its own
    OS's build, so Tibo's Windows copy can't serve the Linux one. Making it seed would also mean the app
    joining as a server on the release drive. That's worth it once there are many users (every copy helps),
    as a later setting.
  - Multisig (`pear provision` + `pear multisig`) needs 3 machines; later, when the project has more people.
- **D5 Data folder.** Electron's `userData` from `productName` (`%APPDATA%\HyperBrowser`,
  `~/.config/HyperBrowser`), unchanged by where the program file lives, so updates never touch it. The
  updater's corestore goes in its own subfolder, `pear-runtime/`. Only its downloads sit beside the
  installed folder on Windows (`HyperBrowser.update\`).
- **D6 Dev workflow.** `npm start` is not packaged, so it never starts the updater, and `--dir`, the checks
  and the tests are as before. The build copies the app out of the repo (`out/`, git-ignored), so nothing
  in the source tree changes.

## Files

- `scripts/build.js`, `scripts/release.js`, `scripts/update-check.js`; `package.json` scripts.
- `shell/updater.js` (new Bare worker); `shell/main.js` (start it, the log, restart); `shell/frame.js` +
  `shell/ui/*` (the menu item, the version in About); `shell/app.png` (the program icon, hb.png at 256 px).
- `docs/packaging.md`, `docs/shell.md`, `sites/home/start.hmd`, `README.md`.
