"use client"

import { useEffect, type ReactNode, type RefObject } from "react"
import { X } from "lucide-react"
import { useLanguage } from "@/lib/i18n/language-context"
import { CHECKBOX } from "./visit-builder-view"

export type TableOptions = { formatted: boolean; totalsRight: boolean; totalsBottom: boolean; merge: boolean }
export const DEFAULT_OPTIONS: TableOptions = { formatted: true, totalsRight: true, totalsBottom: true, merge: false }
export const OPTION_LABELS: [keyof TableOptions, string][] = [
  ["formatted", "Форматированные числа"],
  ["totalsRight", "Итоги справа"],
  ["totalsBottom", "Итоги снизу"],
  ["merge", "Объединение ячеек"],
]

/** Closes the open toolbar panel on Esc or a click outside of the toolbar. */
export function usePanelDismiss(active: boolean, toolbarRef: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    const onDown = (e: MouseEvent) => { if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) close() }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onDown)
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown) }
  }, [active, toolbarRef, close])
}

export function toggleIn(list: string[], item: string) {
  return list.includes(item) ? list.filter((v) => v !== item) : [...list, item]
}

/** Side panel shared by the report builders' toolbar buttons (columns, table optimization, groupings, filters). */
export function Panel({ title, onClose, onAccept, className = "", children }: { title: string; onClose: () => void; onAccept: () => void; className?: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div role="dialog" aria-label={title} className={`absolute top-0 z-30 flex max-h-[min(640px,80vh)] w-[460px] max-w-[calc(100vw-24px)] flex-col bg-white shadow-[0_2px_14px_rgba(0,0,0,0.25)] ${className}`}>
      <header className="flex items-center justify-between px-[22px] pb-[8px] pt-[24px]">
        <h2 className="text-[19px] font-light text-[#555]">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full text-[#777] hover:text-black"><X className="h-[30px] w-[30px] rounded-full border-2 border-current p-[3px]" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-[14px]">{children}</div>
      <div className="px-[22px] pb-[20px] pt-[6px]">
        <button type="button" onClick={onAccept} className="h-[52px] w-full rounded-[3px] bg-[#5b6279] text-[15px] font-medium uppercase tracking-wide text-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] hover:brightness-110">{t("Принять")}</button>
      </div>
    </div>
  )
}

export function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-[11px] text-[15px] font-semibold">
      <input type="checkbox" checked={checked} onChange={onChange} className={CHECKBOX} />
      {children}
    </label>
  )
}

export function OptionsPanelBody({ value, onChange }: { value: TableOptions; onChange: (next: TableOptions) => void }) {
  const { t } = useLanguage()
  return (
    <>
      {OPTION_LABELS.map(([key, label]) => <CheckRow key={key} checked={value[key]} onChange={() => onChange({ ...value, [key]: !value[key] })}>{t(label)}</CheckRow>)}
      <div className="h-[24px]" />
    </>
  )
}
