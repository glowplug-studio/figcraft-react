import type { ComponentPropsWithoutRef } from "react";

export type FigcraftRootProps = ComponentPropsWithoutRef<"div">;

/** Stable host boundary for the future Figcraft UI port. */
export function FigcraftRoot({ children, ...props }: FigcraftRootProps) {
  return (
    <div data-figcraft-root="" {...props}>
      {children}
    </div>
  );
}
