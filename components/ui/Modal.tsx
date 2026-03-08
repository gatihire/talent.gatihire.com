"use client"

import { useEffect, useId, useRef } from "react"
import type { PropsWithChildren } from "react"

type ModalSize = "sm" | "md" | "lg"
type ModalVariant = "dialog" | "sheet"

const getFocusable = (root: HTMLElement | null) => {
  if (!root) return [] as HTMLElement[]
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )
  )
  return nodes.filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false
    if (el instanceof HTMLButtonElement && el.disabled) return false
    const style = window.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") return false
    return true
  })
}

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  variant = "dialog",
  children,
}: PropsWithChildren<{ open: boolean; onClose: () => void; title: string; size?: ModalSize; variant?: ModalVariant }>) {
  const maxWidth = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md"
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const lastActiveRef = useRef<HTMLElement | null>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    lastActiveRef.current = (document.activeElement as HTMLElement) || null

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const focusFirst = () => {
      const panel = panelRef.current
      const focusables = getFocusable(panel)
      const preferred = focusables.find((el) => el.getAttribute("data-modal-close") === "true")
      ;(preferred || focusables[0] || panel)?.focus?.()
    }

    const t = window.setTimeout(focusFirst, 0)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab") return
      const panel = panelRef.current
      const focusables = getFocusable(panel)
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!active) return

      if (e.shiftKey) {
        if (active === first || !panel?.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = prevOverflow
      lastActiveRef.current?.focus?.()
    }
  }, [open])

  const containerAlign = variant === "sheet" ? "items-end" : "items-center"
  const panelRounding = variant === "sheet" ? "rounded-t-3xl" : "rounded-3xl"
  const panelMaxH = variant === "sheet" ? "max-h-[85vh]" : "max-h-[calc(100vh-5rem)]"

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close modal" />
      <div className={"relative mx-auto flex min-h-full justify-center p-4 " + containerAlign}>
        <div
          ref={panelRef}
          className={[
            "w-full",
            maxWidth,
            panelMaxH,
            "flex flex-col overflow-hidden border border-border/60 bg-card shadow-2xl shadow-black/10 dark:shadow-black/40",
            panelRounding
          ].join(" ")}
        >
          <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
            <div id={titleId} className="text-sm font-semibold">
              {title}
            </div>
            <button
              className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={onClose}
              aria-label="Close"
              type="button"
              data-modal-close="true"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
