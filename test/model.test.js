// The frame's pure logic (spec 002 FR-005, FR-007; data-model.md): the address and the desktop's cells.
import test from 'brittle'
import { parseAddress, shortKey, place, upsert, move, remove, COLUMNS } from '../shell/model.js'

const KEY = 'yb'.repeat(26) // 52 z32 letters

test('the address: a full key or an hg: link opens, anything else is refused', (t) => {
  t.alike(parseAddress(KEY), { key: KEY })
  t.alike(parseAddress('  ' + KEY + '\n'), { key: KEY }, 'pasted with spaces')
  t.alike(parseAddress('hg:abc123'), { key: 'hg:abc123' }, 'an invite or public link goes to the engine as is')
  for (const bad of ['', 'hello', KEY.slice(1), KEY + 'y', KEY.toUpperCase(), KEY.slice(0, 51) + 'l', 'hg:']) {
    t.ok(parseAddress(bad).error, JSON.stringify(bad))
  }
})

test('the short key: 6 first, 3 last', (t) => {
  t.is(shortKey('6x99a3' + 'y'.repeat(43) + 'cjy'), '6x99a3…cjy')
  t.is(shortKey('hg:abc'), 'hg:abc', 'not a key: as it is')
})

test('the desktop: first free cell, swap on move, a preset gets its key and keeps its cell', (t) => {
  let icons = []
  icons = upsert(icons, { id: 'preset:hb', key: null, title: 'HyperBrowser', kind: 'installed' })
  icons = upsert(icons, { id: 'preset:forum', key: null, title: 'Forum', kind: 'installed' })
  t.alike(icons.map((i) => [i.col, i.row]), [[0, 0], [1, 0]])
  t.alike(place(icons), { col: 2, row: 0 })

  icons = upsert(icons, { id: KEY, key: KEY, title: 'Docs', kind: 'bookmark' })
  t.alike([icons[2].col, icons[2].row], [2, 0])
  icons = upsert(icons, { id: KEY, title: 'Docs 2' })
  t.is(icons.length, 3, 'same id: updated, not added')
  t.is(icons[2].title, 'Docs 2')
  t.is(icons[2].kind, 'bookmark', 'fields not given are kept')

  icons = move(icons, KEY, 0, 0)
  t.alike(icons.find((i) => i.id === KEY).col, 0, 'moved')
  t.alike(icons.find((i) => i.id === 'preset:hb').col, 2, 'the one there took its old cell')
  icons = move(icons, KEY, 5, 3)
  t.alike(place(icons), { col: 0, row: 0 }, 'the freed cell is first free again')
  t.is(move(icons, KEY, -1, 0), icons, 'off the grid: unchanged')
  t.is(move(icons, KEY, COLUMNS, 0), icons, 'past the last column: unchanged')

  const forumKey = 'ka'.repeat(26)
  const before = icons.find((i) => i.id === 'preset:forum')
  icons = upsert(icons, { id: forumKey, key: forumKey, title: 'Forum' }, 'preset:forum')
  const after = icons.find((i) => i.id === forumKey)
  t.alike([after.col, after.row, after.kind], [before.col, before.row, 'installed'])
  t.absent(icons.find((i) => i.id === 'preset:forum'))

  icons = remove(icons, KEY)
  t.is(icons.length, 2)
})
