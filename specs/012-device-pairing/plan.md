# Plan: 012 — device pairing

- **Engine** (`engine/index.js`): `init` passes `joinCode`, `deviceName`, `joinTimeout` to `SwarmFS.open`.
  `devices.*` call hypergraph (`sfs.hg`) directly; `devices` events from `hg.on('devices')`.
  `devices.list` also gives `removed` (this device not in a non-empty list), `phrase`
  (`plain | protected | forgotten`, from `recoveryPhrase()`), `owns` (top-level spaces this identity owns:
  `{ key, name }`, for the join warning). `site.installed`: top-level spaces whose site is kept
  (`site.kept()`), `{ key, title }` (the space's name is the site's title).
- **Nothing to change in SwarmFS or hypergraph**: `SwarmFS.open` already passes `joinCode`/`deviceName`;
  installs are SwarmFS `kept` records in the personal space, so they replicate already.
- **Shell**: `main.js` owns the engine folder, so it does the join: `rpc.request('close')`, rename, a new
  worker with `init { joinCode }`, kept running (no restart: hypergraph B4); the frame and the tray reach the
  engine through a small wrapper, so they follow the new one; `ui.joined()` closes the tabs and re-installs. The frame gets a Devices
  window (`shell/ui/`: `section.window` as the tab panel) and ops `devices.*` passed to the engine; engine
  `devices` events push to the frame.
- **Tests**: `test/devices.test.js`, two engines on the test DHT (Node and Bare, via the existing runner).
  The sandbox test doesn't drive menus beyond the tray setting: not extended.
