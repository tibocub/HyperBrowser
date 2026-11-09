# Packaging and releases (spec 011)

HyperBrowser installs without an installer or admin rights, and updates itself over P2P through Pear, the
way Keet does:

- **Windows**: a `HyperBrowser` folder, downloaded as `HyperBrowser.zip`. Run `HyperBrowser.exe` inside it.
- **Linux**: `HyperBrowser.AppImage`, one file.

Tibo releases a new version on his **release channel**, a pear link. Installed copies download it while they
run. On Linux it replaces the AppImage at once; on Windows it replaces the folder as soon as HyperBrowser
quits. The next launch is the new version. Until then, **HyperBrowser ▾** shows "Update ready (x.y.z):
restart". The data folder (identity, installed sites, forums, settings) is elsewhere and never moves.

Why it works this way (folder vs MSIX vs one `.exe`, who seeds, where the keys are): `specs/011-packaging/plan.md`.

## What you need

- The repo, set up as for development (`npm install`; README).
- **Pear's command line**, v3. Check with `pear versions`.
  - To install or upgrade it: `npm i -g pear`, then run `pear` once.
  - It prints a PATH line to add, and `pear run pear://runtime` fixes it.
  - Its folder (`%APPDATA%\pear` on Windows) holds the release channel's **key pair**: see "Keys" below.

## Once: make the release channel

