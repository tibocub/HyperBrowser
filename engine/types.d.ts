// Types shared by the engine's modules: the libraries' own, named once.
export type SwarmFS = import('swarmfs').SwarmFS
export type Site = import('swarmfs').Site
export type Hypergraph = import('hypergraph/next').Hypergraph
export type Space = import('hypergraph/lib/space.js').Space
export type SiteHandle = import('hypergraph/lib/scope.js').SiteHandle
export type HgRecord = import('hypergraph/lib/index/query.js').HgRecord
export type Page = import('hypergraph/lib/index/query.js').Page
export type TypeDeclarations = import('hypergraph/lib/types.js').TypeDeclarations
export type Manifest = import('./manifest.js').Manifest
export type Watch = import('./manifest.js').Watch
export type Rpc = import('./protocol.js').Rpc
export type Params = import('./protocol.js').Params
/** An error with a code, as the engine throws and tells them. */
export type CodedError = Error & { code?: string, method?: string }
/** Tells the shell an event (rpc.emit). */
export type Emit = (event: string, data: unknown) => void
