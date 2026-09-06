"use client"

import { useEffect, useRef, useState } from "react"
import { HOME_WIDGETS } from "@/lib/dashboard-home-widgets"
import { useLanguage } from "@/lib/i18n/language-context"

export function WidgetsPanel({
  selected,
  onClose,
  onSave,
}: {
  selected: string[]
  onClose: () => void
  onSave: (keys: string[]) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<string[]>(selected)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  function toggle(key: string) {
    setDraft((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]))
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("Виджеты")}
      className="absolute right-0 top-full z-40 mt-2 w-[300px] rounded-lg border border-slate-200 bg-white shadow-xl"
    >
      <div className="max-h-[420px] overflow-y-auto py-2">
        {HOME_WIDGETS.map((widget) => (
          <label
            key={widget.key}
            className="flex cursor-pointer items-center gap-3 px-5 py-2.5 text-[15px] text-slate-700 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={draft.includes(widget.key)}
              onChange={() => toggle(widget.key)}
              className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-blue"
            />
            <span className="truncate">{t(widget.label)}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end border-t border-slate-100 px-5 py-3">
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="text-sm font-bold uppercase tracking-wide text-sky-500 transition-colors hover:text-sky-600"
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  )
}
