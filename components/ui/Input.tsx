import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react"

const base =
  "w-full rounded-xl border border-input/70 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={[base, className].join(" ")} />
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={[base, "min-h-[110px]", className].join(" ")} />
}
