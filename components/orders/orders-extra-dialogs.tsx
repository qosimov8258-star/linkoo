"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

import { DialogShell } from "./order-detail"

const RADIO_RING = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const RADIO_DOT = "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z"

export type SeriesMode = "fifo" | "lifo" | "from_market"

/** Material av_timer: Linko's icon of «Авто распределение по сериям» (orders and returns lists, the return card). */
export const AV_TIMER =
  "M11 17c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1zm0-14v4h2V5.08c3.39.49 6 3.39 6 6.92 0 3.87-3.13 7-7 7s-7-3.13-7-7c0-1.68.59-3.22 1.58-4.42L12 13l1.41-1.41-6.8-6.8v.02C4.42 6.45 3 9.05 3 12c0 4.97 4.02 9 9 9 4.97 0 9-4.03 9-9s-4.03-9-9-9h-1zm7 9c0-.55-.45-1-1-1s-1 .45-1 1 .45 1 1 1 1-.45 1-1zM6 12c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1z"

/**
 * "АВТО РАСПРЕДЕЛЕНИЕ ПО СЕРИЯМ": the reference asks how the expiry date is distributed (FIFO / LIFO / by the client's
 * type). FIFO is chosen on every open, nothing is remembered. `ids` = the documents it is for (Linko's `select`): an
 * empty list shows only the grey line «Выберите заказ из списка» and no button; left out, the caller checked it.
 * Like Linko, only ✕ closes it (Escape does not).
 */
export function SeriesDialog({
  ids,
  onClose,
  onSave,
  busy,
  error,
}: {
  ids?: ReadonlyArray<number | string>
  onClose: () => void
  onSave: (mode: SeriesMode) => void
  busy?: boolean
  error?: string
}) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<SeriesMode>("fifo")
  const options: { value: SeriesMode; label: string }[] = [
    { value: "fifo", label: "FIFO" },
    { value: "lifo", label: "LIFO" },
    { value: "from_market", label: t("По типу указанному у клиента") },
  ]
  if (ids && !ids.length) {
    return (
      <SeriesShell onClose={onClose}>
        <p className="h-[56px] bg-[#f1f5f8] px-[30px] text-[13px] font-semibold leading-[56px] text-[#333]">{t("Выберите заказ из списка")}</p>
      </SeriesShell>
    )
  }
  return (
    <SeriesShell onClose={onClose} height={286}>
      <span className="absolute inset-x-0 top-[59.3px] h-px bg-[#efefef]" />
      <span className="absolute inset-x-0 bottom-[56px] h-px bg-[#efefef]" />
      <div className="px-[30px] pb-[56px]">
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
      </div>
      {error && <span className="absolute bottom-[19px] left-[30px] right-[120px] text-[#e57373]">{error}</span>}
      <button type="button" disabled={busy} onClick={() => onSave(mode)} className="absolute bottom-[10px] right-[10px] h-9 min-w-[88px] cursor-pointer text-center disabled:cursor-default disabled:opacity-40">
        <span className="inline-block px-[16px] py-[9px] text-[13px] font-semibold uppercase leading-[18px] text-[#129fdd]">{t("Сохранить")}</span>
      </button>
    </SeriesShell>
  )
}

/** The 500px frame of the auto distribution (title, ✕ in #666 15px from the right), centred over a dark overlay. */
function SeriesShell({ onClose, height, children }: { onClose: () => void; height?: number; children: ReactNode }) {
  const { t } = useLanguage()
  return createPortal(
    <div data-order-overlay className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]">
      <div role="dialog" aria-modal="true" aria-label={t("Авто распределение по сериям")} style={{ minHeight: height }} className="relative w-[500px] max-w-full bg-white pt-[60px] shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{t("Авто распределение по сериям")}</span>
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
        {children}
      </div>
    </div>,
    document.body,
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
    // null drops a key; an empty value stays (Linko's «Все» tab is ?status=).
    for (const [name, value] of Object.entries(params)) {
      if (value !== null) url.searchParams.set(name, value)
      else url.searchParams.delete(name)
    }
    url.searchParams.sort()
    const next = url.pathname + url.search
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
