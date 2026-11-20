// Everything is escaped first; only the subset's own tags are made. Never raw HTML, never a script.

export const KEY = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{52}$/
const MENTION = /@([ybndrfg8ejkmcpqxot1uwisza345h769]{52})/g

/** @typedef {(key: string) => string | null | undefined} NameOf */

/** @param {unknown} s */
export const escape = (s) => String(s).replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/** @param {string} k */
export const shortKey = (k) => k.slice(0, 4) + '…' + k.slice(-4)

/**
 * A link may go to another HyperBrowser site, a page of this one, or a place on this page; images are this site's.
 * @param {string} h
 */
const safeHref = (h) => /^hyper:\/\/[a-z0-9]+(\/[^\s"'<>]*)?$/i.test(h) || /^#[\w/.-]*$/.test(h) || isPath(h)
/** @param {string} p */
const isPath = (p) => /^[\w][\w./-]*$/.test(p) && !p.split('/').includes('..')

/** @param {unknown} text @param {NameOf} [nameOf] */
export function render (text, nameOf = () => null) {
  /** @type {string[]} */
  const out = []
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  /** @type {string[]} */
  let para = []
  /** @type {string[]} */
  let quote = []
  const flush = () => {
    if (para.length) out.push('<p>' + para.map((l) => inline(l, nameOf)).join('<br>') + '</p>')
    if (quote.length) out.push('<blockquote>' + quote.map((l) => inline(l, nameOf)).join('<br>') + '</blockquote>')
    para = []
    quote = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      flush()
      /** @type {string[]} */
      const code = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i])
      out.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>')
    } else if (/^>\s?/.test(line)) {
      if (para.length) { const q = quote; quote = []; flush(); quote = q }
      quote.push(line.replace(/^>\s?/, ''))
    } else if (!line.trim()) {
      flush()
    } else {
      if (quote.length) { const p = para; para = []; flush(); para = p }
      para.push(line)
    }
  }
  flush()
  return out.join('')
}

/** @param {string} line @param {NameOf} nameOf */
function inline (line, nameOf) {
  /** @type {string[]} */
  const kept = [] // code spans and made tags, out of the way of the next rules
  /** @param {string} html */
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`
  let s = line.replace(/\u0000/g, '').replace(/`([^`]+)`/g, (m, c) => keep('<code>' + escape(c) + '</code>'))
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => isPath(src) ? keep(`<img src="${escape(src)}" alt="${escape(alt)}">`) : m)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => safeHref(href) ? keep(`<a href="${escape(href)}">`) + label + keep('</a>') : m)
  s = s.replace(MENTION, (m, key) => keep(mention(key, nameOf(key))))
  s = escape(s)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(])_(.+?)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => kept[i])
}

/** @param {string} key @param {string | null | undefined} name */
const mention = (key, name) => `<a class="mention" href="#/member/${key}" title="${escape((name || 'someone') + ' · ' + shortKey(key))}">＠${escape(name || shortKey(key))}</a>`

/** @param {unknown} text */
export const mentioned = (text) => [...new Set([...String(text || '').matchAll(MENTION)].map((m) => m[1]))]

// The editor shows @name; the stored text keeps @key. `picks`: { name: key } chosen while writing.
/** @param {unknown} draft @param {{ [name: string]: string }} picks */
export function toStored (draft, picks) {
  let s = String(draft)
  for (const [name, key] of Object.entries(picks).sort((a, b) => b[0].length - a[0].length)) {
    s = s.split('@' + name).join('@' + key)
  }
  return s
}

/** @param {unknown} text @param {NameOf} nameOf */
export function toDraft (text, nameOf) {
  /** @type {{ [name: string]: string }} */
  const picks = {}
  const draft = String(text || '').replace(MENTION, (m, key) => {
    const name = nameOf(key) || shortKey(key)
    picks[name] = key
    return '@' + name
  })
  return { draft, picks }
}

/** @param {unknown} text @param {NameOf} [nameOf] */
export const plain = (text, nameOf = () => null) => String(text || '').replace(MENTION, (m, k) => '＠' + (nameOf(k) || shortKey(k))).replace(/[*_`>#[\]]/g, '').replace(/\s+/g, ' ').trim()
