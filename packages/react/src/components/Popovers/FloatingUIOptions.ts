import {
  FloatingFocusManagerProps,
  UseDismissProps,
  UseFloatingOptions,
  UseHoverProps,
  UseTransitionStatusProps,
  UseTransitionStylesProps,
} from "@floating-ui/react";
import { HTMLAttributes } from "react";

export type FloatingUIOptions = {
  useFloatingOptions?: UseFloatingOptions;
  useTransitionStylesProps?: UseTransitionStylesProps;
  useTransitionStatusProps?: UseTransitionStatusProps;
  useDismissProps?: UseDismissProps;
  useHoverProps?: UseHoverProps;
  // Fork delta (8863a6d1): explicit z-index escape hatch for Blackboard embed
  // popovers that must pin to a specific layer band instead of the computed
  // `--bn-ui-base-z-index` value.
  // NOTE: the fork's `portal?: boolean` field was dropped in the 0.51.x upgrade
  // because upstream's GenericPopover now always portals via `portalElement`
  // (pass `portalElement={null}` to portal into `document.body` — the former
  // `portal={true}` behavior).
  absoluteZIndex?: number | string;
  elementProps?: HTMLAttributes<HTMLDivElement>;
  /**
   * Props to pass to the `FloatingFocusManager` component.
   */
  focusManagerProps?: Omit<FloatingFocusManagerProps, "context" | "children">;
};
