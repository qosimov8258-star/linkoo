"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { DialogShell } from "./order-detail"

const RADIO_RING = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const RADIO_DOT = "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z"

export const SERIES_STORAGE_KEY = "linko-order-series-mode"
export type SeriesMode = "fifo" | "lifo" | "from_market"

/** "АВТО РАСПРЕДЕЛЕНИЕ ПО СЕРИЯМ": the reference asks how the expiry date is distributed (FIFO / LIFO / by the client's type). */
export function SeriesDialog({ onClose, onSave }: { onClose: () => void; onSave: (mode: SeriesMode) => void }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<SeriesMode>(() => {
    try {
      const saved = window.localStorage.getItem(SERIES_STORAGE_KEY)
      if (saved === "fifo" || saved === "lifo" || saved === "from_market") return saved
    } catch {}
    return "fifo"
  })
  const options: { value: SeriesMode; label: string }[] = [
    { value: "fifo", label: "FIFO" },
    { value: "lifo", label: "LIFO" },
    { value: "from_market", label: t("По типу указанному у клиента") },
  ]
  return (
    <DialogShell title={t("Авто распределение по сериям")} height={286} closeRight={15} onClose={onClose} action={t("Сохранить")} onAction={() => onSave(mode)}>
      <p className="mt-[19.5px] text-[14px] font-semibold leading-[17.5px] text-[#333]">{t("Распределит срок годности по:")}</p>
      <div className="mt-[15px]">
        {options.map((option) => (
          <label key={option.value} className="relative block h-[34px] cursor-pointer">
            <input type="radio" name="series-mode" checked={mode === option.value} onChange={() => setMode(option.value)} className="sr-only" />
            <svg viewBox="0 0 24 24" className="absolute left-0 top-0 h-6 w-6" aria-hidden>
              <path d={RADIO_RING} fill="#333" />
              {mode === option.value && <path d={RADIO_DOT} fill="#5d6474" />}
            </svg>
            <span className="absolute left-[40px] top-0 h-6 text-[13px] font-normal leading-6 text-black">{option.label}</span>
          </label>
        ))}
      </div>
    </DialogShell>
  )
}

/** "НУМЕРАЦИЯ СЧЕТ ФАКТУРЫ": numbers the ticked orders' invoices consecutively starting from the typed number. */
export function InvoiceNumberDialog({ onClose, onSave }: { onClose: () => void; onSave: (start: number) => void }) {
  const { t } = useLanguage()
  const [value, setValue] = useState("")
  const start = Number(value)
  const valid = value.trim() !== "" && Number.isInteger(start) && start >= 0
  return (
    <DialogShell title={t("Нумерация счет фактуры")} height={197} onClose={onClose} action={t("Сохранить")} disabled={!valid} onAction={() => onSave(start)}>
      <div className="relative mt-[26px] h-[37px]">
        <span className={`pointer-events-none absolute left-0 whitespace-nowrap font-semibold text-black ${value ? "top-0 text-[9.75px] leading-[12.2px]" : "top-[12.5px] text-[13px] leading-[18px]"}`}>
          {t("Номер счет фактуры начать с")}
          <span className="text-[#e57373]"> *</span>
        </span>
        <input
          value={value}
          inputMode="numeric"
          onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
          className="absolute inset-x-0 top-0 h-[45px] bg-transparent pt-[12px] text-[13px] font-semibold text-black outline-none"
        />
        <hr className="absolute inset-x-0 bottom-0 m-0 h-px border-0 bg-[#e0e0e0]" />
      </div>
    </DialogShell>
  )
}

/** Menu under the "Отправить EDO" toolbar button. */
export function EdoMenu({ onClose, onPick }: { onClose: () => void; onPick: (action: "shipment" | "invoice") => void }) {
  const { t } = useLanguage()
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-[1px] top-[49px] z-50 w-[178px] rounded-[2px] bg-white py-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        {[
          { key: "shipment" as const, label: t("Создать отгрузку") },
          { key: "invoice" as const, label: t("Создать счёт-фактур") },
        ].map((item) => (
          <button key={item.key} type="button" onClick={() => onPick(item.key)} className="flex h-12 w-full items-center pl-[19px] text-left text-[13px] text-[#333] hover:bg-[#f2f5f8]">
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}

/**
 * Mirrors a set of flags into the query string the way the reference does (`?openMultiEdit=true&select=1594&showCheckboxes=true`,
 * keys sorted). The first run is skipped so deep-link params survive until the page has read them.
 */
export function useUrlParams(params: Record<string, string | null>, drop: string[] = []) {
  const ready = useRef(false)
  const key = JSON.stringify(params) + drop.join(",")
  useEffect(() => {
    if (!ready.current) {
      ready.current = true
      return
    }
    const url = new URL(window.location.href)
    for (const name of drop) url.searchParams.delete(name)
    for (const [name, value] of Object.entries(params)) {
      if (value) url.searchParams.set(name, value)
      else url.searchParams.delete(name)
    }
    url.searchParams.sort()
    const next = url.pathname + url.search
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
