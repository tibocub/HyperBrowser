// The shell's own view, no site in it.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('split', {
  send: (msg) => ipcRenderer.send('split', msg),
  on: (fn) => ipcRenderer.on('split-at', (e, d) => fn(d))
})
