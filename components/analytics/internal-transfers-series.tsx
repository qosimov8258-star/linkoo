"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { mutationError } from "@/components/analytics/cash-management-shared"
import { MaterialAlert } from "@/components/analytics/cash-material"
import { useLanguage } from "@/lib/i18n/language-context"
import type { TransferSeriesAutoType, TransferSeriesOption } from "@/lib/internal-transfers-types"

// Series (Серия) pieces of "Передачи между складами": the «Авто распределение по сериям» dialog of the
// card (Linko's module 4654: FIFO / LIFO, FIFO on every open, «Сохранить»), and the search fields of
// the transfer form (product «Наименование», «Серия» from GET /api/internal-transfers/series).

/** Material av_timer: «Авто распределение по сериям». */
export const ICON_AV_TIMER =
  "M11 17c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1zm0-14v4h2V5.08c3.39.49 6 3.39 6 6.92 0 3.87-3.13 7-7 7s-7-3.13-7-7c0-1.68.59-3.22 1.58-4.42L12 13l1.41-1.41-6.8-6.8v.02C4.42 6.45 3 9.05 3 12c0 4.97 4.02 9 9 9 4.97 0 9-4.03 9-9s-4.03-9-9-9h-1zm7 9c0-.55-.45-1-1-1s-1 .45-1 1 .45 1 1 1 1-.45 1-1zM6 12c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1z"
/** Material cached: «Отменить автораспределение». */
export const ICON_CACHED =
  "M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"

const RADIO_RING = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"
const RADIO_DOT = "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** A small Material spinner (the reference's CircularProgress). */
export function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 50 50" style={{ width: size, height: size }} className={`animate-spin ${className}`} aria-hidden>
      <circle cx="25" cy="25" r="20" fill="none" stroke="rgb(0, 188, 212)" strokeWidth="4" strokeLinecap="round" strokeDasharray="90 150" />
    </svg>
  )
}

const noop = () => () => {}
/** False while rendering on the server and hydrating: a dialog opened from the URL portals only in the browser. */
const useInBrowser = () => useSyncExternalStore(noop, () => true, () => false)

/** «АВТО РАСПРЕДЕЛЕНИЕ ПО СЕРИЯМ» of a transfer: FIFO (default, never remembered) or LIFO → POST
 * /api/internal-transfers/series/auto. `onSaved` runs after the server has distributed the series; a refusal shows
 * in the error dialog. */
export function TransferAutoSeriesDialog({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<TransferSeriesAutoType>("fifo")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const inBrowser = useInBrowser()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  const save = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate<{ transfers: number; lines: number }>("POST", "/api/internal-transfers/series/auto", { autoType: mode, ids: [id] })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved()
  }
  const options: Array<{ value: TransferSeriesAutoType; label: string }> = [
    { value: "fifo", label: "FIFO" },
    { value: "lifo", label: "LIFO" },
  ]
  if (!inBrowser) return null
  return createPortal(
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Авто распределение по сериям")}
        onMouseDown={(event) => event.stopPropagation()}
        className="relative min-h-[252px] w-[500px] max-w-full bg-white pt-[60px] shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]"
      >
        <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{t("Авто распределение по сериям")}</span>
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
            <path d={CLOSE} />
          </svg>
        </button>
        <span className="absolute inset-x-0 top-[59.3px] h-px bg-[#efefef]" />
        <span className="absolute inset-x-0 bottom-[56px] h-px bg-[#efefef]" />
        <div className="px-[30px] pb-[56px]">
          <p className="mt-[19.5px] text-[14px] font-semibold leading-[17.5px] text-[#333]">{t("Распределит срок годности по:")}</p>
          <div className="mt-[15px]">
            {options.map((option) => (
              <label key={option.value} className="relative block h-[34px] cursor-pointer">
                <input type="radio" name="transfer-series-mode" checked={mode === option.value} onChange={() => setMode(option.value)} className="sr-only" />
                <svg viewBox="0 0 24 24" className="absolute left-0 top-0 h-6 w-6" aria-hidden>
                  <path d={RADIO_RING} fill="#333" />
                  {mode === option.value && <path d={RADIO_DOT} fill="#5d6474" />}
                </svg>
                <span className="absolute left-[40px] top-0 h-6 text-[13px] font-normal leading-6 text-black">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => void save()} className="absolute bottom-[10px] right-[10px] h-9 min-w-[88px] cursor-pointer text-center disabled:cursor-default disabled:opacity-40">
          <span className="inline-block px-[16px] py-[9px] text-[13px] font-semibold uppercase leading-[18px] text-[#129fdd]">{t("Сохранить")}</span>
        </button>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Spinner size={40} />
          </div>
        )}
      </div>
      {/* A refusal opens the error dialog, as the reference's openErrorAction. */}
      {error && (
        <div onMouseDown={(event) => event.stopPropagation()}>
          <MaterialAlert message={error} onClose={() => setError("")} />
        </div>
      )}
    </div>,
    document.body,
  )
}

