"use client"

import { useEffect, useRef, useState } from "react"
import { Copy, Pencil, Printer, Trash2 } from "lucide-react"

import type { CashOperation } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Row "⋮" menu of the cash list (demo module 3840): Изменить (type 8 →
// acceptance edit; disabled for transfers), Дублировать (hidden for type 8,
// disabled for transfers), Печать and Удалить (disabled for the incoming
// transfer leg — delete the outgoing leg, it removes both). Write items are
// hidden for users without the manager role; deleted rows have no menu.

const ICONS: Record<string, string> = {
  "Изменить": "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  "Печать": "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z",
  "Удалить": "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
}

export function CashRowMenu({
  operation,
  canWrite,
  onEdit,
  onDuplicate,
  onPrint,
  onDelete,
}: {
  operation: CashOperation
  canWrite: boolean
  onEdit: () => void
  onDuplicate: () => void
  onPrint: () => void
  onDelete: () => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  const items: Array<{ label: string; icon: typeof Pencil; disabled: boolean; danger?: boolean; onClick: () => void }> = []
  if (canWrite) items.push({ label: "Изменить", icon: Pencil, disabled: !operation.canEdit, onClick: onEdit })
  if (canWrite && operation.type !== 8) items.push({ label: "Дублировать", icon: Copy, disabled: !operation.canDuplicate, onClick: onDuplicate })
  items.push({ label: "Печать", icon: Printer, disabled: !operation.canPrint, onClick: onPrint })
  if (canWrite) items.push({ label: "Удалить", icon: Trash2, disabled: !operation.canDelete || operation.type === 2, danger: true, onClick: onDelete })

  // The reference menu lists only Изменить / Печать / Удалить (no "Дублировать").
  const visible = items.filter((item) => item.label !== "Дублировать")
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-label={t("Действия")} className="flex h-12 w-12 items-center justify-center text-[#333]">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden>
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-[40px] z-[30] w-[168px] rounded-[6px] bg-white py-1 text-left shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className="flex h-12 w-full items-center pl-[14px] text-left text-[13px] text-[#333] hover:bg-[#eee] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-[#757575]" aria-hidden>
                <path d={ICONS[item.label] ?? ICONS["Изменить"]} />
              </svg>
              <span className="ml-[34px]">{t(item.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
