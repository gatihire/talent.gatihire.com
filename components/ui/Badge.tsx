import type { HTMLAttributes } from "react"

export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={[
        "inline-flex items-center rounded-full border border-border/60 bg-accent/60 px-2.5 py-1 text-xs font-medium text-foreground/80",
        className
      ].join(" ")}
    />
  )
}
