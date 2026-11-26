// Only what HyperBrowser uses of packages that ship no types.

declare module 'framed-stream' {
  import { EventEmitter } from 'events'
  /** Length-prefixed frames over a byte stream: one `data` event per written buffer (a streamx Duplex). */
  class FramedStream extends EventEmitter {
    constructor (stream: unknown)
    readonly destroyed: boolean
    write (data: Uint8Array): boolean
    end (): this
    destroy (err?: Error): void
    on (event: 'data', fn: (data: Uint8Array) => void): this
    on (event: 'close' | 'end', fn: () => void): this
    on (event: 'error', fn: (err: Error) => void): this
  }
  export = FramedStream
}

declare module 'hypercore-crypto' {
  const crypto: {
    hash (data: Uint8Array | Uint8Array[]): Uint8Array
    randomBytes (n: number): Uint8Array
    keyPair (seed?: Uint8Array): { publicKey: Uint8Array, secretKey: Uint8Array }
  }
  export = crypto
}

declare module 'z32' {
  const z32: {
    encode (data: Uint8Array): string
    decode (text: string): Uint8Array
  }
  export = z32
}

declare module 'hyperdht/testnet.js' {
  type Testnet = {
    bootstrap: Array<{ host: string, port: number }>
    destroy (): Promise<void>
  }
  function createTestnet (size?: number): Promise<Testnet>
  export = createTestnet
}

declare module 'pear-runtime' {
  import { EventEmitter } from 'events'
  type Updater = EventEmitter & {
    nextVersion: string
    next: string
    drive: { core: { discoveryKey: Uint8Array } }
    applyUpdate (): Promise<void>
  }
  type Worker = InstanceType<typeof import('bare-sidecar')>
  class PearRuntime extends EventEmitter {
    /** Runs a Bare script; its stdio pipe is Bare.IPC on the other side. */
    static run (entrypoint: string, args?: string[]): Worker
    constructor (opts: {
      dir: string, version: string, upgrade: string, name: string, app: string,
      store: unknown, swarm: unknown, delay?: number
    })
    updater: Updater
    ready (): Promise<void>
    close (): Promise<void>
  }
  export = PearRuntime
}

declare module 'hyperdrive' {
  class Hyperdrive {
    constructor (store: unknown)
    key: Uint8Array
    discoveryKey: Uint8Array
    version: number
    ready (): Promise<void>
    close (): Promise<void>
  }
  export = Hyperdrive
}

declare module 'localdrive' {
  class Localdrive {
    constructor (root: string)
    mirror (to: unknown): { done (): Promise<void> }
    close (): Promise<void>
  }
  export = Localdrive
}
declare module 'sodium-universal' // hypergraph's lib/i2p uses it
