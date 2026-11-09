/**
 * [fork] Caret-into-view math for the docked mobile formatting toolbar, kept pure for tests.
 * Coordinates are client (layout-viewport) pixels, the space `getBoundingClientRect` reports.
 */

export type VerticalBand = { top: number; bottom: number };

/** Where a caret revealed by the keyboard opening lands, as a fraction of the visible band. */
export const KEYBOARD_OPEN_CARET_FRACTION = 0.25;
/** Breathing room kept between the caret and a band edge while typing. */
export const REVEAL_MARGIN_PX = 16;
/**
 * Keyboard hysteresis. It counts as open above the upper line and as closed below the lower one; in
 * between it keeps its state. iPad Safari's computed height swings while the user drags the page, and the
 * hardware-keyboard shortcut bar (~55-70px) sits right at a single line, so one threshold read every
 * swing across it as a fresh keyboard open.
 */
export const KEYBOARD_OPEN_ABOVE_PX = 120;
export const KEYBOARD_CLOSED_BELOW_PX = 50;
/** A keyboard open places the caret only if the own editor gained focus this recently (a tap does; a drag never). */
export const OWN_FOCUS_WINDOW_MS = 1500;
/** Caret moves within this long after the user's own key or input are followed; anything else is not. */
export const USER_INPUT_WINDOW_MS = 500;
/**
 * After a touch drag or wheel, the page is the user's for this long: no geometry change scrolls it.
 * Covers touch momentum, which fires no input events while it coasts (the app's scroll restore uses the
 * same window).
 */
export const USER_SCROLL_INTENT_WINDOW_MS = 2000;
/** A touch that moved less than this is a tap's jitter, not a drag. */
export const TOUCH_SLOP_PX = 10;
/** Geometry events come in bursts while the keyboard animates; act once it settles. */
export const GEOMETRY_SETTLE_MS = 100;
/** The docked toolbar's height before it has rendered. */
export const TOOLBAR_FALLBACK_HEIGHT_PX = 44;
/** Line height for the caret fallback when the element's computed one is `normal`. */
const FALLBACK_LINE_HEIGHT_PX = 24;

export type CaretScrollMode = "keyboard-open" | "reveal";

/**
 * Whether the page is still the user's after a drag or wheel. A later focus or tap in the own editor ends
 * it: "swipe to the paragraph, then tap it" is how people pick where to type, and that tap (which also
 * stops iOS momentum) must still get its keyboard-open placement.
 */
export function isUserScrollIntentActive({
  now,
  lastUserScrollAt,
  lastOwnFocusAt,
}: {
  now: number;
  lastUserScrollAt: number;
  lastOwnFocusAt: number;
}): boolean {
  return (
    lastUserScrollAt > lastOwnFocusAt &&
    now - lastUserScrollAt <= USER_SCROLL_INTENT_WINDOW_MS
  );
}

/**
 * What a keyboard-geometry change means for the caret:
 * - `keyboard-open`: the keyboard opened in answer to the own editor gaining focus. Place the caret.
 * - `reveal`: the user is typing. Keep the caret visible.
 * - `null`: anything else (a drag, Safari's bars resizing, the keyboard closing), and anything at all
 *   while the user is scrolling. Only the toolbar moves. Following these snapped the page back to the
 *   caret mid-scroll.
 *
 * Feed it keyboard geometry only (`resize`, `geometrychange`). A visual-viewport `scroll` is a pan: it
 * moves `offsetTop` and so the computed height, and would fake a close and a re-open.
 */
export function classifyKeyboardGeometryChange({
  wasOpen,
  nextHeight,
  ownFocusRecent,
  userInputRecent,
  userScrollRecent,
}: {
  wasOpen: boolean;
  nextHeight: number;
  ownFocusRecent: boolean;
  userInputRecent: boolean;
  userScrollRecent: boolean;
}): { open: boolean; scroll: CaretScrollMode | null } {
  const open = wasOpen
    ? nextHeight >= KEYBOARD_CLOSED_BELOW_PX
    : nextHeight > KEYBOARD_OPEN_ABOVE_PX;
  if (userScrollRecent) {
    return { open, scroll: null };
  }
  if (open && !wasOpen && ownFocusRecent) {
    return { open, scroll: "keyboard-open" };
  }
  return { open, scroll: userInputRecent ? "reveal" : null };
}

/**
 * - `keyboard-open`: the keyboard just covered the lower part of the screen. A caret in the lower part
 *   of what is left moves up to the upper quarter, where people expect the line they type on; one
 *   already above that line stays put.
 * - `reveal`: typing moved the caret; scroll only as far as needed to keep it visible.
 */
export function computeCaretScrollDelta(
  caret: VerticalBand,
  band: VerticalBand,
  mode: CaretScrollMode,
): number {
  const height = band.bottom - band.top;
  if (height <= 0) {
    return 0;
  }

  if (mode === "keyboard-open") {
    const target = band.top + height * KEYBOARD_OPEN_CARET_FRACTION;
    if (caret.top >= band.top && caret.top <= target) {
      return 0;
    }
    return caret.top - target;
  }

  if (caret.bottom > band.bottom) {
    return caret.bottom - band.bottom + REVEAL_MARGIN_PX;
  }
  if (caret.top < band.top) {
    return caret.top - band.top - REVEAL_MARGIN_PX;
  }
  return 0;
}

function isEmptyRect(rect: DOMRect) {
  return (
    rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0
  );
}

function lineHeightOf(element: Element) {
  const style = getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    return lineHeight;
  }
  const fontSize = Number.parseFloat(style.fontSize);
  return Number.isFinite(fontSize) && fontSize > 0
    ? fontSize * 1.2
    : FALLBACK_LINE_HEIGHT_PX;
}

/**
 * The caret's box. WebKit reports an all-zero rect for a collapsed range at some element boundaries
 * (an empty paragraph), which read as "above the viewport" and scrolled the page to the top. The
 * element fallback is cut to its first line: when the container is a block wrapper, its full box spans
 * many lines and `reveal` would over-scroll by all of them.
 */
export function getCaretBand(selection: Selection): VerticalBand | null {
  if (selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!isEmptyRect(rect)) {
    return { top: rect.top, bottom: rect.bottom };
  }
  const first = range.getClientRects()[0];
  if (first && !isEmptyRect(first)) {
    return { top: first.top, bottom: first.bottom };
  }
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) {
    return null;
  }
  const elementRect =
    element.getClientRects()[0] ?? element.getBoundingClientRect();
  if (isEmptyRect(elementRect)) {
    return null;
  }
  return {
    top: elementRect.top,
    bottom: Math.min(
      elementRect.bottom,
      elementRect.top + lineHeightOf(element),
    ),
  };
}

/**
 * The nearest ancestor that scrolls vertically (a drawer pane), or `null` for the window. Same
 * predicate as the app's `isElementScrollable` (scroll-container.ts), which the fork cannot import: the
 * `+ 1` absorbs fractional sizes, so a box 0.5px taller than its client area does not count.
 */
export function findScrollContainer(element: Element): HTMLElement | null {
  const root = element.ownerDocument.scrollingElement;
  for (
    let current = element.parentElement;
    current && current !== root && current !== element.ownerDocument.body;
    current = current.parentElement
  ) {
    const overflowY = getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight + 1
    ) {
      return current;
    }
  }
  return null;
}
