// The shell's own view, no site in it.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('split', {
  send: (/** @type {unknown} */ msg) => ipcRenderer.send('split', msg),
  on: (/** @type {(d: { at: number, value: number }) => void} */ fn) => ipcRenderer.on('split-at', (e, d) => fn(d))
})
