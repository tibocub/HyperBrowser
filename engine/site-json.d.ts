// A site.json, as engine/manifest.js parseManifest() checks it. Pure types: the IDE's page reads them too.

export type TypeDeclarations = import('hypergraph/lib/types.js').TypeDeclarations

/** A notifications watch of site.json, or a page's follow (place, where, by, popup: follows only). */
export interface Watch {
  type: string | string[]
  me?: string
  text?: string
  says?: string
  open?: string
  show?: 'dot'
  place?: string
  where?: Record<string, string | number | boolean>
  by?: string
  popup?: boolean
}

export interface Manifest {
  title: string
  entry: string
  icon?: string
  permissions: string[]
  public?: boolean
  types?: TypeDeclarations
  notifications?: Watch[]
}
