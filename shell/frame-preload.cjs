// The frame page's only door to the shell (spec 002, contracts/frame.md). Site views never get this preload.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('frame', {
  send: (op, args) => ipcRenderer.invoke('frame', { op, args }),
  onState: (fn) => ipcRenderer.on('frame-state', (e, state) => fn(state)),
  onFocusAddress: (fn) => ipcRenderer.on('frame-focus', () => fn()),
  onDevices: (fn) => ipcRenderer.on('frame-devices', () => fn())
})
