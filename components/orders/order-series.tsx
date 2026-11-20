"use client"

import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { RI, RefButton } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import { AV_TIMER, SeriesDialog, type SeriesMode } from "./orders-extra-dialogs"
import { CHECK, CLOSE, DELETE_FOREVER, Dots, LIST_GRID, SearchSelect, SortArrows, amountText, expiryText, numeric, request, type Option } from "./return-series"

// Series (Серии) of orders, like Linko's order card (#/order/<id>?tab=expireDate):
// - OrderSeriesTab: the tab body (sales/order_product_exp/?order=): № | Товар | Количество | Серия | Срок годности, an
//   «Итого:» row, sorting kept in the component (not in the address);
// - OrderSeriesControls: the card header's av_timer icon («Авто распределение по сериям»: Linko ticks the order in the
//   list, ?select=<id>, and opens the list's dialog) and «Изменит серии» (full-screen editor, ?openExpirationDatesEdit=
//   true); both show on the «Серии» tab only;
// - OrderSeriesEditLink: the editor's deep link on the orders page, on every tab and also for an order the list does not
//   show (Linko opens it from the address alone);
// - OrderSeriesAutoDialog: the auto distribution of the ticked orders (the list's av_timer and the card's).
// A save tells every open tab through a window event, so the card's tab reloads whichever control saved. Like Linko, ✕
// leaves the flag in the address as =false, and only ✕ closes the dialogs (Escape does not: they carry
// data-order-overlay, which keeps a host dialog such as the activity page's order dialog from closing on Escape).

const SERIES_EVENT = "mezon:order-series-changed"
/** The card's av_timer asks the orders list to tick the order and open its auto distribution (Linko's `select`). */
const AUTO_EVENT = "mezon:order-series-auto"

type Series = { id: number; productId: number; number: string; expirationDate: string | null; displayName: string }
type SeriesRow = { id: number; orderItemId: number; productId: number | null; productName: string; amount: number; series: Series }
type SeriesLine = { id: number; number: number; productId: number; productName: string; quantity: number; unit: string; isBonus: boolean; promotion: string }
type BalanceSeries = Series & { totalBalance: number; available: number }

// The tab and the editor open together on a deep link: one request serves both.
const pending = new Map<number, ReturnType<typeof request<SeriesRow[]>>>()
function fetchSeries(orderId: number) {
  let promise = pending.get(orderId)
  if (!promise) {
    promise = request<SeriesRow[]>(`/api/orders/${orderId}/series`).finally(() => pending.delete(orderId))
    pending.set(orderId, promise)
  }
  return promise
}

function announce(ids: number[]) {
  for (const id of ids) pending.delete(id)
  window.dispatchEvent(new CustomEvent(SERIES_EVENT, { detail: ids }))
}

/** "7 994", "0,5": Linko's quantities in the pickers (grouped, up to 3 decimals). */
const qtyText = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value).replace(/ /g, " ")

/** An amount input's text: Linko groups the whole part by thousands as you type («1 921.5»); the state keeps numeric()'s
 * plain text, which drops the spaces again. */
function grouped(value: string) {
  const dot = value.indexOf(".")
  const whole = dot < 0 ? value : value.slice(0, dot)
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (dot < 0 ? "" : value.slice(dot))
}

/** Sets or drops query parameters of the orders page (only there: the card also opens over other pages). Linko keeps the
 * keys sorted (#/order/1458?openExpirationDatesEdit=true&search=1458&tab=expireDate). */
function setParams(values: Record<string, string | null>) {
  if (!window.location.pathname.startsWith("/analytics/sales")) return
  const params = new URLSearchParams(window.location.search)
  for (const [name, value] of Object.entries(values)) {
    if (value === null) params.delete(name)
    else params.set(name, value)
  }
  params.sort()
  const query = params.toString()
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
}

// ---------------------------------------------------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------------------------------------------------

type SortKey = "productName" | "amount" | "series" | "expirationDate"

/** The «Серии» tab body of an order card. `refreshKey` reloads it when its value changes (the order's lines after an
 * edit; an object is compared by its content). */
