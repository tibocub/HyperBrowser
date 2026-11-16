// The frame's pure logic (spec 002 FR-005, FR-007; data-model.md): the address and the desktop's cells.
import test from 'brittle'
import { parseAddress, shortKey, place, upsert, move, remove, COLUMNS, checkShare, gb } from '../shell/model.js'

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

// spec 018 FR-006: the circles' share, a number of GB typed by the person; the engine checks the disk again.
test('the share: GB with decimals, 0.1 at least, at most free + held - 2 GB; lowering it says what goes', (t) => {
  const disk = { used: 0.4e9, free: 10e9 }
  t.alike(checkShare('1', disk), { bytes: 1e9, drop: 0 })
  t.alike(checkShare(' 2.5 ', disk), { bytes: 2.5e9, drop: 0 }, 'decimals')
  t.alike(checkShare('1,5', disk), { bytes: 1.5e9, drop: 0 }, 'a decimal comma too')
  t.alike(checkShare('0.1', disk), { bytes: 0.1e9, drop: 0.3e9 }, '0.1 is the least (below what is held: 0.3 GB would go)')
  for (const bad of ['', 'lots', '0', '0.05', '-1', '1e400', 'NaN']) t.is(checkShare(bad, disk).error, 'At least 0.1 GB', JSON.stringify(bad))
  t.alike(checkShare('8.4', disk), { bytes: 8.4e9, drop: 0 }, 'free + held - 2 GB: allowed')
  t.is(checkShare('8.5', disk).error, 'Only 8.4 GB free on this disk', 'past it: how much there is')
  t.is(checkShare('1', { used: 0, free: 1e9 }).error, 'Only 0 GB free on this disk', 'a nearly full disk')
  t.alike(checkShare('0.3', disk), { bytes: 0.3e9, drop: 0.1e9 }, 'below what is held: what would be dropped')
  t.is(gb(0.1e9), '0.1 GB')
  t.is(gb(1234567890), '1.2 GB')
  t.is(gb(0), '0 GB')
})
