"use client"

import { Loader2 } from "lucide-react"
import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { RI, RefButton, RefIconButton } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import { AV_TIMER, SeriesDialog, type SeriesMode } from "./orders-extra-dialogs"

// Series (Серии) of client returns, like Linko's return card (#/return/<id>?tab=expireDates):
// - ReturnSeriesTab: the tab body (sales/order_return_product_exp/?order_return=): № | Товар | Количество | Серия |
//   Срок годности, an «Итого:» row, sorting kept in the component (not in the address);
// - ReturnSeriesButtons: the card header's «Изменит серии» (full-screen editor, ?openExpirationDatesEdit=true) and
//   «Авто распределение по сериям» (?openExpirationDateDialog=true&select=<id>); the buttons show on the «Серии» tab
//   only, the two deep links open on every tab;
// - ReturnSeriesListAction: the av_timer icon of the list's checkbox toolbar (the same dialog for the ticked returns).
// A save tells every open tab through a window event, so the card's tab reloads whichever control saved. Like Linko,
// ✕ leaves the flag in the address as =false, and only ✕ closes the dialogs (Escape does not).

const SERIES_EVENT = "mezon:return-series-changed"
/** The card's auto distribution ticks its return in the list above (Linko's `select`). */
const SELECT_EVENT = "mezon:return-series-select"
export const CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
export const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
export const DELETE_FOREVER =
  "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

type Series = { id: number; productId: number; number: string; expirationDate: string | null; displayName: string }
type SeriesRow = { id: number; returnItemId: number; productId: number | null; productName: string; amount: number; series: Series }
type SeriesLine = { id: number; productId: number; productName: string; quantity: number; unit: string }
/** A picker option; `render` (the menu row) and `label` (the chosen value) replace the plain text when given. */
export type Option = { id: number; text: string; productId?: number; render?: ReactNode; label?: ReactNode }
type Result<T> = { ok: true; body: T } | { ok: false; error: string; field?: string }

export async function request<T>(url: string, init?: { method?: string; body?: unknown }): Promise<Result<T>> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const body = (await response.json().catch(() => null)) as (T & { error?: string; field?: string }) | null
    if (!response.ok || body === null) return { ok: false, error: body?.error ?? "Не удалось сохранить изменения на сервере", field: body?.field }
    return { ok: true, body }
  } catch {
    return { ok: false, error: "Не удалось сохранить изменения на сервере" }
  }
}

// The tab and the editor open together on a deep link: one request serves both.
const pending = new Map<number, Promise<Result<SeriesRow[]>>>()
function fetchSeries(returnId: number): Promise<Result<SeriesRow[]>> {
  let promise = pending.get(returnId)
  if (!promise) {
    promise = request<SeriesRow[]>(`/api/client-returns/${returnId}/series`).finally(() => pending.delete(returnId))
    pending.set(returnId, promise)
  }
  return promise
}

function announce(ids: number[]) {
  for (const id of ids) pending.delete(id)
  window.dispatchEvent(new CustomEvent(SERIES_EVENT, { detail: ids }))
}

/** "26 нояб. 2025", like Linko's expiry column. */
export function expiryText(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "")
  return match ? `${match[3]} ${SHORT_MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}` : ""
}

/** A plain amount (191, 0.5), no grouping and no unit, like the tab of Linko. */
export function amountText(value: number) {
  return String(Math.round(value * 1e6) / 1e6)
}

/** Sets or drops query parameters of the returns page (only there: the card also opens over other pages). Linko keeps
 * the keys sorted (#/return/205?openExpirationDatesEdit=true&pageSize=25&tab=expireDates). */
function setParams(values: Record<string, string | null>) {
  if (!window.location.pathname.startsWith("/analytics/returns")) return
  const params = new URLSearchParams(window.location.search)
  for (const [name, value] of Object.entries(values)) {
    if (value === null) params.delete(name)
    else params.set(name, value)
  }
  params.sort()
  const query = params.toString()
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
}

function selectedIds(params: URLSearchParams): number[] {
  return (params.get("select") ?? "")
    .split("-")
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
}

