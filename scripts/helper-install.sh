#!/usr/bin/env bash
# Installs, or updates, the HyperBrowser helper on Ubuntu 24.04 x86_64 (docs/helper.md):
#   sudo bash helper-install.sh
# A `hyperbrowser` system user with no login, the code in /opt/hyperbrowser (HyperBrowser and the engine's
# file: dependencies beside it, as on a developer's machine), `npm ci --omit=dev` in each (`npm install` without
# a lockfile), and the systemd service enabled and (re)started. Once package.json has the release channel ("upgrade"),
# also Pear and a second service seeding that channel. Run it again to update. HB_GITHUB: where the repos are cloned from.
set -euo pipefail

ROOT=/opt/hyperbrowser
HOME_DIR=/var/lib/hyperbrowser # the user's: its config (~/.config) and engine folder (~/.local/share)
GITHUB=${HB_GITHUB:-https://github.com/tibocub}
REPOS="swarmwire hypergraph SwarmFS hyperDNS HyperBrowser" # each one's file: dependencies first
NAME=hyperbrowser

if [ "$(id -u)" != 0 ]; then echo "Run it with sudo." >&2; exit 1; fi
if [ "$(uname -m)" != x86_64 ]; then echo "Note: made for x86_64; $(uname -m) is untested."; fi
if ! command -v git >/dev/null; then apt-get update && apt-get install -y git; fi
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "Node 22 or later is needed ($(node --version 2>/dev/null || echo 'none') here). On Ubuntu 24.04:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  exit 1
fi

if ! id "$NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$HOME_DIR" --shell /usr/sbin/nologin "$NAME"
fi
# npm ci is killed for lack of memory on a 1 GB machine with no swap
if [ "$(awk '/MemTotal|SwapTotal/ {s += $2} END {print s}' /proc/meminfo)" -lt 1800000 ]; then
  echo "Less than 1.8 GB of RAM and swap: npm would run out of memory. Add swap first (docs/helper.md, Install)." >&2
  exit 1
fi
mkdir -p "$ROOT"
chown -R "$NAME:$NAME" "$ROOT" # a git pull by hand (as another user, or sudo) leaves files the service user can't write
as () { sudo -u "$NAME" -H "$@"; }

for r in $REPOS; do
  if [ -d "$ROOT/$r/.git" ]; then as git -C "$ROOT/$r" pull --ff-only
  else as git clone "$GITHUB/$r.git" "$ROOT/$r"; fi
done
for r in $REPOS; do
  how=ci; [ -f "$ROOT/$r/package-lock.json" ] || how=install # swarmwire commits no lockfile
  (cd "$ROOT/$r" && as npm "$how" --omit=dev --no-audit --no-fund)
done

ADDON="$ROOT/HyperBrowser/router/prebuilds/linux-x64/i2pd.node"
[ -f "$ADDON" ] || echo "No I2P router addon at $ADDON (not in git, docs/helper.md): the helper runs without I2P."

install -m 644 "$ROOT/HyperBrowser/scripts/hyperbrowser-helper.service" /etc/systemd/system/hyperbrowser-helper.service
systemctl daemon-reload
systemctl enable hyperbrowser-helper
systemctl restart hyperbrowser-helper

LINK=$(cd "$ROOT/HyperBrowser" && node -p "require('./package.json').upgrade || ''")
if [[ "$LINK" =~ ^pear://[a-z0-9]+$ ]]; then
  command -v pear >/dev/null || npm i -g pear --no-audit --no-fund
  as pear help >/dev/null || true # its first run downloads Pear itself into the user's home; seed's log shows a failure
  echo "HB_RELEASE_LINK=$LINK" > /etc/default/hyperbrowser-seed
  install -m 644 "$ROOT/HyperBrowser/scripts/hyperbrowser-seed.service" /etc/systemd/system/hyperbrowser-seed.service
  systemctl daemon-reload
  systemctl enable hyperbrowser-seed
  systemctl restart hyperbrowser-seed
  echo "The release seeder runs ($LINK). Its log: journalctl -u hyperbrowser-seed -f"
elif [ -n "$LINK" ]; then
  echo "package.json's \"upgrade\" is not a pear:// link ($LINK): the release seeder is not installed." >&2
else
  echo "No release channel yet (no \"upgrade\" in package.json): the release seeder is not installed."
fi

echo
echo "The helper runs. Its log: journalctl -u hyperbrowser-helper -f"
echo "Its config: $HOME_DIR/.config/hyperbrowser-helper.conf (written at its first start; read again on change)"
echo "Join a circle: add a line  join = hg:...  there (sudo -u $NAME nano <that file>)"
