"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { useTheme } from "@/components/theme/ThemeProvider"

export function ThemeToggle({ size = "sm" }: { size?: "sm" | "md" }) {
  const { theme, toggleTheme } = useTheme()
  const Icon = theme === "dark" ? Sun : Moon
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme"

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className="h-10 w-10 rounded-full p-0"
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}

