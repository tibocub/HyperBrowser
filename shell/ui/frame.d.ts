// The frame page (ui.js) and the shell (frame.js), through frame-preload.cjs. Site views never get this door.

type Icon = import('../model.js').Icon

/** An error as the frame gets it. */
export interface Failure { code: string, message: string }

/** frame.js handle()'s answer; `result` is that op's (see handle()). */
export interface Reply { result?: any, error?: Failure }

export interface TabView {
  id: number
  key: string | null
  name: string | null
  short: string
  title: string
  icon: string | null
  status: 'opening' | 'ready' | 'error'
  error: string | null
  canBack: boolean
  canForward: boolean
  loading: boolean
  state: { complete: boolean, peers: number } | null
  held: { bytes: number, kept: boolean } | null
  kind: 'installed' | 'bookmark' | null
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  accent: string
  tray: boolean
  trayNoticed: boolean
  circleNoticed: boolean
  /** The site's share of the width when a preview is docked beside it. */
  split: number
}

export interface Unread { total: number, byApp: Record<string, number>, byPlace: Record<string, number> }

/** A notification as the engine's notify.state lists it. */
export interface Note {
  app: string
  place: string
  id: string
  type: string
  author: string
  name: string
  text: string | null
  open: string | null
  stamp: number | null
  at: number
  read: boolean
  popup: boolean
}

export interface NotifyState {
  items: Note[]
  unread: Unread
  apps: Array<{ key: string, title: string, allow: boolean, hide: boolean, places: Array<{ key: string, name: string | null, muted: boolean }> }>
}

/** What the shell sends on every change (frame.js snapshot()). */
export interface FrameState {
  current: number
  tabs: TabView[]
  desktop: { icons: Icon[] }
  settings: Settings
  notes: NotifyState
  identity: string | null
  /** This computer's identities, the open one marked current. */
  identities: IdentityRow[]
  /** null: the open identity uses the regular network only (no router here). */
  i2p: I2PState | null
  /** Shown in the identities window as this window opens: a restore's outcome. */
  note: string | null
  joined: { said: string, n: number } | null
  version: string
  update: string | null
  /** Site tabs open. */
  open: number
  ready: boolean
  maximized: boolean
}

/** One of this computer's identities (shell/identities.js). */
export interface IdentityRow { id: string, name: string, current: boolean, anonymous: boolean }

/** The open identity's I2P side: anonymous identities wait for it (nothing of them reaches the network before). */
export interface I2PState { state: 'connecting' | 'ready', reason: string | null, anonymous: boolean }

/** A circle, as circles.list gives it to the frame. */
export interface Circle { key: string, name: string, members: number, holders: number, total: number | null, role: string | null, totalLine: string }

/** A circle's member, as circles.members gives it to the frame. */
export interface CircleMember { identity: string, name: string, role: string, you: boolean, holds: boolean, share: number | null, used: number | null, held: string }

/** This identity's devices (devices.list). */
export interface Devices {
  identity: string
  devices: Array<{ publicKey: string, name: string, current: boolean, online: boolean }>
  removed: boolean
  phrase: 'plain' | 'protected' | 'forgotten'
  owns: Array<{ key: string, name: string }>
}

/** What this computer holds for its circles (holding.get). */
export interface Holding { on: boolean, bytes: number, used: number, free: number }

export interface FrameApi {
  send (op: string, args?: object): Promise<Reply>
  onState (fn: (state: FrameState) => void): void
  onFocusAddress (fn: () => void): void
  onDevices (fn: () => void): void
  onCircles (fn: (d: { open?: boolean, note?: string } | undefined) => void): void
}

/** The elements ui.js uses as more than an HTMLElement, by id. */
interface Elements {
  'id-anon': HTMLInputElement
  back: HTMLButtonElement
  forward: HTMLButtonElement
  reload: HTMLButtonElement
  star: HTMLButtonElement
  address: HTMLInputElement
  'cf-share': HTMLInputElement
  'dv-pass': HTMLInputElement
  'cl-name': HTMLInputElement
  'id-name': HTMLInputElement
  'id-pass': HTMLInputElement
}

/** document.getElementById for the frame page, whose elements are all there. */
export type ById = <K extends string>(id: K) => K extends keyof Elements ? Elements[K] : HTMLElement

declare global {
  const frame: FrameApi
}
