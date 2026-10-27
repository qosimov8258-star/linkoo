"use client"

import type { ReactNode } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

// "Расширенный вид" / "Обычный вид": the demo expands the toolbar + table
// into an in-page full-viewport overlay (not browser fullscreen).

export function ExpandedViewButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onToggle}
      title={expanded ? t("Обычный вид") : t("Расширенный вид")}
      aria-label={expanded ? t("Обычный вид") : t("Расширенный вид")}
      className="flex h-8 w-8 items-center justify-center text-[#333]"
    >
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#333]" aria-hidden><path d={expanded ? "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" : "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"} /></svg>
    </button>
  )
}

export function ExpandedOverlay({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  if (!expanded) return <>{children}</>
  return <div className="fixed inset-0 z-[90] overflow-auto bg-white">{children}</div>
}
