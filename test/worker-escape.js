// engine/worker.js as the shell runs it, then an error thrown and a promise rejected that nobody catches
// (test/worker.test.js): the worker must log them, tell the shell and keep running.
import '../engine/worker.js'

setTimeout(() => { throw Object.assign(new Error('thrown'), { code: 'TEST' }) }, 500)
setTimeout(() => { Promise.reject(Object.assign(new Error('rejected'), { method: 'site.call' })) }, 700)
