/**
 * The app's name as header text — the brand in the top bar and on the Brand
 * page, instead of a logo. Set in the display face in the text colour; any
 * dot in the name takes the accent ("jimbo.ui").
 */

import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { BRAND } from "@/lib/brand.config";

/** Font size in px. */
const sizes = { sm: 22, md: 30, lg: 44 } as const;

export function HeaderTitle({ size = "sm", className }: { size?: keyof typeof sizes; className?: string }) {
  const parts = BRAND.name.split(".");
  return (
    <span className={cn("font-display leading-none tracking-[-0.02em] text-text-base", className)} style={{ fontSize: sizes[size] }}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-accent">.</span>}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
