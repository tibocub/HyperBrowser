// CodeMirror, bundled by scripts/ide-vendor.mjs: the one function it exports.

export interface Editor {
  get (): string
  set (text: string): void
  focus (): void
  undo (): boolean
  redo (): boolean
  search (): boolean
  destroy (): void
}

/**
 * An editor in `parent` (in its shadow root) for a file named `name`: its language from the extension.
 * wrap: long lines wrapped; tabSize: a tab's width and an indent's; lineNumbers: shown.
 */
export function editor (parent: HTMLElement, opts?: {
  name?: string
  doc?: string
  onChange?: () => void
  label?: string
  wrap?: boolean
  tabSize?: number
  lineNumbers?: boolean
}): Editor
