// Bare's globals, for the files that run on it (engine/worker.js, shell/updater.js).
declare const Bare: {
  /** The pipe to the process that started this one (pear-runtime's run). */
  IPC: import('stream').Duplex
  argv: string[]
  platform: string
  arch: string
  exit (code?: number): never
  on (event: 'uncaughtException' | 'unhandledRejection', fn: (err: unknown) => void): unknown
}
