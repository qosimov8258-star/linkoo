"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

export function AgentVisitsFilterPanel({
  columns,
  selected,
  onClose,
  onSave,
}: {
  columns: { key: string; label: string }[]
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
      aria-label={t("Фильтр столбцов")}
      className="absolute bottom-full right-0 z-40 mb-2 w-[300px] rounded-lg border border-slate-200 bg-white shadow-xl"
    >
      <p className="border-b border-slate-100 px-5 py-3 text-sm font-bold text-slate-700">{t("Столбцы таблицы")}</p>
      <div className="max-h-[320px] overflow-y-auto py-2">
        {columns.map((column) => (
          <label
            key={column.key}
            className="flex cursor-pointer items-center gap-3 px-5 py-2.5 text-[15px] text-slate-700 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={draft.includes(column.key)}
              onChange={() => toggle(column.key)}
              className="h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-blue"
            />
            <span className="truncate">{t(column.label)}</span>
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
