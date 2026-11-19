#!/usr/bin/env node
// the IDE's two bundles, made once and committed (the IDE is a site: it loads nothing from outside its
// folder, and HyperBrowser gains no dependency):
//   sites/ide/vendor/editor.js  CodeMirror 6, only JS, HTML, CSS, JSON, Markdown, search and undo (loaded lazily)
//   sites/ide/vendor/hmd.js     HyperMD's parser and renderer, and the engine's site.json check (engine/manifest.js)
// CodeMirror and esbuild are installed into a temp folder at the versions below. Run: node scripts/ide-vendor.mjs
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'sites', 'ide', 'vendor')
const VERSIONS = {
  '@codemirror/state': '6.7.6',
  '@codemirror/view': '6.43.15',
  '@codemirror/commands': '6.11.1',
  '@codemirror/language': '6.13.1',
  '@codemirror/search': '6.7.2',
  '@codemirror/lang-javascript': '6.2.5',
  '@codemirror/lang-html': '6.4.12',
  '@codemirror/lang-css': '6.3.1',
  '@codemirror/lang-json': '6.0.2',
  '@codemirror/lang-markdown': '6.5.2',
  esbuild: '0.28.2'
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-vendor-'))
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'ide-vendor', private: true, dependencies: VERSIONS }))
execSync('npm install --no-audit --no-fund --ignore-scripts=false', { cwd: tmp, stdio: 'inherit' })

fs.writeFileSync(path.join(tmp, 'editor.js'), `
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightSpecialChars } from '@codemirror/view'
import { history, defaultKeymap, historyKeymap, undo, redo } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'

const LANGS = { js: javascript, mjs: javascript, html: html, htm: html, css: css, json: json, md: markdown, hmd: markdown }

// The page's default theme (HyperBrowser's) inside the editor: its colours, its font (inherited).
const look = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink, CanvasText)', backgroundColor: 'var(--paper, Canvas)' },
  '.cm-content': { caretColor: 'var(--ink, CanvasText)' },
  '.cm-cursor': { borderLeftColor: 'var(--ink, CanvasText)' },
  '.cm-gutters': { color: 'inherit', backgroundColor: 'var(--paper, Canvas)', borderRight: '1px solid' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent', outline: '1px dotted' },
  '.cm-scroller': { fontFamily: 'inherit' },
  // the shared theme's scrollbars (shell/ui/theme.css), which can't reach into a shadow root
  '.cm-scroller::-webkit-scrollbar': { width: '16px', height: '16px', background: 'var(--paper, Canvas)' },
  '.cm-scroller::-webkit-scrollbar-track': { backgroundColor: 'var(--paper, Canvas)', backgroundImage: 'repeating-conic-gradient(var(--ink, CanvasText) 0 25%, var(--paper, Canvas) 0 50%)', backgroundSize: 'calc(2 * var(--px, 1px)) calc(2 * var(--px, 1px))' },
  '.cm-scroller::-webkit-scrollbar-track:vertical': { borderLeft: '1px solid var(--ink, CanvasText)' },
  '.cm-scroller::-webkit-scrollbar-track:horizontal': { borderTop: '1px solid var(--ink, CanvasText)' },
  '.cm-scroller::-webkit-scrollbar-thumb': { background: 'var(--paper, Canvas)', border: '1px solid var(--ink, CanvasText)' },
  '.cm-scroller::-webkit-scrollbar-thumb:active': { background: 'var(--ink, CanvasText)' },
  '.cm-scroller::-webkit-scrollbar-corner': { background: 'var(--paper, Canvas)' }
})

// An editor in \`parent\` for a file named \`name\`: { get(), set(text), focus(), undo(), redo(), search(), destroy() }.
// In a shadow root: its styles stay there (a <style> in the page would turn HyperBrowser's default theme off).
// wrap: long lines wrapped; tabSize: a tab's width and an indent's; lineNumbers: shown.
export function editor (parent, { name = '', doc = '', onChange = () => {}, label = 'Code', wrap = false, tabSize = 2, lineNumbers: numbers = true } = {}) {
  const lang = LANGS[name.split('.').pop().toLowerCase()]
  const root = parent.shadowRoot || parent.attachShadow({ mode: 'open' })
  const view = new EditorView({
    root,
    parent: root,
    state: EditorState.create({
      doc,
      extensions: [
        ...(numbers ? [lineNumbers()] : []), ...(wrap ? [EditorView.lineWrapping] : []),
        EditorState.tabSize.of(tabSize), indentUnit.of(' '.repeat(tabSize)), highlightSpecialChars(), history(), drawSelection(), indentOnInput(), bracketMatching(),
        highlightActiveLine(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        look,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange() }),
        ...(lang ? [lang()] : [])
      ]
    })
  })
  return {
    get: () => view.state.doc.toString(),
    set: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    focus: () => view.focus(),
    undo: () => undo(view),
    redo: () => redo(view),
    search: () => openSearchPanel(view),
    destroy: () => view.destroy()
  }
}
`)
fs.writeFileSync(path.join(tmp, 'hmd.js'), `
export { parse, renderPage, applyLayout, siteMenu, createNode, plainText, pageTitle } from 'hypermd'
export { pageHref } from 'hypermd/src/build.js'
export { parseManifest } from ${JSON.stringify(path.join(ROOT, 'engine', 'manifest.js').split(path.sep).join('/'))}
import b4a from 'b4a'
export const utf8 = (bytes) => b4a.toString(bytes, 'utf8') // Bare has no TextDecoder
`)
fs.writeFileSync(path.join(tmp, 'empty.js'), 'export default {}\n')

const { build } = await import(path.join(tmp, 'node_modules', 'esbuild', 'lib', 'main.js').split(path.sep).join('/').replace(/^([A-Z]):/, 'file:///$1:'))
fs.mkdirSync(OUT, { recursive: true })
const common = { bundle: true, format: 'esm', platform: 'browser', minify: true, legalComments: 'eof', nodePaths: [path.join(tmp, 'node_modules'), path.join(ROOT, 'node_modules')] }
await build({ ...common, entryPoints: [path.join(tmp, 'editor.js')], outfile: path.join(OUT, 'editor.js') })
// build.js and manifest.js import fs and path for what the page never calls (build(), readManifest())
// neutral: the same file runs in the page and in the tests on Node and Bare (the browser build of micromark's entity
// decoder needs a DOM); b4a's browser file, since its default one needs Buffer
await build({
  ...common,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  entryPoints: [path.join(tmp, 'hmd.js')],
  outfile: path.join(OUT, 'hmd.js'),
  alias: { fs: path.join(tmp, 'empty.js'), path: path.join(tmp, 'empty.js'), b4a: path.join(ROOT, 'node_modules', 'b4a', 'browser.js') }
})
for (const f of ['editor.js', 'hmd.js']) console.log(f, fs.statSync(path.join(OUT, f)).size, 'bytes')
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { console.log('left ' + tmp + ' (esbuild still loaded): delete it') }
