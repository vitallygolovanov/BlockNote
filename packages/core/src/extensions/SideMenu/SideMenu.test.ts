import { describe, expect, it, vi } from "vite-plus/test";

import { SideMenuView } from "./SideMenu.js";

/**
 * @vitest-environment jsdom
 */

const createSideMenuView = () => {
  document.body.innerHTML = "";

  const outsideTarget = document.createElement("div");
  document.body.append(outsideTarget);

  const embeddedContainer = document.createElement("div");
  embeddedContainer.setAttribute("data-embedded-editor", "true");
  const editorWrapper = document.createElement("div");
  const editorDom = document.createElement("div");
  editorWrapper.append(editorDom);
  embeddedContainer.append(editorWrapper);
  document.body.append(embeddedContainer);

  const emitUpdate = vi.fn();
  const editor = {
    getBlock: vi.fn(),
    isEditable: true,
    isFocused: vi.fn(() => false),
  } as any;
  const pmView = {
    dom: editorDom,
    root: document,
  } as any;

  const sideMenuView = new SideMenuView(editor, pmView, emitUpdate) as any;
  sideMenuView.state = {
    block: { id: "block-1" },
    referencePos: new DOMRect(),
    show: true,
  };

  return {
    editorDom,
    emitUpdate,
    outsideTarget,
    sideMenuView,
  };
};

describe("SideMenu embed hover gate", () => {
  it("skips geometry reads for irrelevant embed hover targets", () => {
    const { editorDom, emitUpdate, outsideTarget, sideMenuView } =
      createSideMenuView();
    const editorBoundsSpy = vi
      .spyOn(editorDom, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 300, 200));

    sideMenuView.onMouseMove({
      clientX: 120,
      clientY: 80,
      target: outsideTarget,
    } as unknown as MouseEvent);

    expect(editorBoundsSpy).not.toHaveBeenCalled();
    expect(sideMenuView.state.show).toBe(false);
    expect(emitUpdate).toHaveBeenCalledOnce();
  });

  it("does not re-enter hover tracking after an irrelevant embed hover", () => {
    const { outsideTarget, sideMenuView } = createSideMenuView();
    const findClosestEditorElement = vi.fn();

    sideMenuView.embedHoverTarget = outsideTarget;
    sideMenuView.mousePos = { x: 120, y: 80 };
    sideMenuView.findClosestEditorElement = findClosestEditorElement;

    sideMenuView.updateStateFromMousePos();

    expect(findClosestEditorElement).not.toHaveBeenCalled();
    expect(sideMenuView.state.show).toBe(false);
  });
});