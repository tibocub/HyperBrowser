// Node, Bare and browsers all take null here: timers are cleared before they may be set.
declare function clearTimeout (timeout: ReturnType<typeof setTimeout> | null | undefined): void
declare function clearInterval (timeout: ReturnType<typeof setInterval> | null | undefined): void
