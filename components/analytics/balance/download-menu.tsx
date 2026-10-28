"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

// Green "Скачать" dropdown of the balance pages ("Скачать все",
// "Скачать упрощенным", "Акт сверки", …).

export function BalanceDownloadMenu({ items, label = "Скачать", disabled = false, wide = false }: { items: Array<{ label: string; onClick: () => void }>; label?: string; disabled?: boolean; /** 130px button of the client balance / account debts pages. */ wide?: boolean }) {
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
        className={`flex h-[34px] items-center rounded-[5px] bg-[#71ce87] pl-[12px] text-[13px] font-semibold text-white disabled:opacity-50 ${wide ? "w-[130px]" : ""}`}
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden><path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z" /></svg>
        <span className="pl-[12px] pr-[16px]">{t(label)}</span>
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
