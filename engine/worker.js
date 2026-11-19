// The only file that touches Bare's globals.
/* global Bare */
import { start, guard } from './index.js'

const engine = start(Bare.IPC)
guard(engine, Bare)
engine.closed.then(() => Bare.exit(0))
