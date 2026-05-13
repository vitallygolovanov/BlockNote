import {
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
  portal?: boolean;
  absoluteZIndex?: number | string;
  floatingBoundarySelector?: string;
  constrainFloatingWidthToBoundary?: boolean;
  elementProps?: HTMLAttributes<HTMLDivElement>;
};
