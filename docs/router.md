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
  Firewalled, …), known `routers`, `transit` tunnels, `transitBytes`, its own `rssMB` and `cpuS`.
- A crash or exit is restarted after 1 s, doubling up to 60 s; a run longer than a minute resets the backoff.
- i2pd carries on when SAM can't bind its port (another program took it): the process then exits with code 3 and
  the supervisor restarts it on a new port, said with a `port` event.
- i2pd saves the router records it learns about once a minute, not when it stops: a router stopped in its first
  minute starts again from the reseed servers.
- No web console, no proxies, no UPnP, no IPv6 unless asked; i2pd logs warnings to `i2pd.log` in its data folder.
- Relaying is on by default: `bandwidth` O (256 KB/s), `share` 50 %. `notransit` turns it off.
- The addon reads its options once per process (i2pd's config can't be initialised twice): `stop()` then `start()`
  in one process runs again with the first options. Changing them means restarting the process.

## The addon

`start({ dataDir, samPort, bandwidth?, share?, notransit?, ipv6? })` starts the router and SAM; `stop()` stops both;
`status()` reports as above (`running: false` alone when stopped). It binds to whatever exe loads it (Bare,
Electron, Node) through a delay-load hook on Windows; Linux and macOS take `napi_*` from the host.

Building on Windows (MSVC, the same toolset as the dependencies, CMake, Ninja; dependencies from vcpkg, triplet
`x64-windows-static`):

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
