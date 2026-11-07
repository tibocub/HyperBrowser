// Members' 16×16 1-bit icons (spec 006 FR-009): 32 bytes, rows top down, the high bit leftmost.

export const SIZE = 16
export const BYTES = 32

export const get = (bytes, x, y) => (bytes[y * 2 + (x >> 3)] >> (7 - (x & 7))) & 1
export function set (bytes, x, y, on) {
  const i = y * 2 + (x >> 3)
  const bit = 1 << (7 - (x & 7))
  bytes[i] = on ? bytes[i] | bit : bytes[i] & ~bit
}

// Made from a key: symmetric left-right, the same on every device (FNV-1a seeds xorshift).
export function fromKey (key) {
  let h = 2166136261
  for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  const next = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h }
  const out = new Uint8Array(BYTES)
  // an 8×8 half-grid of 2×2 blocks inside a 1-pixel margin reads well at 16 px
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 4; x++) {
      if (next() % 100 >= 45) continue
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        set(out, 1 + x * 2 + dx, 1 + y * 2 + dy, true)
        set(out, 14 - x * 2 - dx, 1 + y * 2 + dy, true)
      }
    }
  }
  return out
}

export const valid = (bytes) => bytes instanceof Uint8Array && bytes.length === BYTES

// An SVG path (viewBox 0 0 16 16) of the set pixels, one rect per run in a row.
export function path (bytes) {
  let d = ''
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!get(bytes, x, y)) continue
      let w = 1
      while (x + w < SIZE && get(bytes, x + w, y)) w++
      d += `M${x} ${y}h${w}v1H${x}z`
      x += w - 1
    }
  }
  return d
}
