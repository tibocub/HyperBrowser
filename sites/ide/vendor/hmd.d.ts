// HyperMD and site.json's checks, bundled for the page by scripts/ide-vendor.mjs: HyperMD's own types.

export { parse, renderPage, applyLayout, siteMenu, createNode, plainText, pageTitle } from 'hypermd'
export { pageHref } from 'hypermd/src/build.js'
export function parseManifest (textOrBytes: string | Uint8Array): import('../../../engine/site-json.js').Manifest
export function utf8 (bytes: Uint8Array): string
