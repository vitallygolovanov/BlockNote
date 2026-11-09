import { BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import { FC, useRef, useEffect } from "react";

import { useBlockNoteEditor } from "../../hooks/useBlockNoteEditor.js";
import { useExtensionState } from "../../hooks/useExtension.js";
import { FormattingToolbar } from "./FormattingToolbar.js";
import { FormattingToolbarProps } from "./FormattingToolbarProps.js";
import {
  type CaretScrollMode,
  classifyKeyboardGeometryChange,
  computeCaretScrollDelta,
  findScrollContainer,
  GEOMETRY_SETTLE_MS,
  getCaretBand,
  isUserScrollIntentActive,
  KEYBOARD_CLOSED_BELOW_PX,
  OWN_FOCUS_WINDOW_MS,
  TOOLBAR_FALLBACK_HEIGHT_PX,
  TOUCH_SLOP_PX,
  USER_INPUT_WINDOW_MS,
} from "./mobileCaretScroll.js";

/**
 * Flicker-free mobile formatting toolbar controller.
 *
 * Uses a CSS custom property (`--bn-mobile-keyboard-offset`) instead of React
 * state to position the toolbar above the virtual keyboard.  This avoids the
 * re-render storm that caused visible flickering in the previous implementation.
 *
 * Two-tier keyboard detection:
 *  1. **VirtualKeyboard API** (Chrome / Edge 94+, Samsung Internet) — provides
 *     exact keyboard geometry before the animation starts.
 *  2. **Visual Viewport API fallback** (Safari iOS 13+, Firefox Android 68+) —
 *     computes keyboard height from the difference between layout and visual
 *     viewport, with focus-based prediction for instant initial positioning.
 */
export const ExperimentalMobileFormattingToolbarController = (props: {
  formattingToolbar?: FC<FormattingToolbarProps>;
}) => {
  const divRef = useRef<HTMLDivElement>(null);
  const editor = useBlockNoteEditor<
    BlockSchema,
    InlineContentSchema,
    StyleSchema
  >();

  const show = useExtensionState(FormattingToolbarExtension, {
    editor,
  });

  useEffect(() => {
    const el = divRef.current;
    if (!el) {
      return;
    }

    const setOffset = (px: number) => {
      el.style.setProperty(
        "--bn-mobile-keyboard-offset",
        px > 0 ? `${px}px` : "0px",
      );
    };

    let scrollTimer: ReturnType<typeof setTimeout>;
    // [fork] Upstream scrolled the WINDOW on every document `selectionchange` and visual-viewport event,
    // from every mounted controller (one per editor). That yanked the page back to the caret when the
    // user scrolled away to read, when a collaborator's edit re-wrote the DOM selection, and for a
    // caret in some other editor or in a drawer that scrolls its own pane. It now scrolls only for
    // its own focused editor, in that editor's scroll container, and only when the keyboard opens in
    // answer to that editor gaining focus or the user's own input moved the caret.
    let lastUserInputAt = Number.NEGATIVE_INFINITY;
    let lastOwnFocusAt = Number.NEGATIVE_INFINITY;
    let lastUserScrollAt = Number.NEGATIVE_INFINITY;
    let keyboardOpen = false;
    let keyboardHeight = 0;
    let pendingMode: CaretScrollMode | null = null;
    // Tier 1 overlays the keyboard on the page, so the visual viewport does not shrink for it.
    let keyboardOverlaysViewport = false;

    const getEditorDom = () => {
      try {
        return editor.domElement;
      } catch {
        return undefined; // the view getter throws while unmounted
      }
    };
    const getOwnFocusedEditorDom = () => {
      try {
        return editor.isFocused() ? getEditorDom() : undefined;
      } catch {
        return undefined;
      }
    };
    const isUserInputRecent = () =>
      Date.now() - lastUserInputAt <= USER_INPUT_WINDOW_MS;

    const scrollSelectionIntoView = (mode: CaretScrollMode) => {
      const editorDom = getOwnFocusedEditorDom();
      const sel = window.getSelection();
      const vp = window.visualViewport;
      if (
        !editorDom ||
        !sel ||
        !vp ||
        !sel.anchorNode ||
        !editorDom.contains(sel.anchorNode)
      ) {
        return;
      }
      const caret = getCaretBand(sel);
      if (!caret) {
        return;
      }

      const toolbarHeight =
        el.getBoundingClientRect().height || TOOLBAR_FALLBACK_HEIGHT_PX;
      let top = vp.offsetTop;
      let bottom =
        vp.offsetTop +
        vp.height -
        toolbarHeight -
        (keyboardOverlaysViewport ? keyboardHeight : 0);
      const container = findScrollContainer(editorDom);
      if (container) {
        const containerRect = container.getBoundingClientRect();
        top = Math.max(top, containerRect.top);
        bottom = Math.min(bottom, containerRect.bottom);
      }

      const delta = computeCaretScrollDelta(caret, { top, bottom }, mode);
      if (Math.abs(delta) < 1) {
        return;
      }
      // Smooth only for the one-off keyboard placement; while typing, a smooth scroll per keystroke
      // restarts mid-animation and jitters.
      const options: ScrollToOptions = {
        top: delta,
        behavior: mode === "keyboard-open" ? "smooth" : "auto",
      };
      if (container) {
        container.scrollBy(options);
      } else {
        window.scrollBy(options);
      }
    };

    const onKeyboardGeometry = (nextHeight: number) => {
      const change = classifyKeyboardGeometryChange({
        wasOpen: keyboardOpen,
        nextHeight,
        ownFocusRecent: Date.now() - lastOwnFocusAt <= OWN_FOCUS_WINDOW_MS,
        userInputRecent: isUserInputRecent(),
        userScrollRecent: isUserScrollIntentActive({
          now: Date.now(),
          lastUserScrollAt,
          lastOwnFocusAt,
        }),
      });
      keyboardOpen = change.open;
      keyboardHeight = nextHeight;
      setOffset(nextHeight);
      if (
        change.scroll === "keyboard-open" ||
        (change.scroll && !pendingMode)
      ) {
        pendingMode = change.scroll;
      }
      if (!pendingMode) {
        return;
      }
      // A pending scroll waits for the burst to settle, so the band it measures is the final one.
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const mode = pendingMode;
        pendingMode = null;
        if (mode) {
          scrollSelectionIntoView(mode);
        }
      }, GEOMETRY_SETTLE_MS);
    };

    // Typing and arrow keys move the caret through `selectionchange`; a tap places it where the user
    // is looking, and remote edits or scrolling must not move the page.
    const onUserInput = () => {
      lastUserInputAt = Date.now();
    };
    const onSelectionChange = () => {
      if (isUserInputRecent()) {
        scrollSelectionIntoView("reveal");
      }
    };
    // A focus or a tap (`click`: a drag never fires one) in the own editor is what may open the keyboard;
    // the tap covers a keyboard re-opened over an editor that kept focus.
    const onOwnFocusIntent = (e: Event) => {
      const editorDom = getEditorDom();
      if (
        editorDom &&
        e.target instanceof Node &&
        editorDom.contains(e.target)
      ) {
        lastOwnFocusAt = Date.now();
      }
    };
    // A drag or wheel hands the page to the user: a scroll still pending (a placement waiting for the
    // keyboard to settle, a reveal) is dropped rather than fired once the drag stops.
    const onUserScrollIntent = () => {
      lastUserScrollAt = Date.now();
      pendingMode = null;
      clearTimeout(scrollTimer);
    };
    let touchStart: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (
        touchStart &&
        touch &&
        Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) >
          TOUCH_SLOP_PX
      ) {
        onUserScrollIntent();
      }
    };
    const passiveCapture: AddEventListenerOptions = {
      capture: true,
      passive: true,
    };
    document.addEventListener("keydown", onUserInput, true);
    document.addEventListener("beforeinput", onUserInput, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("focusin", onOwnFocusIntent);
    document.addEventListener("click", onOwnFocusIntent, true);
    document.addEventListener("touchstart", onTouchStart, passiveCapture);
    document.addEventListener("touchmove", onTouchMove, passiveCapture);
    document.addEventListener("wheel", onUserScrollIntent, passiveCapture);
    const removeInputListeners = () => {
      document.removeEventListener("keydown", onUserInput, true);
      document.removeEventListener("beforeinput", onUserInput, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("focusin", onOwnFocusIntent);
      document.removeEventListener("click", onOwnFocusIntent, true);
      document.removeEventListener("touchstart", onTouchStart, passiveCapture);
      document.removeEventListener("touchmove", onTouchMove, passiveCapture);
      document.removeEventListener("wheel", onUserScrollIntent, passiveCapture);
    };

    // Tier 1: VirtualKeyboard API (Chrome/Edge 94+) — exact geometry, no delay
    const vk = (navigator as any).virtualKeyboard;
    if (vk) {
      vk.overlaysContent = true;
      keyboardOverlaysViewport = true;
      const onGeometryChange = () => {
        onKeyboardGeometry(vk.boundingRect.height);
      };
      vk.addEventListener("geometrychange", onGeometryChange);
      return () => {
        vk.removeEventListener("geometrychange", onGeometryChange);
        removeInputListeners();
        clearTimeout(scrollTimer);
      };
    }

    // Tier 2: Visual Viewport API fallback (Safari iOS, Firefox Android)
    const vp = window.visualViewport;
    if (!vp) {
      return removeInputListeners;
    }

    let lastKnownKeyboardHeight = 0;

    const readKeyboardHeight = () => {
      const nextHeight =
        document.documentElement.clientHeight - vp.height - vp.offsetTop;
      if (nextHeight > KEYBOARD_CLOSED_BELOW_PX) {
        lastKnownKeyboardHeight = nextHeight;
      }
      return nextHeight;
    };
    // `resize` is the keyboard (or Safari's bars) changing size: it drives the open/closed state.
    const update = () => {
      onKeyboardGeometry(readKeyboardHeight());
    };
    // `scroll` is a pan: `offsetTop` moves, so the computed height swings with the keyboard still up. It
    // keeps the toolbar offset current but never touches the open/closed state or a pending scroll.
    const onViewportScroll = () => {
      keyboardHeight = readKeyboardHeight();
      setOffset(keyboardHeight);
    };

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA"
      ) {
        if (lastKnownKeyboardHeight > 0) {
          setOffset(lastKnownKeyboardHeight);
        }
      }
    };

    const onFocusOut = () => {
      setOffset(0);
    };

    vp.addEventListener("resize", update);
    vp.addEventListener("scroll", onViewportScroll);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      vp.removeEventListener("resize", update);
      vp.removeEventListener("scroll", onViewportScroll);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      removeInputListeners();
      clearTimeout(scrollTimer);
    };
  }, [editor]);

  if (!show && divRef.current) {
    return (
      <div
        ref={divRef}
        className="bn-mobile-formatting-toolbar"
        dangerouslySetInnerHTML={{ __html: divRef.current.innerHTML }}
      />
    );
  }

  const Component = props.formattingToolbar || FormattingToolbar;

  return (
    <div ref={divRef} className="bn-mobile-formatting-toolbar">
      <Component />
    </div>
  );
};
