// What the self-test page leaves for the shell to read.
interface Window {
  /** Set only if another site's script ran here. */
  leaked?: string
  __results?: Array<{ site: string, name: string, pass: boolean }>
}
