import { EditorView } from "prosemirror-view";

export function getDraggableBlockFromElement(
  element: Element,
  view: EditorView,
) {
  while (
    element &&
    element.parentElement &&
    element.parentElement !== view.dom &&
    element.getAttribute?.("data-node-type") !== "blockContainer"
  ) {
    element = element.parentElement;
  }
  if (element.getAttribute?.("data-node-type") !== "blockContainer") {
    return undefined;
  }
  return { node: element as HTMLElement, id: element.getAttribute("data-id")! };
}

export function handleCustomDragHandleCase(element: Element): { node: HTMLElement; id: string } | undefined {
  const isDragHandle = element.getAttribute?.("data-card-proxy-drag-handle") === "true";
  const id = element.getAttribute?.("data-proxy-block-id");
  if (!isDragHandle || !id) {
    return undefined;
  }

  console.log(`CUSTOM DH TEST: HIT CUSTOM DRAG HANDLE CASE. id: ${id} Element:`, element);
  return { node: element as HTMLElement, id, _isCustomDragHandle: true } as unknown as { node: HTMLElement; id: string };
}