/** The returns list takes the returns a card's auto distribution is for as its ticked rows (Linko's `select`). */
export function useReturnSeriesSelection(onSelect: (ids: number[]) => void) {
  useEffect(() => {
    const handler = (event: Event) => {
      const ids = (event as CustomEvent<number[]>).detail
      if (Array.isArray(ids)) onSelect(ids)
    }
    window.addEventListener(SELECT_EVENT, handler)
    return () => window.removeEventListener(SELECT_EVENT, handler)
  }, [onSelect])
}

// ---------------------------------------------------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------------------------------------------------

type SortKey = "productName" | "amount" | "series" | "expirationDate"

/** Linko's sortable head: both arrows grey; sorted descending only ▼, ascending only ▲. */
export function SortArrows({ state }: { state: "none" | "asc" | "desc" }) {
  return (
    <svg viewBox="0 0 8 12" className="ml-[10px] h-[12px] w-[8px]" aria-hidden>
      <path d="M1 5l3-4 3 4z" fill={state === "desc" ? "transparent" : "#888"} />
      <path d="M1 7l3 4 3-4z" fill={state === "asc" ? "transparent" : "#888"} />
    </svg>
  )
}

/** The «Серии» tab body of a return card. `refreshKey` reloads it when its value changes (the card's row after an
 * edit; an object is compared by its content, so a reload of the same row does not ask again). */
