// A stand-in router process: says it runs, then exits after HB_FAKE_EXIT_MS with HB_FAKE_EXIT_CODE (0: stays until told to stop).
/* global Bare */
import process from 'process'
const [dataDir, port, more] = Bare.argv.slice(2)
Bare.IPC.write(JSON.stringify({ running: true, status: 'OK', dataDir, port: Number(port), options: JSON.parse(more) }) + '\n')
const exitMs = Number(process.env.HB_FAKE_EXIT_MS) || 0
if (exitMs) setTimeout(() => Bare.exit(Number(process.env.HB_FAKE_EXIT_CODE) || 1), exitMs)
Bare.IPC.on('data', (d) => { if (String(d).includes('stop')) Bare.exit(0) })
