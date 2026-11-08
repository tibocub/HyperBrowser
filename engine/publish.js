// What `cli.js publish` does on an engine's rpc (spec 001, 009), shared with scripts/apps-publish.js:
// publish the folder, then (--instance) the app's instance owned by this engine, and (--invite) an invite.
// → { key, created, instance, instanceCreated, invite }
export async function publish (rpc, folder, { fresh = false, instance: name = null, invite = null } = {}) {
  const { key, created } = await rpc.request('site.publish', { folder, fresh })
  const out = { key, created, instance: null, instanceCreated: false, invite: null }
  if (!invite && !name) return out
  // the owner's engine has no window to ask: running this command is the owner saying yes
  await rpc.request('site.open', { key })
  await rpc.request('site.consent', { key, allow: true })
  const call = (method, args, instance = null) => rpc.request('site.call', { key, instance, method, args })
  if (name) {
    const mine = (await call('instances.list', [])).find((i) => i.name === name && i.role === 'owner')
    out.instance = mine ? mine.key : (await call('instances.create', [name])).key
    out.instanceCreated = !mine
    const types = await call('types', [])
    if (types.official && (await rpc.request('site.call', { key, method: 'query', args: ['official'], chain: [['latest', [1]]] })).items?.[0]?.instance !== out.instance) await call('put', ['official', { instance: out.instance }])
  }
  if (invite) out.invite = await call('createInvite', [{ role: invite, uses: 1 }], out.instance)
  return out
}
