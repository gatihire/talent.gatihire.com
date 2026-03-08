"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = "truckinzy:theme"

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light")

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      const initial: Theme = stored === "dark" ? "dark" : "light"
      setThemeState(initial)
      applyTheme(initial)
    } catch {
      applyTheme("light")
    }
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((curr) => {
      const next: Theme = curr === "dark" ? "light" : "dark"
      applyTheme(next)
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
      }
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [setTheme, theme, toggleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const v = useContext(ThemeContext)
  if (!v) throw new Error("useTheme must be used within ThemeProvider")
  return v
}
