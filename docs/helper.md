# The helper

An always-on HyperBrowser engine for a server (a VPS): it joins your circles like a person and holds their spaces,
so two people who are never online together still get each other's messages, and it keeps the official apps online
24/7. It has **its own identity** (never one of your devices) and no owner key: it gets new app versions like any
HyperBrowser does, live. Command line only, managed over SSH; no open ports (Hyperswarm finds its peers).

## Install (Ubuntu 24.04, x86_64)

Node 22 or later first (Ubuntu's own is older):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
```

Then, from a copy of this repo's `scripts/helper-install.sh`:

```bash
sudo bash helper-install.sh
```

Or paste this line directly:
```bash
curl -L https://raw.githubusercontent.com/tibocub/HyperBrowser/refs/heads/main/scripts/helper-install.sh | sudo bash
```

It makes a `hyperbrowser` system user (no login, home `/var/lib/hyperbrowser`), clones HyperBrowser and the
engine's own dependencies beside it into `/opt/hyperbrowser` (`swarmwire`, `hypergraph`, `SwarmFS`, `hyperDNS`: `file:`
dependencies, as on a developer's machine; `HB_GITHUB=<url>` clones from elsewhere), runs `npm ci --omit=dev` in
each (no Electron), and installs, enables and starts `scripts/hyperbrowser-helper.service` (systemd: starts at boot,
restarted on failure, stopped with SIGTERM, which closes the engine cleanly).

**Updating**: run the script again (it `git pull`s each repo, `npm ci`s and restarts the service). By hand:

```bash
cd /opt/hyperbrowser/HyperBrowser && sudo -u hyperbrowser git pull && sudo -u hyperbrowser npm ci --omit=dev
sudo systemctl restart hyperbrowser-helper
```

## Run it by hand

```bash
node engine/cli.js helper [--config <file>] [--dir <folder>] [--join hg:...]
```

It stays online until Ctrl+C (SIGINT) or SIGTERM and logs to stdout (the journal under systemd:
`journalctl -u hyperbrowser-helper -f`).

## The config file

`~/.config/hyperbrowser-helper.conf` (`--config` for another; under the service:
`/var/lib/hyperbrowser/.config/hyperbrowser-helper.conf`). Missing, it is written with every setting commented out
and its default shown. `key = value` lines, `#` comments; `join` and `seed` may be repeated. The command line wins
over the file, the file over the defaults (a `--join` adds to the file's). An unknown setting or a bad value is
logged and ignored. The file is **read again when it changes** (edit it as the `hyperbrowser` user:
`sudo -u hyperbrowser nano /var/lib/hyperbrowser/.config/hyperbrowser-helper.conf`): everything applies at once,
except `dir`, at the next start.

| Setting | Default | |
|---|---|---|
| `dir` | `~/.local/share/hyperbrowser-helper` | its engine folder: identity and data |
| `name` | `Helper (<hostname>)` | its name, as Contacts sets a person's (shown in its conversations; a circle's Members list still shows its short key, as for anyone not your contact) |
| `share` | half the free disk at first start, at most 100 | GB for its circles; at most the free space + what it holds − 2 GB: above that, the most allowed, logged (a change under 0.1 GB is ignored: free space drifts) |
| `apps` | `official` | `official`: every app in `shell/preset.json` (a `git pull` follows the list); `none` |
| `seed` | | another site's key to keep online (repeatable) |
| `join` | | a circle invite, `hg:…` (repeatable) |

**Joining a circle**: in HyperBrowser, your circle's **…** → Invite: paste the link as a `join = hg:…` line. Each link
is used once: joined, or refused (already used, expired…), and remembered in `<dir>/helper.json`, never tried again.
A link nobody answered (no member online) is tried again every minute. The helper doesn't answer invites. To remove
it, remove it from the circle's Members, as a person.

Holding is always on, with `share` as its budget. The helper takes one of each space's 5 copies, like any member;
two helpers in a circle of two people may keep every copy on servers.

## Apps

Each app is kept whole (every file, not only what a page read) and followed live: when the owner runs
`npm run apps:seed`, the new version reaches the helper while both are online (seconds; a test checks under 30 s),
with no restart, and the helper serves it. An app not reachable yet (nobody serving it) is tried again every minute.
The **official forum** is an invite-only instance (docs/forum.md): a stranger can't open it by its key, the helper
included, so it logs it as not reached.

## Logs

One line per change: `joined "Family"`, `refused: <why>`, `keeping Chat (<key>)`, `Chat: new version (24 KB)`
(seen as a new size: a same-size edit isn't logged), `share: 40 GB` or `share: … (capped: …)`, `name: …`; config
lines ignored. Every hour, and at start, a summary: circles, members, GB held of the share, the apps kept and their
sizes.

An error nobody caught (a bug) is one line, `escaped error <code> in <method>: <message>` (code and method when
it has them), and the helper keeps running: no restart, nothing re-joined.

## Not yet

A helper built into HyperBrowser (pairing code), answering invites, a status command, Docker, Windows or ARM
service files (ARM may just work: untested).

`npm run perf:helper [-- --people 3 --minutes 1]` (`perf/helper.mjs`): the helper alone in a fresh process, joined
to a circle of 4 and keeping the official apps: idle CPU and memory (about 0.3 % of a core and 113 MB resident when last measured).
