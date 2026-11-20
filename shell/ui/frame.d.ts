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
  joined: { said: string, n: number } | null
  version: string
  update: string | null
  /** Site tabs open. */
  open: number
  ready: boolean
  maximized: boolean
}

export interface FrameApi {
  send (op: string, args?: object): Promise<Reply>
  onState (fn: (state: FrameState) => void): void
  onFocusAddress (fn: () => void): void
  onDevices (fn: () => void): void
  onCircles (fn: (d: { open?: boolean, note?: string } | undefined) => void): void
}

/** The elements ui.js uses as more than an HTMLElement, by id. */
interface Elements {
  back: HTMLButtonElement
  forward: HTMLButtonElement
  reload: HTMLButtonElement
  star: HTMLButtonElement
  address: HTMLInputElement
  'cf-share': HTMLInputElement
  'dv-pass': HTMLInputElement
  'cl-name': HTMLInputElement
}

/** document.getElementById for the frame page, whose elements are all there. */
export type ById = <K extends string>(id: K) => K extends keyof Elements ? Elements[K] : HTMLElement

declare global {
  const frame: FrameApi
}
