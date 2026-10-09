"use client"

import type { ReactNode } from "react"
import { Maximize2, Minimize2 } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

// "Расширенный вид" / "Обычный вид": the demo expands the toolbar + table
// into an in-page full-viewport overlay (not browser fullscreen).

export function ExpandedViewButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-2 whitespace-nowrap text-[#4f70e7]">
      {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      {expanded ? t("Обычный вид") : t("Расширенный вид")}
    </button>
  )
}

export function ExpandedOverlay({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  if (!expanded) return <>{children}</>
  return <div className="fixed inset-0 z-[90] overflow-auto bg-white">{children}</div>
}
