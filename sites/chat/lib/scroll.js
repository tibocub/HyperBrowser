// Where a redraw leaves the message list (test/chat.test.js): a pure decision, the page has no DOM tests.

const SLACK = 8 // px: zoom and fractional scrolling rarely land exactly on the end

// `list`: the list on screen (with data-key: its conversation), or null; `key`: the conversation being drawn;
// `toEnd`: you just sent a message. → the scrollTop to keep, or null for the end.
// shortcut: past the 300 messages shown, the oldest drops and the place shifts by it; anchor on a message if that bothers
export function keepScroll (list, key, toEnd = false) {
  if (toEnd || !list || list.dataset.key !== key) return null
  return list.scrollHeight - list.scrollTop - list.clientHeight <= SLACK ? null : list.scrollTop
}

// spec 017 R8: where the "New messages" line goes when a conversation opens with `count` unread (HyperBrowser's
// count): above the first of the last `count` messages from others (`messages` oldest first). Its index, or -1:
// none, open at the end. More unread than shown: above the first one from others shown.
export function newLine (messages, count, me) {
  let at = -1
  let n = 0
  for (let i = messages.length - 1; i >= 0 && n < count; i--) {
    if (messages[i].author !== me) { at = i; n++ }
  }
  return at
}
