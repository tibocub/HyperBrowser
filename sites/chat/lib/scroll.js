// A pure decision, tested in test/chat.test.js: the page has no DOM tests.

const SLACK = 8 // px: zoom and fractional scrolling rarely land exactly on the end

// shortcut: past the 300 messages shown, the oldest drops and the place shifts by it; anchor on a message if that bothers
/**
 * The scroll position to keep, or null to go to the end.
 * @param {HTMLElement | null} list
 * @param {string} key the conversation shown now
 */
export function keepScroll (list, key, toEnd = false) {
  if (toEnd || !list || list.dataset.key !== key) return null
  return list.scrollHeight - list.scrollTop - list.clientHeight <= SLACK ? null : list.scrollTop
}

// More unread than shown: the line goes above the first message from others shown.
/**
 * @param {Array<{ author: string }>} messages oldest first
 * @param {number} count unread
 * @param {string} me
 */
export function newLine (messages, count, me) {
  let at = -1
  let n = 0
  for (let i = messages.length - 1; i >= 0 && n < count; i--) {
    if (messages[i].author !== me) { at = i; n++ }
  }
  return at
}
