# The I2P router

HyperBrowser runs one I2P router per install, so anonymous identities can hide their IP and every install relays
for the I2P network. It is i2pd, built by us as a library, not the i2pd program: the official binaries were flagged
by Windows Defender, our library build is not.

| File | What it is |
|---|---|
| `router/addon/` | i2pd 3.0.0 as one statically linked Node-API addon: `start(opts)`, `stop()`, `status()` |
| `router/process.js` | the router process: a Bare worker that loads the addon, one per app |
| `shell/router.js` | the supervisor in the shell: starts it with the app, picks the SAM port, restarts it with backoff |
| `router/soak.mjs` | identity switches and the multi-day soak run against the live network |
| `router/addon/check.cjs` | the addon in Node: start/stop cycles in one process |
| `.github/workflows/router.yml` | the addon for Windows, Linux and macOS; the Defender scan |

## How it runs

- The shell starts the router process with the app; it outlives identity switches. Each engine opens its own SAM
  session on it (127.0.0.1, a port picked at start and kept across restarts). Same computer, same IP: sharing the
  router costs no privacy, and relaying and tunnels survive switches.
- The process prints one JSON status line every 10 s: `running`, `sam` (SAM listening), router `status` (OK,
  Firewalled, …), `upnp`, known `routers`, `transit` tunnels, `transitBytes`, its own `rssMB` and `cpuS`.
- A crash or exit is restarted after 1 s, doubling up to 60 s; a run longer than a minute resets the backoff.
- i2pd carries on when SAM can't bind its port (another program took it): the process then exits with code 3 and
  the supervisor restarts it on a new port, said with a `port` event.
- A router stopped in its first minute starts again from the reseed servers.
- No web console, no proxies, no IPv6 unless asked; i2pd logs warnings to `i2pd.log` in its data folder.
- UPnP is on (`upnp: false` turns it off): it opens the router's port on a home NAT so others can reach it and it
  can relay. Without it, a router behind a NAT stays "Firewalled" and relays almost nothing.
- Relaying is on by default: `bandwidth` O (256 KB/s), `share` 50 %. `notransit` turns it off.
- i2pd saves the router records it learns about once a minute, not when it stops (a limit we accept).
- The addon reads its options once per process (i2pd's config can't be initialised twice): `stop()` then `start()`
  in one process runs again with the first options. Changing them means restarting the process.

## The addon

`start({ dataDir, samPort, port?, bandwidth?, share?, notransit?, ipv6?, upnp? })` starts the router, SAM and UPnP;
`stop()` stops them; `status()` reports as above, with `upnp` (`running: false` alone when stopped). It binds to whatever exe loads it (Bare,
Electron, Node) through a delay-load hook on Windows; Linux and macOS take `napi_*` from the host.

Building on Windows (MSVC, the same toolset as the dependencies, CMake, Ninja; dependencies from vcpkg, triplet
`x64-windows-static`: Boost, OpenSSL, zlib, miniupnpc). Besides `libi2pd` and `libi2pd_client`, the addon
compiles i2pd's `daemon/UPnP.cpp`, the only daemon file:

```bash
router\addon\build.cmd <i2pd-src> <vcpkg installed\x64-windows-static> <node-api headers> <out>
```

Linux and macOS: `router/addon/build.sh` with the same arguments. Put the result at
`router/prebuilds/<platform>-<arch>/i2pd.node` (not in git). `HB_ROUTER_ADDON` points the process at another file.

## Defender and releases

Every Windows build is scanned (`MpCmdRun -Scan -ScanType 3 -File`) after a signature update; CI fails on any
detection and the build is not shipped. A flagged build is submitted to Microsoft as a false positive
(https://www.microsoft.com/wdsi/filesubmission, "Software developer", free) and the release waits. No paid code
signing for now.

Linux and macOS builds run only in CI.

## Checks

```bash
node test/router.test.js                                          # the supervisor, with a stand-in process
node --expose-gc router/addon/check.cjs <addon> <dataDir> 20      # 20 stop/start cycles in one process
node router/soak.mjs switches <dataDir> 20                        # 20 identity switches against one router
node router/soak.mjs soak <dataDir> <log.jsonl> 10                # the soak run, until stopped
```

The last three join the live I2P network and relay while they run.

## Anonymous identities

An identity made with **Anonymous** (`identities.json`: `anonymous: true`, fixed for its life) opens its engine with
hypergraph's `transport: 'i2p'` and the router's SAM port (`shell/i2p.js`); a regular one with `'dual'`. While it
waits for its tunnels a small window says "Connecting to I2P…" (with why, when a try failed), then the frame shows
it again if the router stops. Contacts get a SAM session of their own (they frame the whole stream, and the engine's
connections must not show a stranger its spaces) and are not findable unless turned on. The updater pauses while it
is open. `deviceName` is empty, `--no-guards` is refused. Switching between a regular and an anonymous identity, either
way, within 10 minutes of the other kind closing, warns first. Photos a linked folder left out are offered to be added
one by one, stripped; a file over 5 MB coming from peers is said to be slow. Each identity keeps the I2P DHT nodes it
met in its own folder (`i2p-nodes.json`), started from next time with the shipped `shell/i2p-bootstrap.json`
(empty until helpers listen on I2P).

Relaying and UPnP are settings (Configuration → I2P, `i2p.json`); changing one restarts the router (engines open a
new session when it is back). Relaying is forced off when the system's time zone or region is in Java I2P's strict
countries (`STRICT` in `shell/i2p.js`): weaker than the router's own address (to come), but known before it starts.

### What can't leak (research 033, Q7)

| # | Path | Closed by |
|---|---|---|
| 1 | The engine's Hyperswarm | hypergraph never runs Hyperswarm, HyperDHT or udx-native under `'i2p'` (`test/next/net/i2p-transport.js`: none ran, every socket to 127.0.0.1) |
| 2 | Helpers and holders through `swarm.dht` | helpers over I2P (`test/next/forum/i2p.js`); no holder under `'i2p'` (blind-peer loads Hyperswarm) |
| 3 | Pairing over the DHT | `addDevice` and `joinCode` throw `NOT_ALLOWED` (`i2p-transport.js`) |
| 4 | LAN addresses in hyperdht's handshake | follows #1: hyperdht never runs |
| 5 | Contacts' own Hyperswarm | an I2P session of their own, Hyperswarm imported only for regular identities; not findable by default (`test/anonymous.test.js`) |
| 6 | The updater's Hyperswarm | paused while an anonymous identity is open (`admit`, `test/i2p.test.js`) |
| 7 | The host name as device name | empty (`test/i2p.test.js`, `test/anonymous.test.js`) |
| 8 | The router: reseed over HTTPS, UPnP on the LAN, its public record | by design: shows that this IP runs I2P, not who (UPnP on, by the owner's choice) |
| 9 | One router for two identities | one SAM session per open, a fresh destination each time, 3 hops set explicitly; whether i2pd keeps each session's netDb lookups apart is **not verified** |
| 10 | Pages outside `hyper://` | the page guards (`test:sandbox`) |
| 11 | `--no-guards` | refused for an anonymous identity (`admit`, `test/i2p.test.js`) |
| 12 | Shared storage | each identity its own folder and partitions; SwarmFS never uses another identity's copy (SwarmFS `test/anonymous.test.js`) |
| 13 | Telemetry, crash reporter, NTP | none in the code |
| 14 | 2-hop tunnels | `inbound.length=3 outbound.length=3` on every session (hypergraph `lib/i2p/sam.js`) |