export type SearchOption = { value: string; text: string; node?: ReactNode }

/** A Material search select of the transfer form's lines (the reference's react-select field): a bold label at rest
 * (small above a chosen value), the chosen text, ▾, and a list filtered by what is typed. */
export function SearchSelect({
  label,
  value,
  valueText,
  options,
  onChange,
  loading,
  className = "",
  menuWidth,
  autoFocus,
  boldOptions,
}: {
  label: string
  value: string
  /** Text of the chosen value (shown when the list does not hold it). */
  valueText?: string
  options: SearchOption[]
  onChange: (value: string) => void
  loading?: boolean
  className?: string
  /** Width of the list (default: the field's). */
  menuWidth?: number
  autoFocus?: boolean
  /** Options in 600 (the reference's series picker). */
  boldOptions?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const shown = value ? (options.find((option) => option.value === value)?.text ?? valueText ?? value) : ""
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (term ? options.filter((option) => option.text.toLowerCase().includes(term)) : options).slice(0, 200)
  }, [options, query])
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])
  const close = () => {
    setOpen(false)
    setQuery("")
  }
  const floating = Boolean(shown) || open
  return (
    <div className={`relative mt-[7px] h-[45px] text-[13px] ${className}`}>
      <span className={`pointer-events-none absolute left-0 whitespace-nowrap font-semibold text-black transition-all ${floating ? "top-[2px] text-[9.75px] leading-[12px]" : "bottom-[14px] text-[13px] leading-[18px]"}`}>{label}</span>
      {!open && shown && <span className="pointer-events-none absolute bottom-[13px] left-0 right-[26px] truncate font-semibold leading-[18px] text-[#333]">{shown}</span>}
      <input
        ref={inputRef}
        value={open ? query : ""}
        aria-label={label}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation()
            close()
            inputRef.current?.blur()
          }
          if (event.key === "Enter" && open && filtered.length) {
            event.preventDefault()
            event.stopPropagation()
            onChange(filtered[0].value)
            close()
            inputRef.current?.blur()
          }
        }}
        className="absolute bottom-[9px] left-0 right-[26px] h-[24px] bg-transparent font-semibold text-[#333] outline-none"
      />
      <svg viewBox="0 0 10 5" className="pointer-events-none absolute bottom-[19px] right-[9px] h-[5px] w-[10px]" aria-hidden>
        <path d={open ? "M0 5h10L5 0z" : "M0 0h10L5 5z"} fill="#999" fillOpacity={0.7} />
      </svg>
      <span className="absolute inset-x-0 bottom-[8px] h-px bg-[#e0e0e0]" />
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={close} />
          <div style={menuWidth ? { width: menuWidth } : undefined} className="absolute left-0 top-[38px] z-50 max-h-[240px] min-w-full overflow-y-auto bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            {loading ? (
              <div className="flex h-10 items-center justify-center">
                <Spinner />
              </div>
            ) : filtered.length ? (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    close()
                  }}
                  className={`block min-h-8 w-full truncate px-[10px] py-[7px] text-left text-[13px] leading-[18px] text-[#333] hover:bg-[#e9f0fb] ${boldOptions ? "font-semibold" : ""} ${option.value === value || (!value && index === 0) ? "bg-[#e9f0fb]" : ""}`}
                >
                  {option.node ?? option.text}
                </button>
              ))
            ) : (
              <div className="px-[10px] py-[7px] text-[#999]">{t("Не найдено")}</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** «Серия» of a product: GET /api/internal-transfers/series?product=. */
export function SeriesSelect({ productId, value, valueText, onChange, className }: { productId: number | null; value: number | null; valueText?: string; onChange: (series: TransferSeriesOption | null) => void; className?: string }) {
  const { t } = useLanguage()
  const series = useCashJson<{ count: number; results: TransferSeriesOption[] }>(productId ? `/api/internal-transfers/series?product=${productId}&pageSize=50` : null)
  const results = useMemo(() => series.data?.results ?? [], [series.data])
  return (
    <SearchSelect
      label={t("Серия")}
      value={value ? String(value) : ""}
      valueText={valueText}
      loading={series.loading && !series.data}
      options={results.map((option) => ({ value: String(option.id), text: option.displayName }))}
      onChange={(id) => onChange(results.find((option) => String(option.id) === id) ?? null)}
      className={className}
      menuWidth={200}
      boldOptions
    />
  )
}
