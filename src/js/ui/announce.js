// @ts-check
/**
 * Screen-reader announcements via the #announcements live region.
 *
 * The blank write between messages forces assistive tech to re-read a message
 * that repeats the previous one (e.g. two consecutive "Copied" toasts).
 * Shared so export/history/main/tabs can never drift in behaviour.
 */

/** Sequence token drops stale writes when announces land within one frame. */
let announceSeq = 0;

/**
 * Window in which an identical consecutive message is considered a re-render
 * echo (the QR regenerates on every debounce tick while typing) instead of a
 * separate user-initiated event.
 */
const DEDUPE_WINDOW_MS = 1200;
let lastMessage = "";
let lastMessageAt = 0;

/** rAF is paused in background tabs, where a timeout still delivers the text. */
function scheduleWrite(fn) {
  if (typeof requestAnimationFrame === "function" && !document.hidden) {
    requestAnimationFrame(fn);
  } else {
    setTimeout(fn, 0);
  }
}

/** Test/maintenance hook: forget the last message so the next announce always writes. */
export function _resetAnnounceState() {
  lastMessage = "";
  lastMessageAt = 0;
}

/**
 * @param {string} message
 */
export function announce(message) {
  const el = document.getElementById("announcements");
  if (!el) return;
  const now = Date.now();
  // Repeated renders announce the same sentence many times per second; drop
  // those echoes so they cannot drown out other live-region output. A genuinely
  // separate event after the window (or any different message) still announces.
  if (message === lastMessage && now - lastMessageAt < DEDUPE_WINDOW_MS) return;
  lastMessage = message;
  lastMessageAt = now;
  const seq = ++announceSeq;
  el.textContent = " ";
  scheduleWrite(() => {
    if (seq === announceSeq) el.textContent = message;
  });
}
