import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  classifyKeyboardGeometryChange,
  computeCaretScrollDelta,
  findScrollContainer,
  getCaretBand,
  isUserScrollIntentActive,
  KEYBOARD_CLOSED_BELOW_PX,
  KEYBOARD_OPEN_ABOVE_PX,
  REVEAL_MARGIN_PX,
  USER_SCROLL_INTENT_WINDOW_MS,
} from "./mobileCaretScroll.js";

// A 400px band (a keyboard took the rest): the keyboard-open target line sits at 100.
const band = { top: 0, bottom: 400 };
const caretAt = (top: number) => ({ top, bottom: top + 20 });

describe("computeCaretScrollDelta", () => {
  describe("keyboard-open", () => {
    it("lifts a caret hidden under the keyboard to the upper quarter, not to the bottom edge", () => {
      expect(computeCaretScrollDelta(caretAt(600), band, "keyboard-open")).toBe(
        500,
      );
    });

    it("lifts a caret in the lower part of the visible band too", () => {
      expect(computeCaretScrollDelta(caretAt(350), band, "keyboard-open")).toBe(
        250,
      );
    });

    it("leaves a caret already near the top alone", () => {
      expect(computeCaretScrollDelta(caretAt(40), band, "keyboard-open")).toBe(
        0,
      );
    });

    it("brings a caret above the band down to the target line", () => {
      expect(
        computeCaretScrollDelta(caretAt(-200), band, "keyboard-open"),
      ).toBe(-300);
    });
  });

  describe("reveal", () => {
    it("does nothing for a visible caret", () => {
      expect(computeCaretScrollDelta(caretAt(350), band, "reveal")).toBe(0);
    });

    it("scrolls just enough for a caret below the band", () => {
      expect(computeCaretScrollDelta(caretAt(400), band, "reveal")).toBe(
        20 + REVEAL_MARGIN_PX,
      );
    });

    it("scrolls just enough for a caret above the band", () => {
      expect(computeCaretScrollDelta(caretAt(-30), band, "reveal")).toBe(
        -30 - REVEAL_MARGIN_PX,
      );
    });
  });

  it("ignores an empty band", () => {
    expect(
      computeCaretScrollDelta(caretAt(10), { top: 50, bottom: 50 }, "reveal"),
    ).toBe(0);
  });
});

describe("classifyKeyboardGeometryChange", () => {
  const quiet = {
    ownFocusRecent: false,
    userInputRecent: false,
    userScrollRecent: false,
  };

  it("places the caret when the keyboard opens right after the own editor gained focus", () => {
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: false,
        nextHeight: 300,
        ownFocusRecent: true,
        userInputRecent: false,
        userScrollRecent: false,
      }),
    ).toEqual({ open: true, scroll: "keyboard-open" });
  });

  it("does not place the caret for an open nobody focused (a drag swinging the viewport)", () => {
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: false,
        nextHeight: 300,
        ...quiet,
      }),
    ).toEqual({
      open: true,
      scroll: null,
    });
  });

  it("keeps an open keyboard open through a dip that stays above the closed line", () => {
    const dip = classifyKeyboardGeometryChange({
      wasOpen: true,
      nextHeight: KEYBOARD_CLOSED_BELOW_PX + 5,
      ...quiet,
    });
    expect(dip).toEqual({ open: true, scroll: null });
    // ...so the rise after it is not a fresh open, even with focus recent.
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: dip.open,
        nextHeight: 300,
        ownFocusRecent: true,
        userInputRecent: false,
        userScrollRecent: false,
      }),
    ).toEqual({ open: true, scroll: null });
  });

  it("never counts the hardware-keyboard shortcut bar as an open keyboard", () => {
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: false,
        nextHeight: 65,
        ownFocusRecent: true,
        userInputRecent: false,
        userScrollRecent: false,
      }),
    ).toEqual({ open: false, scroll: null });
    expect(KEYBOARD_OPEN_ABOVE_PX).toBeGreaterThan(65);
  });

  it("scrolls nothing while the user is scrolling, not even a focused open or a typing reveal", () => {
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: false,
        nextHeight: 300,
        ownFocusRecent: true,
        userInputRecent: true,
        userScrollRecent: true,
      }),
    ).toEqual({ open: true, scroll: null });
  });

  it("closes below the closed line", () => {
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: true,
        nextHeight: 0,
        ...quiet,
      }),
    ).toEqual({
      open: false,
      scroll: null,
    });
  });

  it("reveals on any geometry change while the user is typing", () => {
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: true,
        nextHeight: 320,
        ownFocusRecent: false,
        userInputRecent: true,
        userScrollRecent: false,
      }),
    ).toEqual({ open: true, scroll: "reveal" });
  });
});