export function ReturnSeriesTab({ returnId, refreshKey }: { returnId: number; refreshKey?: unknown }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<SeriesRow[] | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null)
  const reloadKey = refreshKey !== null && typeof refreshKey === "object" ? JSON.stringify(refreshKey) : String(refreshKey ?? "")

  const load = useCallback(async () => {
    const result = await fetchSeries(returnId)
    setRows(result.ok ? result.body : [])
  }, [returnId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    const onChanged = (event: Event) => {
      const ids = (event as CustomEvent<number[]>).detail
      if (!Array.isArray(ids) || ids.includes(returnId)) void load()
    }
    window.addEventListener(SERIES_EVENT, onChanged)
    return () => window.removeEventListener(SERIES_EVENT, onChanged)
  }, [load, returnId])

  const shown = useMemo(() => {
    if (!rows || !sort) return rows ?? []
    const value = (row: SeriesRow): string | number =>
      sort.key === "amount" ? row.amount : sort.key === "productName" ? row.productName : sort.key === "series" ? row.series.displayName : row.series.expirationDate ?? ""
    return [...rows].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru", { numeric: true })
      return sort.desc ? -order : order
    })
  }, [rows, sort])

  if (rows === null) {
    return (
      <div className="flex justify-center pt-[40px] text-[#999]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (!rows.length) {
    // Linko's empty block: 300 × 296, the robot 155px wide 55px from its top, the line 230px down in #999.
    return (
      <div
        className="mx-auto h-[296px] w-[300px] bg-no-repeat pb-[50px] pt-[230px] text-center text-[13px] leading-[16.25px] text-[#999]"
        style={{ backgroundImage: "url(/robot-empty.png)", backgroundSize: "155px auto", backgroundPosition: "50% 55px" }}
      >
        {t("По вашему запросу ничего не найдено")}
      </div>
    )
  }
  // Linko cycles a column: descending, ascending, the server's order.
  const toggle = (key: SortKey) => setSort((current) => (current?.key !== key ? { key, desc: true } : current.desc ? { key, desc: false } : null))
  const head = (key: SortKey, label: string) => (
    <th key={key} className="border-t border-[#efefef] bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left font-semibold leading-[19.5px] text-[#374557]">
      <button type="button" onClick={() => toggle(key)} className="flex items-center font-semibold">
        {t(label)}
        <SortArrows state={sort?.key === key ? (sort.desc ? "desc" : "asc") : "none"} />
      </button>
    </th>
  )
  const cell = "border-b border-r border-[#efefef] px-[17.5px] py-[7.8px] text-left leading-[19.5px]"
  const total = Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 1e6) / 1e6
  return (
    <div className="border-l border-[#efefef]">
      <table className="w-full border-collapse text-[13px] text-[#333]">
        <thead>
          <tr>
            <th className="border-t border-[#efefef] bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left font-semibold leading-[19.5px] text-[#374557]">{t("№")}</th>
            {head("productName", "Товар")}
            {head("amount", "Количество")}
            {head("series", "Серия")}
            {head("expirationDate", "Срок годности")}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={row.id}>
              <td className={cell}>{index + 1}</td>
              <td className={cell}>{row.productName}</td>
              <td className={cell}>{amountText(row.amount)}</td>
              <td className={cell}>{row.series.displayName}</td>
              <td className={cell}>{t(expiryText(row.series.expirationDate))}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={cell} colSpan={2}>
              {t("Итого:")}
            </td>
            <td className={cell}>{amountText(total)}</td>
            <td className={cell} colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Searchable select of the editor (Linko's react-select: a 36px control with a bottom line, a menu under it)
// ---------------------------------------------------------------------------------------------------------------------

export function SearchSelect({
  label,
  value,
  load,
  onChange,
  disabled,
}: {
  /** Floating label of the top strip (the control is then 54px high with the label above it); none in the list. */
  label?: string
  value: Option | null
  load: (search: string) => Promise<Option[]>
  onChange: (value: Option | null) => void
  disabled?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [options, setOptions] = useState<Option[] | null>(null)
  const [loading, setLoading] = useState(false)
  // The highlighted option (the chosen value when the list opens, else the first); arrows and Enter pick with the keyboard.
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const valueId = value?.id

  useEffect(() => {
    if (!open) return
    let alive = true
    // Like Linko: «Загрузка...» until the first options come, then the shown ones stay while the next load (a spinner in
    // place of ×).
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        void load(search).then((rows) => {
          if (!alive) return
          setOptions(rows)
          setLoading(false)
          const at = rows.findIndex((row) => row.id === valueId)
          setActive(at >= 0 ? at : 0)
        })
      },
      search ? 300 : 0,
    )
    return () => {
      alive = false
      window.clearTimeout(timer)
      setLoading(false)
    }
  }, [open, search, load, valueId])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const show = () => {
    if (disabled || open) return
    setOptions(null)
    setSearch("")
    setOpen(true)
  }
  const choose = (option: Option) => {
    onChange(option)
    setOpen(false)
  }
  const floating = Boolean(label) && Boolean(value)
  return (
    <div ref={ref} className={`relative ${label ? "h-[54px]" : "h-[36px]"}`}>
      {label && !(open && search && !value) && (
        <span className={`pointer-events-none absolute left-0 z-[1] font-semibold text-black transition-all ${floating ? "top-[5px] text-[10px] leading-[12px]" : "top-[30px] text-[13px] leading-[16.25px]"}`}>
          {t(label)}
        </span>
      )}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={show}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") && event.target === event.currentTarget && show()}
        className={`absolute inset-x-0 bottom-0 h-[36px] border-b border-[#e8e8e8] ${disabled ? "cursor-default bg-[#f9f9f9]" : "cursor-pointer"}`}
      >
        <div className="absolute left-0 right-[44px] top-[12.8px] flex h-[18px] items-center overflow-hidden">
          {/* The chosen value stays while the list is open (not while its first options load), until something is typed. */}
          {value && !(open && (search || options === null)) && <span className="truncate text-[13px] font-semibold leading-[18px] text-[#333]">{value.label ?? value.text}</span>}
          {open && (
            <input
              autoFocus
              value={search}
              aria-label={label ? t(label) : t("Серия")}
              autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                const count = options?.length ?? 0
                if (event.key === "ArrowDown" && count) {
                  event.preventDefault()
                  setActive((index) => (index + 1) % count)
                } else if (event.key === "ArrowUp" && count) {
                  event.preventDefault()
                  setActive((index) => (index - 1 + count) % count)
                } else if (event.key === "Enter" && options?.[active]) {
                  event.preventDefault()
                  choose(options[active])
                } else if (event.key === "Escape") {
                  // Closes the list only, never the editor.
                  event.stopPropagation()
                  setOpen(false)
                }
              }}
              className="h-[18px] min-w-[5px] flex-1 bg-transparent p-0 text-[13px] text-black outline-none"
            />
          )}
        </div>
        {open && loading ? (
          <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-[27px] top-[14px] h-[16px] w-[16px] animate-spin" aria-hidden>
            <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : value && !disabled && (
          <button
            type="button"
            aria-label={t("Очистить")}
            onClick={(event) => {
              event.stopPropagation()
              onChange(null)
              setOpen(false)
            }}
            className="absolute right-[28px] top-[13.6px] h-[18px] w-[10px] text-center text-[18px] leading-[18px] text-[#999] hover:text-[#d0021b]"
          >
            ×
          </button>
        )}
        <svg viewBox="0 0 10 5" className={`pointer-events-none absolute right-[10px] top-[21px] h-[5px] w-[10px] ${disabled ? "fill-[#ccc]" : "fill-[#999]"} ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M0 0l5 5 5-5z" />
        </svg>
      </div>
      {open && (options !== null || loading) && (
        <div className="absolute inset-x-0 top-[calc(100%-1px)] z-[1700] max-h-[200px] overflow-y-auto bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {options === null ? (
            <div className="px-[10px] py-[8px] text-[13px] font-semibold leading-[16px] text-[#999]">{t("Загрузка...")}</div>
          ) : options.length === 0 ? (
            <div className="px-[10px] py-[8px] text-[13px] font-semibold leading-[16px] text-[#999]">{t("Не найдено")}</div>
          ) : (
            options.map((option, index) => (
              <button
                key={`${option.id}-${index}`}
                type="button"
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(index)}
                className={`block w-full px-[10px] text-left text-[13px] font-semibold ${option.render ? "py-[8px] leading-[16px]" : "h-[32px] truncate leading-[32px]"} ${index === active ? "bg-[#e6f2ff] text-[#333]" : "bg-white text-[#666]"}`}
              >
                {option.render ?? option.text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

const NO_OPTIONS = async (): Promise<Option[]> => []
// One loader per product and warehouse: a picker reloads its options only when its loader changes.
const seriesLoaders = new Map<string, (search: string) => Promise<Option[]>>()
function seriesOptions(productId: number | null | undefined, warehouse?: string) {
  if (!productId) return NO_OPTIONS
  const key = `${productId}|${warehouse ?? ""}`
  let loader = seriesLoaders.get(key)
  if (!loader) {
    loader = async (search: string) => {
      const query = new URLSearchParams({ product: String(productId), search, pageSize: "50" })
      if (warehouse) query.set("warehouse", warehouse)
      const result = await request<{ results: Series[] }>(`/api/stock/series?${query}`)
      return result.ok ? result.body.results.map((row) => ({ id: row.id, text: row.displayName })) : []
    }
    seriesLoaders.set(key, loader)
  }
  return loader
}

/** Linko's numeric normalizer: digits and one decimal point (a comma becomes a point). */
export function numeric(value: string) {
  const clean = value.replace(",", ".").replace(/[^\d.]/g, "")
  const dot = clean.indexOf(".")
  return dot < 0 ? clean : `${clean.slice(0, dot + 1)}${clean.slice(dot + 1).replace(/\./g, "")}`
}

// ---------------------------------------------------------------------------------------------------------------------
// «ИЗМЕНИТ СЕРИИ №N»
// ---------------------------------------------------------------------------------------------------------------------

type EditRow = { key: number; returnItemId: number; productId: number | null; productName: string; amount: string; series: Option | null }

let rowKeys = 0

// Linko's list: bootstrap columns 1 / 4 / 3 / 3 / 1 of 12, rows parted by a dotted line (2px dots every 8px).
export const LIST_GRID = "relative grid grid-cols-[minmax(0,1fr)_minmax(0,4fr)_minmax(0,3fr)_minmax(0,3fr)_minmax(0,1fr)] leading-[16.25px]"
const DOTS: CSSProperties = { backgroundImage: "linear-gradient(to right, #d9e0e5 2px, transparent 2px)", backgroundSize: "8px 2px", backgroundRepeat: "repeat-x" }
export const Dots = () => <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" style={DOTS} />

/** Full-screen editor of a return's series: the top strip adds a row (Наименование, Кол-во, Серия, ✓), the list edits
 * amounts and series or drops rows, СОХРАНИТЬ replaces the stored list. Only ✕ closes it, like Linko. */
export function ReturnSeriesEditDialog({ returnId, warehouse, onClose, onSaved }: { returnId: number; warehouse?: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<EditRow[] | null>(null)
  const [line, setLine] = useState<Option | null>(null)
  const [amount, setAmount] = useState("")
  const [series, setSeries] = useState<Option | null>(null)
  const [switching, setSwitching] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let alive = true
    void fetchSeries(returnId).then((result) => {
      if (!alive) return
      const initial = result.ok ? result.body : []
      setRows(
        initial.map((row) => ({
          key: ++rowKeys,
          returnItemId: row.returnItemId,
          productId: row.productId,
          productName: row.productName,
          amount: amountText(row.amount),
          series: { id: row.series.id, text: row.series.displayName },
        })),
      )
      if (!result.ok) setError(t(result.error))
    })
    return () => {
      alive = false
    }
  }, [returnId, t])

  const loadLines = useCallback(
    async (search: string) => {
      const result = await request<SeriesLine[]>(`/api/client-returns/${returnId}/series-lines?${new URLSearchParams({ search })}`)
      return result.ok ? result.body.map((row) => ({ id: row.id, text: row.productName, productId: row.productId })) : []
    },
    [returnId],
  )
  // The strip asks for the series of the return's warehouse (Linko's &stock=), a row for all of the product's.
  const stripSeries = seriesOptions(line?.productId, warehouse)

  function pickLine(next: Option | null) {
    setLine(next)
    setSeries(null)
    // Linko shows a short loader in place of «Серия» when the product changes.
    setSwitching(true)
    window.setTimeout(() => setSwitching(false), 300)
  }

  function add() {
    if (!line || !amount || !series || !(Number(amount) > 0)) return
    setRows((current) => [...(current ?? []), { key: ++rowKeys, returnItemId: line.id, productId: line.productId ?? null, productName: line.text, amount, series }])
    setLine(null)
    setAmount("")
    setSeries(null)
  }

  const update = (key: number, patch: Partial<EditRow>) => setRows((current) => (current ?? []).map((row) => (row.key === key ? { ...row, ...patch } : row)))

  async function save() {
    if (!rows || busy) return
    const missing = rows.findIndex((row) => !(Number(row.amount) > 0) || !row.series)
    if (missing >= 0) {
      setError(`${missing + 1}: ${!(Number(rows[missing].amount) > 0) ? t("Укажите количество") : t("Выберите серию")}`)
      return
    }
    setBusy(true)
    setError("")
    const result = await request<SeriesRow[]>(`/api/client-returns/${returnId}/series`, {
      method: "PUT",
      body: { products: rows.map((row) => ({ amount: Number(row.amount), returnItemId: row.returnItemId, seriesId: row.series!.id })) },
    })
    setBusy(false)
    if (!result.ok) {
      // A row's own error carries its number, like the check above.
      const at = /^products\.(\d+)\./.exec(result.field ?? "")
      return setError(`${at ? `${Number(at[1]) + 1}: ` : ""}${t(result.error)}`)
    }
    announce([returnId])
    onSaved()
  }

  return createPortal(
    <div className="fixed inset-0 z-[1500] flex flex-col bg-white font-sans text-[13px] text-[#333]" role="dialog" aria-modal="true" aria-label={`${t("Изменит серии")} №${returnId}`}>
      <div className="relative h-[60px] shrink-0">
        <span className="absolute left-[30px] top-[21px] text-[13px] font-bold uppercase leading-[16px]">
          {t("Изменит серии")} №{returnId}
        </span>
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[15px] top-[6px] flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
            <path d={CLOSE} />
          </svg>
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {/* Linko's strip runs to the right edge: 7px in from the left, columns 5 / 2 / 2 / 1 of 12. */}
        <div className="ml-[7px] flex h-[80px] items-start bg-[#f1f5f8] pl-[10px] pr-[11px] pt-[2px]">
          <div className="w-[41.666667%] px-[8px]">
            <SearchSelect label="Наименование" value={line} load={loadLines} onChange={pickLine} />
          </div>
          <div className="w-[16.666667%] px-[8px]">
            <label className="relative block h-[54px]">
              <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${amount ? "top-[5px] text-[10px] leading-[12px]" : "top-[30px] text-[13px] leading-[16px]"}`}>{t("Кол-во")}</span>
              <input
                value={amount}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => setAmount(numeric(event.target.value))}
                className="absolute inset-x-0 bottom-0 h-[42px] border-b border-[#e0e0e0] bg-transparent pb-[7px] pt-[16px] text-[13px] font-semibold text-black outline-none focus:border-[#1E4A9A]"
              />
            </label>
          </div>
          <div className="w-[16.666667%] px-[8px]">
            {switching ? (
              <div className="flex h-[54px] items-center justify-center text-[#999]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <SearchSelect label="Серия" value={series} load={stripSeries} onChange={setSeries} disabled={!line} />
            )}
          </div>
          <div className="mt-[20px] flex w-[8.333333%] items-center px-[8px]">
            <button type="button" aria-label={t("Добавить")} onClick={add} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: "rgb(79, 113, 220)" }} aria-hidden>
                <path d={CHECK} />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-[22px]">
          <div className={`${LIST_GRID} py-[20px] font-semibold`}>
            <span className="px-[8px]">{t("№")}</span>
            <span className="px-[8px]">{t("Товар")}</span>
            <span className="px-[8px]">{t("Количество")}</span>
            <span className="px-[8px]">{t("Серия")}</span>
            <span />
            <Dots />
          </div>
          {rows === null ? (
            <div className="flex justify-center py-[30px] text-[#999]">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            rows.map((row, index) => (
              <div key={row.key} className={`${LIST_GRID} items-center pb-[5px] pt-[10px] ${active === row.key ? "bg-[#f2f5f8]" : ""}`}>
                <span className="px-[8px]">{index + 1}</span>
                <span className="truncate px-[8px]">{row.productName}</span>
                <span className="relative h-[40px]">
                  <input
                    value={row.amount}
                    aria-label={t("Количество")}
                    autoComplete="off"
                    inputMode="decimal"
                    onFocus={() => setActive(row.key)}
                    onBlur={() => setActive(null)}
                    onChange={(event) => update(row.key, { amount: numeric(event.target.value) })}
                    className="peer absolute inset-x-[8px] top-[2.5px] h-[35px] bg-transparent p-0 text-[13px] font-semibold text-black outline-none"
                  />
                  <span aria-hidden className="pointer-events-none absolute inset-x-[8px] top-[28.5px] h-px bg-[#e0e0e0] peer-focus:h-[2px] peer-focus:bg-[#1E4A9A]" />
                </span>
                <span className="relative h-[40px]">
                  {/* Linko's control sits 8px above the row's content, its line level with the amount's. */}
                  <span className="absolute inset-x-[8px] top-[-8.3px]">
                    <SearchSelect value={row.series} load={seriesOptions(row.productId)} onChange={(value) => update(row.key, { series: value })} />
                  </span>
                </span>
                <span className="flex px-[8px]">
                  <button type="button" aria-label={t("Удалить")} onClick={() => setRows((current) => (current ?? []).filter((item) => item.key !== row.key))} className="flex h-10 w-10 items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden>
                      <path d={DELETE_FOREVER} />
                    </svg>
                  </button>
                </span>
                <Dots />
              </div>
            ))
          )}
        </div>
      </div>
      <div className="relative flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] px-[10px]">
        {error && <span className="absolute left-[30px] right-[160px] truncate text-[#e57373]">{error}</span>}
        <button type="button" disabled={busy || rows === null} onClick={() => void save()} className="h-9 min-w-[111px] rounded-[2px] bg-[#71ce87] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] disabled:opacity-60">
          {t("Сохранить")}
        </button>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// «АВТО РАСПРЕДЕЛЕНИЕ ПО СЕРИЯМ»