export function OrderSeriesTab({ orderId, refreshKey }: { orderId: number; refreshKey?: unknown }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<SeriesRow[] | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null)
  const reloadKey = refreshKey !== null && typeof refreshKey === "object" ? JSON.stringify(refreshKey) : String(refreshKey ?? "")

  const load = useCallback(async () => {
    const result = await fetchSeries(orderId)
    setRows(result.ok ? result.body : [])
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  useEffect(() => {
    const onChanged = (event: Event) => {
      const ids = (event as CustomEvent<number[]>).detail
      if (!Array.isArray(ids) || ids.includes(orderId)) void load()
    }
    window.addEventListener(SERIES_EVENT, onChanged)
    return () => window.removeEventListener(SERIES_EVENT, onChanged)
  }, [load, orderId])

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
      {/* Linko's arrows take 20px after the label (ours 18px): the 2px keep its column widths. */}
      <button type="button" onClick={() => toggle(key)} className="flex items-center pr-[2px] font-semibold">
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
// Pickers
// ---------------------------------------------------------------------------------------------------------------------

const NO_OPTIONS = async (): Promise<Option[]> => []

// One loader per product (and warehouse): a picker reloads its options only when its loader changes.
const catalogLoaders = new Map<number, (search: string) => Promise<Option[]>>()
/** A row's «Серия»: every series of the product (Linko's stock/series/?product=). */
function catalogOptions(productId: number | null | undefined) {
  if (!productId) return NO_OPTIONS
  let loader = catalogLoaders.get(productId)
  if (!loader) {
    loader = async (search: string) => {
      const result = await request<{ results: Series[] }>(`/api/stock/series?${new URLSearchParams({ product: String(productId), search, pageSize: "50" })}`)
      return result.ok ? result.body.results.map((row) => ({ id: row.id, text: row.displayName })) : []
    }
    catalogLoaders.set(productId, loader)
  }
  return loader
}

// ---------------------------------------------------------------------------------------------------------------------
// «ИЗМЕНИТ СЕРИИ №N»
// ---------------------------------------------------------------------------------------------------------------------

type EditRow = { key: number; orderItemId: number; productId: number | null; productName: string; amount: string; series: Option | null }

let rowKeys = 0

/** Full-screen editor of an order's series: the top strip adds a row (Наименование, Кол-во, Серия with «Доступно» in the
 * order's warehouse, ✓), the list edits amounts and series or drops rows, СОХРАНИТЬ replaces the stored list. Only ✕
 * closes it, like Linko. Without `warehouse` (the deep link of an order the list does not show) it reads the order's. */
export function OrderSeriesEditDialog({ orderId, warehouse, onClose, onSaved }: { orderId: number; warehouse?: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [loadedWarehouse, setLoadedWarehouse] = useState("")
  const stock = warehouse ?? loadedWarehouse
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
    void fetchSeries(orderId).then((result) => {
      if (!alive) return
      const initial = result.ok ? result.body : []
      setRows(
        initial.map((row) => ({
          key: ++rowKeys,
          orderItemId: row.orderItemId,
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
  }, [orderId, t])

  useEffect(() => {
    if (warehouse !== undefined) return
    let alive = true
    void request<{ warehouse?: string; stockName?: string }>(`/api/orders/${orderId}`).then((result) => {
      if (alive && result.ok) setLoadedWarehouse(result.body.warehouse || result.body.stockName || "")
    })
    return () => {
      alive = false
    }
  }, [orderId, warehouse])

  // Linko's option: «<name> (бонус) - <qty> <unit>» in bold over «№ <line>» and, for a promotion's line, «Акция: <name>»;
  // the chosen value shows the first line.
  const loadLines = useCallback(
    async (search: string) => {
      const result = await request<SeriesLine[]>(`/api/orders/${orderId}/series-lines?${new URLSearchParams({ search })}`)
      if (!result.ok) return []
      return result.body.map((row): Option => {
        const title = (
          <>
            {row.productName} {row.isBonus && <span className="text-[#81c784]">({t("бонус")})</span>} - {qtyText(row.quantity)} {row.unit}
          </>
        )
        return {
          id: row.id,
          text: row.productName,
          productId: row.productId,
          label: title,
          render: (
            <>
              <strong className="block font-semibold">{title}</strong>
              <span className="block">№ {row.number}</span>
              {row.promotion && (
                <span className="block">
                  {t("Акция")}: {row.promotion}
                </span>
              )}
            </>
          ),
        }
      })
    },
    [orderId, t],
  )

  // The strip's «Серия»: the series the order's warehouse holds, with «Доступно» (Linko's stock/series_balance/).
  const productId = line?.productId
  const loadBalance = useMemo(() => {
    if (!productId || !stock) return NO_OPTIONS
    return async (search: string) => {
      const result = await request<{ results: BalanceSeries[] }>(`/api/stock/series-balance?${new URLSearchParams({ product: String(productId), warehouse: stock, search, pageSize: "50" })}`)
      if (!result.ok) return []
      return result.body.results.map(
        (row): Option => ({
          id: row.id,
          text: row.displayName,
          render: (
            <>
              <span className="block">{row.displayName}</span>
              <span className="block">
                {t("Доступно")}: {qtyText(row.available)}
              </span>
            </>
          ),
        }),
      )
    }
  }, [productId, stock, t])

  function pickLine(next: Option | null) {
    setLine(next)
    setSeries(null)
    // Linko shows a short loader in place of «Серия» when the product changes.
    setSwitching(true)
    window.setTimeout(() => setSwitching(false), 300)
  }

  function add() {
    if (!line || !amount || !series || !(Number(amount) > 0)) return
    setRows((current) => [...(current ?? []), { key: ++rowKeys, orderItemId: line.id, productId: line.productId ?? null, productName: line.text, amount, series: { id: series.id, text: series.text } }])
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
    const result = await request<SeriesRow[]>(`/api/orders/${orderId}/series`, {
      method: "PUT",
      body: { products: rows.map((row) => ({ amount: Number(row.amount), orderItemId: row.orderItemId, seriesId: row.series!.id })) },
    })
    setBusy(false)
    if (!result.ok) {
      // A row's own error carries its number, like the check above.
      const at = /^products\.(\d+)\./.exec(result.field ?? "")
      return setError(`${at ? `${Number(at[1]) + 1}: ` : ""}${t(result.error)}`)
    }
    announce([orderId])
    onSaved()
  }

  return createPortal(
    <div data-order-overlay className="fixed inset-0 z-[1500] flex flex-col bg-white font-sans text-[13px] text-[#333]" role="dialog" aria-modal="true" aria-label={`${t("Изменит серии")} №${orderId}`}>
      <div className="relative h-[60px] shrink-0">
        <span className="absolute left-[30px] top-[21px] text-[13px] font-bold uppercase leading-[16px]">
          {t("Изменит серии")} №{orderId}
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
                value={grouped(amount)}
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
              <SearchSelect label="Серия" value={series} load={loadBalance} onChange={setSeries} disabled={!line} />
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
                    value={grouped(row.amount)}
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
                    <SearchSelect value={row.series} load={catalogOptions(row.productId)} onChange={(value) => update(row.key, { series: value })} />
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
export function OrderSeriesAutoDialog({ ids, onClose, onSaved }: { ids: number[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function save(mode: SeriesMode) {
    if (busy) return
    setBusy(true)
    setError("")
    const result = await request<{ orders: number; rows: number; unassigned: number }>("/api/orders/series/auto", { method: "POST", body: { autoType: mode, ids } })
    setBusy(false)
    if (!result.ok) return setError(t(result.error))
    announce(ids)
    onSaved()
  }
  return <SeriesDialog ids={ids} busy={busy} error={error} onClose={onClose} onSave={(mode) => void save(mode)} />
}

/** The orders list takes the card's auto distribution: it ticks the order (Linko's `select`) and opens its dialog. The
 * handler claims the request; a card shown elsewhere opens the dialog itself. */
export function useOrderSeriesAutoRequest(onRequest: (ids: number[]) => void) {
  useEffect(() => {
    const handler = (event: Event) => {
      const ids = (event as CustomEvent<number[]>).detail
      if (!Array.isArray(ids)) return
      event.preventDefault()
      onRequest(ids)
    }
    window.addEventListener(AUTO_EVENT, handler)
    return () => window.removeEventListener(AUTO_EVENT, handler)
  }, [onRequest])
}

/** The card's series controls: the header's av_timer and «Изменит серии» when `buttons` (Linko: on the «Серии» tab
 * only) and their dialogs (the editor's deep link is OrderSeriesEditLink's). `onNotify` gets the snackbar. */
export function OrderSeriesControls({ orderId, warehouse, buttons, onNotify }: { orderId: number; warehouse?: string; buttons: boolean; onNotify: (message: string) => void }) {
  const { t } = useLanguage()
  const [editOpen, setEditOpen] = useState(false)
  const [autoIds, setAutoIds] = useState<number[] | null>(null)

  const openEdit = () => {
    setEditOpen(true)
    setParams({ openExpirationDatesEdit: "true" })
  }
  const closeEdit = useCallback(() => {
    setEditOpen(false)
    setParams({ openExpirationDatesEdit: "false" })
  }, [])
  const openAuto = () => {
    const ask = new CustomEvent(AUTO_EVENT, { detail: [orderId], cancelable: true })
    // Nobody took it (the card is not on the orders list): its own dialog.
    if (window.dispatchEvent(ask)) setAutoIds([orderId])
  }

  return (
    <>
      {buttons && (
        <>
          {/* Linko: a 48px #666 icon 10px before «Изменит серии», its hint below it. */}
          <span className="group relative -mr-[8px]">
            <button type="button" aria-label={t("Авто распределение по сериям")} onClick={openAuto} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                <path d={AV_TIMER} />
              </svg>
            </button>
            <span className="pointer-events-none absolute left-1/2 top-[58px] z-[120] hidden -translate-x-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-normal leading-[16.9px] text-white opacity-90 group-hover:block">
              {t("Авто распределение по сериям")}
            </span>
          </span>
          <RefButton icon={RI.edit} label="Изменит серии" onClick={openEdit} />
        </>
      )}
      {editOpen && (
        <OrderSeriesEditDialog
          orderId={orderId}
          warehouse={warehouse}
          onClose={closeEdit}
          onSaved={() => {
            closeEdit()
            onNotify(t("Успешно изменено"))
          }}
        />
      )}
      {autoIds && (
        <OrderSeriesAutoDialog
          ids={autoIds}
          onClose={() => setAutoIds(null)}
          onSaved={() => {
            setAutoIds(null)
            onNotify(t("Успешно изменено"))
          }}
        />
      )}
    </>
  )
}

/** The editor's deep link on the orders page: /analytics/sales/<id>?openExpirationDatesEdit=true opens it on any tab of
 * the card and, like Linko, also when the list does not show the order (a cancelled one). `onNotify` gets the snackbar. */
export function OrderSeriesEditLink({ onNotify }: { onNotify: (message: string) => void }) {
  const { t } = useLanguage()
  const [orderId, setOrderId] = useState<number | null>(null)

  // After hydration: the editor is a portal into document.body.
  useEffect(() => {
    const id = Number(/^\/analytics\/sales\/(\d+)\/?$/.exec(window.location.pathname)?.[1])
    if (Number.isSafeInteger(id) && id > 0 && new URLSearchParams(window.location.search).get("openExpirationDatesEdit") === "true") setOrderId(id)
  }, [])

  const close = useCallback(() => {
    setOrderId(null)
    setParams({ openExpirationDatesEdit: "false" })
  }, [])

  if (!orderId) return null
  return (
    <OrderSeriesEditDialog
      orderId={orderId}
      onClose={close}
      onSaved={() => {
        close()
        onNotify(t("Успешно изменено"))
      }}
    />
  )
}
