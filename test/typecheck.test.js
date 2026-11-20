// npm run typecheck reports no error, and sites/hyper.d.ts declares the site API the preload gives, no more, no less.

import test from 'brittle'

if (typeof Bare !== 'undefined') {
  test('typecheck: skipped on Bare (a Node script)', (t) => t.pass('skipped on Bare'))
} else {
  const { spawnSync } = await import('child_process')
  const { createRequire } = await import('module')
  const path = (await import('path')).default
  const { fileURLToPath } = await import('url')
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const require = createRequire(import.meta.url)

  for (const config of ['jsconfig.json', 'shell/jsconfig.json', 'shell/ui/jsconfig.json', 'sites/jsconfig.json']) {
    test(`typecheck: ${config} has no type error`, { timeout: 180000 }, (t) => {
      const res = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(ROOT, config)], { cwd: ROOT, encoding: 'utf8' })
      t.is(res.status, 0, res.stdout.split('\n').slice(0, 20).join('\n') || 'no error')
    })
  }

  // The preload, run with a stand-in for Electron: the object it exposes as window.hyper.
  function preloadApi () {
    const exposed = {}
    require.cache[require.resolve('electron')] = {
      exports: {
        contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } },
        ipcRenderer: { on () {}, invoke: async () => ({ result: null }) }
      }
    }
    try {
      require(path.join(ROOT, 'shell', 'site-preload.cjs'))
    } finally {
      delete require.cache[require.resolve('electron')]
    }
    return exposed.hyper
  }

  // The properties hyper.d.ts gives an interface of the Hyper namespace, and those of each property that is an object.
  function declared () {
    const ts = require('typescript')
    const file = path.join(ROOT, 'sites', 'hyper.d.ts')
    const program = ts.createProgram([file], { noEmit: true, lib: ['lib.es2024.d.ts', 'lib.dom.d.ts'], types: [] })
    const checker = program.getTypeChecker()
    const hyper = program.getSourceFile(file).statements.find((s) => ts.isModuleDeclaration(s) && s.name.text === 'Hyper')
    const shape = (type) => {
      const out = {}
      for (const p of checker.getPropertiesOfType(type)) {
        const t = checker.getTypeOfSymbol(p)
        out[p.name] = t.getCallSignatures().length ? true : shape(t)
      }
      return out
    }
    return (name) => {
      const decl = hyper.body.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === name)
      return shape(checker.getTypeAtLocation(decl.name))
    }
  }

  const keys = (o) => Object.keys(o).sort()

  test('site API: hyper.d.ts declares what the preload exposes, at each level', (t) => {
    const api = preloadApi()
    const of = declared()
    const site = of('Site')
    t.alike(keys(api), keys(site), 'window.hyper')
    for (const [name, inner] of Object.entries(site)) {
      if (inner !== true) t.alike(keys(api[name]), keys(inner), 'window.hyper.' + name)
    }
    const place = of('Place')
    const instance = api.instance('x'.repeat(52))
    t.alike(keys(instance), keys(place), 'an instance: hyper.instance(key)')
    t.alike(keys(instance.mine), keys(place.mine), 'an instance\'s mine')
    t.alike(keys(api.subspace('x'.repeat(52))), keys(of('Space')), 'a sub-space: hyper.subspace(key)')
    t.alike(keys(api.query('note')), keys(of('Query')), 'a query: hyper.query(type)')
  })
}
