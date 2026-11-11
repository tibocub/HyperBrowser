// Where a redraw leaves the message list (test/chat.test.js): a pure decision, the page has no DOM tests.

const SLACK = 8 // px: zoom and fractional scrolling rarely land exactly on the end

// `list`: the list on screen (with data-key: its conversation), or null; `key`: the conversation being drawn;
// `toEnd`: you just sent a message. → the scrollTop to keep, or null for the end.
// shortcut: past the 300 messages shown, the oldest drops and the place shifts by it; anchor on a message if that bothers
export function keepScroll (list, key, toEnd = false) {
  if (toEnd || !list || list.dataset.key !== key) return null
  return list.scrollHeight - list.scrollTop - list.clientHeight <= SLACK ? null : list.scrollTop
}
