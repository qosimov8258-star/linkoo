"use client"

import { useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

const CHECK_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECK_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** Linko's table-settings icon (format_align_center), the button that opens «Настройка таблицы». */
export const TABLE_SETTINGS_ICON = "M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z"

/**
 * Linko's «Настройка таблицы»: a right drawer with one checkbox per column and «Сохранить» (Клиенты, Эффективность
 * оборудования). The columns change only on save; a click on the dimmed page closes it without saving.
 */
export function TableColumnsDrawer<Key extends string>({
  columns,
  visible,
  onSave,
  onClose,
}: {
  columns: ReadonlyArray<{ key: Key; title: string }>
  visible: Record<Key, boolean>
  onSave: (visible: Record<Key, boolean>) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(visible)
  return (
    <div className="fixed inset-0 z-[1200] bg-black/[0.54]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="fixed right-0 top-0 flex h-full w-[340px] max-w-full flex-col bg-white text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <header className="flex h-[58px] shrink-0 items-center border-b border-[#efefef] pl-[30px]">
          <h2 className="text-[15px] font-medium">{t("Настройка таблицы")}</h2>
        </header>
        <ul className="min-h-0 flex-1 overflow-y-auto pt-[14px]">
          {columns.map((column) => (
            <li key={column.key} className="h-[35px]">
              <button type="button" onClick={() => setDraft((current) => ({ ...current, [column.key]: !current[column.key] }))} className="flex h-[35px] w-full items-center gap-[10px] pl-[30px] text-left font-semibold">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={draft[column.key] ? CHECK_ON : CHECK_EMPTY} /></svg>
                {t(column.title)}
              </button>
            </li>
          ))}
        </ul>
        <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] pr-[26px]">
          <button type="button" onClick={() => onSave(draft)} className="font-semibold uppercase text-[#0a9ddb]">{t("Сохранить")}</button>
        </footer>
      </aside>
    </div>
  )
}
