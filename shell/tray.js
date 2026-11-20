import { Tray, Menu, Notification, nativeImage } from 'electron'
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const ICON = path.join(path.dirname(fileURLToPath(import.meta.url)), 'icons', 'tray.png')
const POLL = 10000

// Linux: a tray icon shows only where the desktop runs a StatusNotifier host (KDE, Cinnamon, XFCE…; GNOME only
// with the AppIndicator extension). With none, no tray: closing quits, rather than a process nobody can see.
export function hasTray () {
  if (process.platform !== 'linux') return true
  try {
    const args = ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher']
    return execFileSync('gdbus', args, { timeout: 2000 }).toString().includes('true')
  } catch {
    return false // no gdbus, or no session bus: no way to tell, so no tray
  }
}

/** @param {import('electron').NativeImage} image */
function withMark (image) {
  const { width, height } = image.getSize()
  const px = Buffer.from(image.toBitmap()) // BGRA
  const s = Math.max(3, Math.round(width * 0.45))
  for (let y = height - s; y < height; y++) {
    for (let x = width - s; x < width; x++) px.set([0x22, 0x22, 0xdd, 0xff], (y * width + x) * 4)
  }
  return nativeImage.createFromBitmap(px, { width, height })
}

/**
 * @param {object} opts
 * @param {Pick<import('../engine/protocol.js').Rpc, 'request'>} opts.rpc
 * @param {() => void} opts.show
 * @param {() => void} opts.quit
 */
export function startTray ({ rpc, show, quit }) {
  const image = nativeImage.createFromPath(ICON)
  const marked = withMark(image)
  const tray = new Tray(image)
  let unread = 0
  let status = 'starting…'
  /** @type {import('electron').Menu | null} */
  let menu = null
  const draw = () => {
    menu = Menu.buildFromTemplate([
      { label: 'Open HyperBrowser', click: show },
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: quit }
    ])
    tray.setContextMenu(menu) // set again after each change (Linux shows the menu it was given)
  }
  const poll = () => rpc.request('hosting').then((/** @type {{ sites: number }} */ { sites }) => {
    const s = 'hosting ' + sites + (sites === 1 ? ' site' : ' sites')
    if (s !== status) { status = s; draw() }
  }, () => {})
  tray.setToolTip('HyperBrowser')
  tray.on('click', show) // Windows: a click on the icon; the menu is on right-click
  draw()
  poll()
  const timer = setInterval(poll, POLL)
  return {
    status: () => status,
    marked: () => unread > 0,
    /** @param {number} n */
    mark (n) {
      if ((n > 0) !== (unread > 0)) tray.setImage(n > 0 ? marked : image)
      unread = n
      tray.setToolTip(n > 0 ? `HyperBrowser: ${n} new` : 'HyperBrowser')
    },
    /** @param {string} label */
    item: (label) => /** @type {import('electron').Menu} */ (menu).items.find((i) => i.label === label), // drawn at once
    /** @param {string} text */
    notice (text) {
      if (process.platform === 'win32') tray.displayBalloon({ icon: image, title: 'HyperBrowser', content: text })
      else if (Notification.isSupported()) new Notification({ title: 'HyperBrowser', body: text }).show()
    },
    destroy () {
      clearInterval(timer)
      tray.destroy()
    }
  }
}
