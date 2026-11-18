// Bare entry when the shell runs the engine with pear-runtime (Bare.IPC is the pipe): the only file that
// touches Bare's globals. Exits once the engine closed (heartbeat lost, 'close', or the pipe ended).
/* global Bare */
import { start, guard } from './index.js'

const engine = start(Bare.IPC)
guard(engine, Bare)
engine.closed.then(() => Bare.exit(0))