// ---------------------------------------------------------------------------------------------------------------------

/** The auto distribution of `ids` (none: «Выберите заказ из списка»); FIFO is chosen on every open. */
export function ReturnSeriesAutoDialog({ ids, onClose, onSaved }: { ids: number[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save(mode: SeriesMode) {
    if (busy) return
    setBusy(true)
    setError("")
    const result = await request<{ returns: number; rows: number }>("/api/client-returns/series/auto", { method: "POST", body: { autoType: mode, ids } })
    setBusy(false)
    if (!result.ok) return setError(t(result.error))
    announce(ids)
    onSaved()
  }
  return <SeriesDialog ids={ids} busy={busy} error={error} onClose={onClose} onSave={(mode) => void save(mode)} />
}

/** The card's two series dialogs and their deep links (?openExpirationDatesEdit=true, ?openExpirationDateDialog=true
 * &select=<ids>), which open on every tab; `buttons` shows the header buttons (Linko: on the «Серии» tab only).
 * `onChanged` gets the snackbar. */
export function ReturnSeriesButtons({ returnId, warehouse, onChanged, buttons = true }: { returnId: number; warehouse?: string; onChanged: (message: string) => void; buttons?: boolean }) {
  const { t } = useLanguage()
  const [editOpen, setEditOpen] = useState(false)
  const [autoIds, setAutoIds] = useState<number[] | null>(null)

  // Deep links (after hydration), only on this card's own address.
  useEffect(() => {
    if (window.location.pathname !== `/analytics/returns/${returnId}`) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("openExpirationDatesEdit") === "true") setEditOpen(true)
    if (params.get("openExpirationDateDialog") === "true") setAutoIds(selectedIds(params))
  }, [returnId])

  const openEdit = () => {
    setEditOpen(true)
    setParams({ openExpirationDatesEdit: "true" })
  }
  const closeEdit = useCallback(() => {
    setEditOpen(false)
    setParams({ openExpirationDatesEdit: "false" })
  }, [])
  const openAuto = () => {
    setAutoIds([returnId])
    setParams({ openExpirationDateDialog: "true", select: String(returnId) })
    window.dispatchEvent(new CustomEvent(SELECT_EVENT, { detail: [returnId] }))
  }
  const closeAuto = useCallback(() => {
    setAutoIds(null)
    // Linko keeps `select` in the address.
    setParams({ openExpirationDateDialog: "false" })
  }, [])

  return (
    <>
      {buttons && (
        <>
          <RefButton icon={RI.edit} label={t("Изменит серии")} onClick={openEdit} exact />
          <RefButton icon={AV_TIMER} label={t("Авто распределение по сериям")} onClick={openAuto} exact />
        </>
      )}
      {editOpen && (
        <ReturnSeriesEditDialog
          returnId={returnId}
          warehouse={warehouse}
          onClose={closeEdit}
          onSaved={() => {
            closeEdit()
            onChanged(t("Успешно изменено"))
          }}
        />
      )}
      {autoIds && (
        <ReturnSeriesAutoDialog
          ids={autoIds}
          onClose={closeAuto}
          onSaved={() => {
            closeAuto()
            onChanged(t("Успешно изменено"))
          }}
        />
      )}
    </>
  )
}

/** The av_timer icon of the returns list's checkbox toolbar («Авто распределение по сериям» of the ticked returns),
 * and the list's deep link ?openExpirationDateDialog=true[&select=205-207]. Renders the icon only when `ids` is set. */
export function ReturnSeriesListAction({ ids, onDone }: { ids: number[]; onDone: (message: string) => void }) {
  const { t } = useLanguage()
  const [autoIds, setAutoIds] = useState<number[] | null>(null)

  useEffect(() => {
    // A card's own deep link is the card's (ReturnSeriesButtons).
    if (window.location.pathname !== "/analytics/returns") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("openExpirationDateDialog") === "true") setAutoIds(selectedIds(params))
  }, [])

  const close = useCallback(() => {
    setAutoIds(null)
    setParams({ openExpirationDateDialog: "false" })
  }, [])

  return (
    <>
      {ids.length ? (
        <RefIconButton
          path={AV_TIMER}
          label={t("Авто распределение по сериям")}
          color="#666"
          onClick={() => {
            setAutoIds(ids)
            setParams({ openExpirationDateDialog: "true", select: ids.join("-") })
          }}
        />
      ) : null}
      {autoIds && (
        <ReturnSeriesAutoDialog
          ids={autoIds}
          onClose={close}
          onSaved={() => {
            close()
            onDone(t("Успешно изменено"))
          }}
        />
      )}
    </>
  )
}
