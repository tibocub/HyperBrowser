// Anonymous identities through the frame's own controls, over hypergraph's SAM stand-in (no router):
// the Anonymous checkbox makes one, marked in the list; switching to it warns (timing) and shows "Connecting to
// I2P…" while its engine waits; its window is marked; Configuration shows the I2P settings and changes them;
// switching back warns again. Used by test/sandbox.electron.js (--identitycheck i2p).
import { app } from 'electron'

/** @typedef {ReturnType<typeof import('../frame.js').startFrame>} Frame */

/**
 * @param {object} o
 * @param {() => Frame | null} o.ui
 * @param {ReturnType<typeof import('../identities.js').identities>} o.ids
 * @param {() => boolean} o.switching
 * @param {{ warned: string[], waited: number }} o.seen what main.js recorded
 */
export async function i2pcheck ({ ui, ids, switching, seen }) {
  let all = true
  /** @param {string} name @param {unknown} pass */
  const ok = (name, pass) => { all = all && !!pass; console.log((pass ? 'PASS ' : 'FAIL ') + 'i2p  ' + name) }
  /** @param {number} ms */
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  /** @param {() => unknown} f */
  const until = async (f, ms = 60000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await f()) return true
    return false
  }
  /** @param {string} js */
  const inFrame = async (js) => {
    const { fwc } = /** @type {Frame} */ (ui()).inspect()
    await until(() => !fwc.isLoading())
    await until(() => fwc.executeJavaScript('!!document.getElementById("me-name") && document.getElementById("me-name").textContent !== "You"'))
    return fwc.executeJavaScript(js, true)
  }

  const main = ids.current()
  await inFrame(`document.getElementById('hb').click(); document.getElementById('m-ids').click()
    document.getElementById('id-anon').click(); document.getElementById('id-name').value = 'Anon'; document.getElementById('id-create').click()`)
  await until(() => ids.list().length === 2)
  const anon = ids.list().find((i) => i.name === 'Anon')
  ok('the Anonymous checkbox makes an anonymous identity', !!anon?.anonymous)
  ok('the identities window marks it', await until(() => inFrame("[...document.querySelectorAll('#id-list li')].some((li) => li.textContent.includes('Anon') && !!li.querySelector('.badge'))")))
  ok('its note says what anonymous means', await inFrame("!document.getElementById('id-anon-note').hidden || document.getElementById('id-out').textContent.includes('anonymous identity')"))

  const before = ui()
  await inFrame(`frame.send('identities.open', { id: ${JSON.stringify(anon?.id)} })`)
  ok('switching to it: a new window', await until(() => ui() && ui() !== before && !switching()))
  ok('it warned first (timing)', seen.warned.length === 1 && /regular identity/.test(seen.warned[0]))
  ok('"Connecting to I2P…" showed while its engine waited', seen.waited === 1)
  ok('the window is marked Anonymous', await inFrame("!document.getElementById('anon').hidden"))
  ok('nothing says it is still connecting', await inFrame("document.getElementById('i2p-wait').hidden"))

  await inFrame("document.getElementById('hb').click(); document.getElementById('m-config').click()")
  ok('Configuration shows the I2P settings', await until(() => inFrame("!document.getElementById('cf-i2p').hidden")))
  ok('relaying on by default', await inFrame("document.querySelector('[data-relay=\"on\"]').getAttribute('aria-pressed') === 'true'"))
  await inFrame("document.querySelector('[data-relay=\"off\"]').click()")
  ok("Don't relay: set", await until(() => inFrame("document.querySelector('[data-relay=\"off\"]').getAttribute('aria-pressed') === 'true'")))
  await inFrame("document.querySelector('[data-relay=\"on\"]').click(); document.getElementById('cf-close').click()")

  const second = ui()
  await inFrame(`frame.send('identities.open', { id: ${JSON.stringify(main.id)} })`)
  ok('switching back: Main again', await until(() => ui() && ui() !== second && !switching() && ids.current().id === main.id))
  ok('it warned again, the other way', seen.warned.length === 2 && /anonymous identity/.test(seen.warned[1]))
  ok('no Anonymous mark on Main', await inFrame("document.getElementById('anon').hidden"))

  console.log(all ? 'I2PCHECK PASS' : 'I2PCHECK FAIL')
  app.exit(all ? 0 : 1)
}
