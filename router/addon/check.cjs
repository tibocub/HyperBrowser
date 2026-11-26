// Checks the built addon in Node: node router/addon/check.cjs <addon.node> <dataDir> [cycles=20]
// Each cycle: start, wait for SAM to answer, stop. Prints RSS and handles per cycle, so a leak or a crash shows.
const path = require('path')
const sam = require('../sam.cjs')
const [file, dir, n = '20'] = process.argv.slice(2)
const addon = require(path.resolve(file))
const PORT = 17656 + (process.pid % 1000)

;(async () => {
  for (let i = 1; i <= Number(n); i++) {
    const t0 = Date.now()
    addon.start({ dataDir: dir, samPort: PORT })
    for (;;) {
      try { (await sam.control({ port: PORT })).socket.destroy(); break } catch { await new Promise((r) => setTimeout(r, 100)) }
      if (Date.now() - t0 > 30000) throw new Error('SAM did not answer in cycle ' + i)
    }
    const helloMs = Date.now() - t0
    await new Promise((r) => setTimeout(r, 3000))
    const s = addon.status()
    addon.stop()
    if (global.gc) global.gc()
    console.log(JSON.stringify({ cycle: i, helloMs, routers: s.routers, rssMB: Math.round(process.memoryUsage().rss / 1e6), handles: process.getActiveResourcesInfo().length }))
  }
  console.log('done')
})().catch((e) => { console.error(e); process.exitCode = 1 })