On the PC you release from (Tibo's Windows PC):

```bash
pear touch
```

It prints a link like `pear://qxenz5wm…`. Put it in `package.json`, as a line after `"version"`:

```json
  "upgrade": "pear://qxenz5wm…",
```

Commit that line: it is public, like a site key. Every build made from now on follows this channel.

## Each release

1. **Version**: raise `"version"` in `package.json` (`0.0.1` → `0.0.2`). Only a higher version reaches installed copies; there is no going back down, so a rollback is a new, higher version. Commit.
2. **Publish the apps, then build on Windows** (in the repo, on the PC). Stop anything running on the owner
   folder first (`cli.js publish`): the build opens it to pack the apps.

   ```bash
   npm run apps:publish -- --dir E:/Code/P2P/hyperbrowser-owner
   ```

   ```bash
   npm run build -- --apps-from E:/Code/P2P/hyperbrowser-owner
   ```

   `--apps-from` packs the preset apps (spec 015) into the build: their own signed data, the same sites with the
   same keys, so a new install opens them with nobody online, and peers update them as before. It packs what
   is published in that folder (run `apps:publish` first: edits not published yet are not packed). The forum
   icon's official instance is invite-only, so only the forum **app** is packed; the instance's posts still come
   from a peer. Without `--apps-from` the build warns and ships no apps.

   This takes about 3–5 minutes and gives two things:
   - `out/dist/win-unpacked/`: the HyperBrowser folder, which is what gets released;
   - `out/dist/HyperBrowser.zip`: the same folder zipped (~180 MB, one `HyperBrowser` folder inside), for people to download.

   The first build downloads the packages and build tools (~300 MB) into `out/cache`. It uses the Electron already in `node_modules`.
3. **Build on Linux** (on the laptop, the same commit, set up the same way; copy the owner folder there first,
   with nothing running on it on either machine, or skip `--apps-from`: that build then ships no apps):

   ```bash
   npm run build -- --apps-from <the owner folder's copy>
   ```

   This gives `out/dist/HyperBrowser.AppImage`. Copy it to the PC, next to the repo for example (USB stick, `scp`, a shared folder).
4. **Make the release folder** (on the PC):

   ```bash
   npm run release -- out/dist/win-unpacked ../HyperBrowser.AppImage
   ```

   It makes `out/release/hyperbrowser-<version>/` and prints the next command. A release can also carry one OS only: the other OS keeps its previous version.
5. **Stage** it on the channel. Try it first with `--dry-run`, which shows what would change:

   ```bash
   pear stage --dry-run <your link> out/release/hyperbrowser-<version>
   ```

   ```bash
   pear stage <your link> out/release/hyperbrowser-<version>
   ```

6. **Seed**: keep this running so installed copies can download the release:

   ```bash
   pear seed <your link>
   ```

   Copies that are open get it within the hour (at once if they started less than a minute ago). The others get it at their next launch. Leave `pear seed` running as long as you can, at least until your own copies say "Update ready".

Releasing is done from the PC that ran `pear touch`, because only that PC can write the channel.

## Install it (the first time)

Both PCs, and anyone else. The first copy comes from a plain download; after that, updates come over P2P.
Put `HyperBrowser.zip` and `HyperBrowser.AppImage` on the GitHub release page (a new release, "Attach
binaries", with the version as the tag). The official site's start page links to `https://github.com/tibocub/HyperBrowser/releases/latest`.

- **Windows**:
  1. Right-click `HyperBrowser.zip`, choose **Extract All…**, and pick where it will stay: `Documents` for example, or any folder you can write to. That gives `Documents\HyperBrowser\` (about 430 MB).
  2. Double-click `HyperBrowser.exe` in it.
  3. For a shortcut: right-click `HyperBrowser.exe`, then **Send to → Desktop (create shortcut)**.

  Things to expect:
  - **SmartScreen**: the first time, Windows says "Windows protected your PC" (unknown publisher: the files aren't code-signed). Click **More info**, then **Run anyway**.
  - **Windows Firewall** may ask whether `bare.exe` (HyperBrowser's P2P engine) may communicate on networks. Choose **Allow access**. Refused or ignored, Windows blocks incoming connections, and HyperBrowser is harder for others to reach.
  - The first launch of each new version is slow: 20–40 s here, then about 7 s. That's most likely Windows Defender scanning the new files once (not confirmed).
  - An update downloads into `HyperBrowser.update\` beside the folder. When HyperBrowser quits (or "restart"), the folders are swapped and the old version is deleted.
  - Leave the folder's name and place as they are while HyperBrowser runs.
- **Linux**: put `HyperBrowser.AppImage` where it will stay (`~/Applications/` for example).

  ```bash
  chmod +x ~/Applications/HyperBrowser.AppImage
  ```

  ```bash
  ~/Applications/HyperBrowser.AppImage
  ```

  - AppImages need FUSE 2. On Ubuntu 22.04 and newer: `sudo apt install libfuse2` (24.04: `libfuse2t64`). Without it, run with `--appimage-extract-and-run`.
  - Nothing is signed on Linux and nothing asks. Your file manager may need "Allow executing file as program" once.
  - Updates replace that file in place, so the folder must be writable by you.
- **macOS** (not tested; no Mac here): `npm run build` on a Mac gives `out/dist/HyperBrowser-mac.zip` (the `.app`). Unsigned, other Macs refuse it unless right-click → Open, and updates don't get past Gatekeeper. That needs an Apple Developer certificate.

From source, `npm start` uses **the same data folder** as an installed copy: `%APPDATA%\HyperBrowser` on Windows, `~/.config/HyperBrowser` on Linux. So switching between them keeps your identity, sites and settings, but only one runs at a time.

## Keys: where, and what to back up

- The channel's **key pair** (write access) is in Pear's folder on the PC that ran `pear touch`: `%APPDATA%\pear` on Windows. It is not in the repo or in HyperBrowser.
- **Back up `%APPDATA%\pear`** (with Pear stopped). Without it, nobody can release on that channel again. You would make a new one, and installed copies would need the new build downloaded by hand once.
- The link in `package.json` is public: anyone can download releases, only that PC can make them.
- Later, with more people on the project: Pear's multisig (`pear provision`, `pear multisig`) makes releases need 2 of 3 signers, and the channel no longer depends on one PC.

## Who seeds

- Your PC, with `pear seed <link>` running. It holds every OS's build.
- Installed HyperBrowsers only download releases. They don't serve them to others, even from the tray: each one has only its own OS's build. A later setting could make them help.
- More seeders = releases reach people faster and while your PC is off. Any always-on machine with Pear can run `pear seed <link>`; it needs no key.

## If an update doesn't come

- Each installed copy writes what it does to `hyperbrowser.log` in its data folder:
  - `HyperBrowser 0.0.2, channel pear://…`: its version and channel.
  - `update: updating`, then `update: ready 0.0.3`: a release came. On Windows, a line follows at the quit: `takes the place of … (started)`.
  - `update: error …`: something failed.
- `no updates` in that line means a build without a channel, or a run from source.
- Is the version higher than the installed one? Is `pear seed` running? Did `pear stage` print the new version?
- A copy that started while nobody seeded looks again about every 15 minutes, or at its next launch.

## Check the update path

```bash
npm run test:update
```

This builds two versions (1.0.0, 1.0.1) on a throwaway channel and a local DHT, "installs" 1.0.0, releases 1.0.1 while it runs, and checks:

- 1.0.0 picks it up;
- the next launch is 1.0.1;
- the identity and settings are the same.

The installed copy is pointed at the throwaway channel by two environment variables, which are for tests only:
- `HYPERBROWSER_UPDATE_BOOTSTRAP=host:port`: a local DHT;
- `HYPERBROWSER_UPDATE_DELAY=0`: no random wait after a release (normally up to an hour).

It takes about 10 minutes and about 2 GB in `out/update-check` (`--tmp <dir>` to put it elsewhere). `--reuse` skips the builds on a second run. It passes on Windows. On Linux it should work but hasn't been run.

## Development

Nothing changes: `npm start`, `--dir`, the checks and the tests never update and never need a channel. `npm run build` copies the app into `out/` (git-ignored). It never builds inside `shell/` or `engine/`.
