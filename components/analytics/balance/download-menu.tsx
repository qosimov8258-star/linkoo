"use client"

import { useEffect, useRef, useState } from "react"
import { BarChart } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

// Green "Скачать" dropdown of the balance pages ("Скачать все",
// "Скачать упрощенным", "Акт сверки", …).

export function BalanceDownloadMenu({ items, label = "Скачать", disabled = false }: { items: Array<{ label: string; onClick: () => void }>; label?: string; disabled?: boolean }) {
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
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-[34px] items-center gap-2 rounded-[3px] bg-[#71ce87] pl-2 pr-4 text-[13px] font-semibold text-white disabled:opacity-50"
      >
        <BarChart className="h-5 w-5" /> {t(label)}
      </button>
      {open && (
        <div className="absolute right-0 z-[60] mt-1 min-w-[220px] overflow-hidden rounded-md border border-[#e1e5eb] bg-white shadow-lg">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className="block w-full px-4 py-2.5 text-left text-[#17233b] hover:bg-[#f2f5f8]"
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