describe("isUserScrollIntentActive", () => {
  it("holds the page for the window after a drag", () => {
    expect(
      isUserScrollIntentActive({
        now: 1500,
        lastUserScrollAt: 1000,
        lastOwnFocusAt: 0,
      }),
    ).toBe(true);
    expect(
      isUserScrollIntentActive({
        now: 1000 + USER_SCROLL_INTENT_WINDOW_MS + 1,
        lastUserScrollAt: 1000,
        lastOwnFocusAt: 0,
      }),
    ).toBe(false);
  });

  it("ends at a tap after the scroll, so the keyboard it opens still places the caret", () => {
    const userScrollRecent = isUserScrollIntentActive({
      now: 1300,
      lastUserScrollAt: 1000,
      lastOwnFocusAt: 1200,
    });
    expect(userScrollRecent).toBe(false);
    expect(
      classifyKeyboardGeometryChange({
        wasOpen: false,
        nextHeight: 300,
        ownFocusRecent: true,
        userInputRecent: false,
        userScrollRecent,
      }),
    ).toEqual({ open: true, scroll: "keyboard-open" });
  });

  it("resumes when the user drags again after the tap", () => {
    expect(
      isUserScrollIntentActive({
        now: 1500,
        lastUserScrollAt: 1400,
        lastOwnFocusAt: 1200,
      }),
    ).toBe(true);
  });
});

function rect(top: number, height: number, width = 100) {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
  } as DOMRect;
}

function stubSelection({
  bounding,
  clientRects = [],
  startContainer = document.createElement("p"),
}: {
  bounding: DOMRect;
  clientRects?: DOMRect[];
  startContainer?: Node;
}) {
  const range = {
    getBoundingClientRect: () => bounding,
    getClientRects: () => clientRects,
    startContainer,
  };
  return { rangeCount: 1, getRangeAt: () => range } as unknown as Selection;
}

describe("getCaretBand", () => {
  const zero = rect(0, 0, 0);

  it("returns the range's own rect when it has one", () => {
    expect(getCaretBand(stubSelection({ bounding: rect(200, 20) }))).toEqual({
      top: 200,
      bottom: 220,
    });
  });

  it("falls back to the first client rect for WebKit's all-zero collapsed rect", () => {
    expect(
      getCaretBand(
        stubSelection({ bounding: zero, clientRects: [rect(300, 18)] }),
      ),
    ).toEqual({
      top: 300,
      bottom: 318,
    });
  });

  it("falls back to the container element cut to one line, not its whole multi-line box", () => {
    const wrapper = document.createElement("div");
    wrapper.style.lineHeight = "24px";
    document.body.appendChild(wrapper);
    wrapper.getClientRects = () => [rect(500, 400)] as unknown as DOMRectList;
    try {
      expect(
        getCaretBand(
          stubSelection({ bounding: zero, startContainer: wrapper }),
        ),
      ).toEqual({
        top: 500,
        bottom: 524,
      });
    } finally {
      wrapper.remove();
    }
  });

  it("returns null when nothing has a box", () => {
    const detached = document.createElement("p");
    expect(
      getCaretBand(stubSelection({ bounding: zero, startContainer: detached })),
    ).toBeNull();
  });

  it("returns null without a range", () => {
    expect(getCaretBand({ rangeCount: 0 } as Selection)).toBeNull();
  });
});

describe("findScrollContainer", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function scroller(
    overflowY: string,
    scrollHeight: number,
    clientHeight: number,
  ) {
    const element = document.createElement("div");
    element.style.overflowY = overflowY;
    Object.defineProperty(element, "scrollHeight", { value: scrollHeight });
    Object.defineProperty(element, "clientHeight", { value: clientHeight });
    return element;
  }

  it("finds the nearest scrolling ancestor (a drawer pane)", () => {
    const pane = scroller("auto", 2000, 600);
    const editor = document.createElement("div");
    pane.appendChild(editor);
    document.body.appendChild(pane);
    expect(findScrollContainer(editor)).toBe(pane);
  });

  it("skips an overflow box that cannot actually scroll, within the 1px tolerance", () => {
    const almost = scroller("auto", 600.5, 600);
    const editor = document.createElement("div");
    almost.appendChild(editor);
    document.body.appendChild(almost);
    expect(findScrollContainer(editor)).toBeNull();
  });

  it("returns null (the window) when no ancestor scrolls", () => {
    const plain = scroller("visible", 2000, 600);
    const editor = document.createElement("div");
    plain.appendChild(editor);
    document.body.appendChild(plain);
    expect(findScrollContainer(editor)).toBeNull();
  });
});
