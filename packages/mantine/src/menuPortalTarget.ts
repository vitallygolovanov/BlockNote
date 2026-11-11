import { createContext, useContext } from "react";

/**
 * [fork] Where toolbar menus and popovers render. Undefined keeps upstream's behaviour: inline, next
 * to their trigger. Inline breaks inside the docked mobile bar: the toolbar scrolls sideways, and
 * floating-ui treats a scrolling ancestor as the menu's boundary, so against a 35px-tall bar a menu
 * can neither flip above it nor fit below it. A host that docks the toolbar provides an element (or a
 * selector for one) outside the toolbar's scroll container.
 */
export const MenuPortalTargetContext = createContext<
  HTMLElement | string | undefined
>(undefined);

export function useMenuPortalProps() {
  const target = useContext(MenuPortalTargetContext);
  return {
    withinPortal: target !== undefined,
    portalProps: target !== undefined ? { target } : undefined,
  };
}
