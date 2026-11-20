// Site views never get this preload.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('frame', /** @type {import('./ui/frame.js', { with: { 'resolution-mode': 'import' } }).FrameApi} */ ({
  send: (op, args) => ipcRenderer.invoke('frame', { op, args }),
  onState: (fn) => ipcRenderer.on('frame-state', (e, state) => fn(state)),
  onFocusAddress: (fn) => ipcRenderer.on('frame-focus', () => fn()),
  onDevices: (fn) => ipcRenderer.on('frame-devices', () => fn()),
  onCircles: (fn) => ipcRenderer.on('frame-circles', (e, d) => fn(d))
}))
