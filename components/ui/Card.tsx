import type { HTMLAttributes, PropsWithChildren } from "react"

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["rounded-2xl border border-border/60 bg-card text-card-foreground shadow-sm shadow-black/20", className].join(" ")} />
}

export function CardHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={["px-6 pt-6", className].join(" ")} />
}

export function CardTitle({ className = "", ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 {...props} className={["text-base font-semibold", className].join(" ")} />
}

export function CardDescription({ className = "", ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} className={["mt-1 text-sm text-muted-foreground", className].join(" ")} />
}

export function CardBody({ className = "", ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div {...props} className={["px-6 pb-6", className].join(" ")} />
}
