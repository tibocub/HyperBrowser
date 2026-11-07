// Bare entry when the shell runs the engine with pear-runtime (Bare.IPC is the pipe): the only file that
// touches Bare's globals. Exits once the engine closed (heartbeat lost, 'close', or the pipe ended).
/* global Bare */
import { start } from './index.js'

start(Bare.IPC).closed.then(() => Bare.exit(0))
