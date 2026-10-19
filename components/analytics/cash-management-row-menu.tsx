"use client"

import { useEffect, useRef, useState } from "react"
import { Copy, MoreVertical, Pencil, Printer, Trash2 } from "lucide-react"

import type { CashOperation } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Row "⋮" menu of the cash list (demo module 3840): Изменить (type 8 →
// acceptance edit; disabled for transfers), Дублировать (hidden for type 8,
// disabled for transfers), Печать and Удалить (disabled for the incoming
// transfer leg — delete the outgoing leg, it removes both). Write items are
// hidden for users without the manager role; deleted rows have no menu.

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

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-label={t("Действия")} className="rounded-full p-1.5 text-[#586174] hover:bg-[#e8edf3] hover:text-[#17233b]">
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[30] mt-1 w-48 overflow-hidden rounded-md border border-[#e1e5eb] bg-white py-1 text-left shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-[14px] hover:bg-[#f2f5f8] disabled:cursor-not-allowed disabled:opacity-40 ${item.danger ? "text-[#e57373]" : "text-[#17233b]"}`}
            >
              <item.icon className="h-4 w-4" /> {t(item.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
