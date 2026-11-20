/**
 * Publishes a folder through an engine; with `instance`, also makes (or finds) the owner's instance of that name.
 * @param {import('./protocol.js').Rpc} rpc
 * @param {string} folder
 * @param {{ fresh?: boolean, instance?: string | null, invite?: string | null }} [opts] invite: a role, for a one-use invite link
 * @returns {Promise<{ key: string, created: boolean, instance: string | null, instanceCreated: boolean, invite: string | null }>}
 */
export async function publish (rpc, folder, { fresh = false, instance: name = null, invite = null } = {}) {
  const { key, created } = await rpc.request('site.publish', { folder, fresh })
  /** @type {{ key: string, created: boolean, instance: string | null, instanceCreated: boolean, invite: string | null }} */
  const out = { key, created, instance: null, instanceCreated: false, invite: null }
  if (!invite && !name) return out
  // the owner's engine has no window to ask: running this command is the owner saying yes
  await rpc.request('site.open', { key })
  await rpc.request('site.consent', { key, allow: true })
  /** @param {string} method @param {unknown[]} args @param {string | null} [instance] */
  const call = (method, args, instance = null) => rpc.request('site.call', { key, instance, method, args })
  if (name) {
    const mine = (await call('instances.list', [])).find((/** @type {{ key: string, name: string | null, role: string | null }} */ i) => i.name === name && i.role === 'owner')
    out.instance = mine ? mine.key : (await call('instances.create', [name])).key
    out.instanceCreated = !mine
    const types = await call('types', [])
    if (types.official && (await rpc.request('site.call', { key, method: 'query', args: ['official'], chain: [['latest', [1]]] })).items?.[0]?.instance !== out.instance) await call('put', ['official', { instance: out.instance }])
  }
  if (invite) out.invite = await call('createInvite', [{ role: invite, uses: 1 }], out.instance)
  return out
}
