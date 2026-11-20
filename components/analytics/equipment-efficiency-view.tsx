"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { ActivityOrderDialog } from "@/components/analytics/activity-dialogs"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { formatRuDate } from "@/components/analytics/customer-payments-filters"
import { OrderPaymentStatus } from "@/components/analytics/order-debts-dialogs"
import { PageSizeSelect } from "@/components/analytics/settings-list-kit"
import { RefHeader, RI } from "@/components/ref/list-kit"
import { LinkoMultiField, LinkoPeriodField, type LinkoOption } from "@/components/ref/linko-select-fields"
import { ReportFilterPanel, ReportPage } from "@/components/ref/report-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { TABLE_SETTINGS_ICON, TableColumnsDrawer } from "@/components/ref/table-columns-drawer"
import { amountDigits, roundToDigits } from "@/lib/amount-precision"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// «Эффективность оборудования» (Linko #/statistics/gear): the clients holding equipment and their sales in a period,
// computed by /api/equipment-efficiency (lib/equipment-efficiency-repo.ts). The filter, the period, the search, the
// order, the page and the opened client / order live in the URL under Linko's names (fromDate, responsibleAgents,
// borders, openOrdersDialog, orderDetails …), so a link or Back restores them. The limits of the sales groups (the
// pencil of the third card) are each viewer's own, as Linko keeps them in the browser.

type Gear = { id: number; productId: number | null; productName: string }
type Row = { id: number; name: string; totalSales: number; totalSalesByGear: number; productCount: number; productAmount: number; gears: Gear[] }
type Total = {
  okb: number
  okbGear: number
  akb: number
  akbGear: number
  avgCheck: number
  firstAmount: number
  secondAmount: number
  thirdAmount: number
  totalFact: number
  totalFactGear: number
  okbGearCount: number
  akbGearCount: number
  firstGearCount: number
  secondGearCount: number
  thirdGearCount: number
  currency: string
}
type Option = { id: number; name: string; parentId?: number | null }
type Options = Record<"agents" | "divisions" | "zones" | "branches" | "gears" | "gearProducts" | "clientTypes" | "products" | "productTypes", Option[]>
type GearOrder = { id: number; paymentDate: string; paymentType: string; totalPrice: number; remaining: number; currency: string; status: string }
type Query = Record<string, string>

const API = "/api/equipment-efficiency"
const FIRST_DEFAULT = 1_500_000
const SECOND_DEFAULT = 3_000_000
const LIMITS_KEY = "mezon.equipment-efficiency.limits"
const COLUMNS_KEY = "mezon.equipment-efficiency.columns"
/** Query keys that only move the view (page, opened windows): the data does not depend on them. */
const VIEW_KEYS = new Set(["page", "pageSize", "openOrdersDialog", "orderDetails", "dPage", "dPageSize", "toggle", "withProfit"])
/** The filter panel's keys (Linko's STAT_GEAR_FILTER_KEY). */
const LIST_KEYS = ["responsibleAgents", "division", "borders", "branch", "gear", "product", "marketTypeParent", "marketType", "productForOrder", "productTypeForOrder", "parentTypeForOrder"] as const
const RANGE_KEYS = ["factFrom", "factTo", "factByGearFrom", "factByGearTo"] as const
const DATE_KEYS = ["fromDate", "toDate", "acceptedDateBegin", "acceptedDateEnd"] as const

type ColumnKey = "name" | "totalSales" | "totalSalesByGear" | "productCount" | "productAmount" | "gears"
/** Linko's STAT_GEAR_NAMES: the client column is 220px, the equipment 330px, the four figures share the rest. */
const COLUMNS: { key: ColumnKey; title: string; width?: number; sortable?: boolean }[] = [
  { key: "name", title: "Клиент", width: 220 },
  { key: "totalSales", title: "Факт. продажи", sortable: true },
  { key: "totalSalesByGear", title: "Факт. продажи оборудования", sortable: true },
  { key: "productCount", title: "Разновидности" },
  { key: "productAmount", title: "Кол-во продуктов" },
  { key: "gears", title: "Оборудование", width: 330 },
]
const ALL_COLUMNS = Object.fromEntries(COLUMNS.map((column) => [column.key, true])) as Record<ColumnKey, boolean>
const FULLSCREEN = "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
const FULLSCREEN_EXIT = "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
const CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** Linko's numberFormat (Настройки → Округление сумм decimals) with an optional suffix. */
const fmt = (value: number, suffix = "") => `${formatMoney(value, 3)}${suffix ? ` ${suffix}` : ""}`
/** Linko's round() of a percentage (the same decimals). */
const pct = (part: number, whole: number) => (whole ? roundToDigits((part / whole) * 100, amountDigits(3)) : 0)

/** Linko's «Оборудование» cell: the equipment grouped by product («Холодильник (2 шт.)»), cut at 55 characters. */
function gearText(gears: Gear[], pieces: string): string {
  const groups = new Map<string, number>()
  for (const gear of gears) groups.set(gear.productName, (groups.get(gear.productName) ?? 0) + 1)
  const text = [...groups].map(([name, count]) => `${name} (${count} ${pieces})`).join(", ")
  return text.length > 55 ? `${text.slice(0, 55)}...` : text
}

/** "2025-01-01" → "01.01.2025" (Linko's period next to the filter button). */
const dotted = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso)

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private windows may refuse storage: the setting then lasts for this visit only.
  }
}

/** The page's query in the URL: read once mounted and on Back / Forward; opening a window adds a history entry. */
function useUrlQuery() {
  const [query, setQuery] = useState<Query | null>(null)
  const current = useRef<Query>({})
  useEffect(() => {
    const sync = () => {
      const next = Object.fromEntries(new URLSearchParams(window.location.search))
      current.current = next
      setQuery(next)
    }
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])
  const update = useCallback((patch: Record<string, string | null | undefined>, push = false) => {
    const next: Query = { ...current.current }
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === "") delete next[key]
      else next[key] = value
    }
    const params = new URLSearchParams(next)
    params.sort()
    const url = `${window.location.pathname}?${params.toString()}`
    if (push) window.history.pushState(null, "", url)
    else window.history.replaceState(window.history.state, "", url)
    current.current = next
    setQuery(next)
  }, [])
  return { query, update }
}

export function EquipmentEfficiencyView() {
  const { t } = useLanguage()
  const { query, update } = useUrlQuery()
  const [options, setOptions] = useState<Options | null>(null)
  const [report, setReport] = useState<{ rows: Row[]; total: Total } | null>(null)
  const [error, setError] = useState("")
  const [limits, setLimits] = useState({ first: FIRST_DEFAULT, second: SECOND_DEFAULT })
  const [visible, setVisible] = useState(ALL_COLUMNS)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const stored = readLocal(LIMITS_KEY, { first: FIRST_DEFAULT, second: SECOND_DEFAULT })
    setLimits({ first: Number(stored.first) || FIRST_DEFAULT, second: Number(stored.second) || SECOND_DEFAULT })
    setVisible(readLocal(COLUMNS_KEY, ALL_COLUMNS))
    fetch(`${API}?options=1`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Options>) : Promise.reject()))
      .then(setOptions)
      .catch(() => setOptions({ agents: [], divisions: [], zones: [], branches: [], gears: [], gearProducts: [], clientTypes: [], products: [], productTypes: [] }))
  }, [])

  // The data's own query: everything but the view keys, plus this viewer's group limits.
  const dataQuery = useMemo(() => {
    if (!query) return null
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (!VIEW_KEYS.has(key)) params.set(key, value)
    params.set("firstLimit", String(limits.first))
    params.set("secondLimit", String(limits.second))
    params.sort()
    return params.toString()
  }, [query, limits])

  useEffect(() => {
    if (dataQuery === null) return
    const controller = new AbortController()
    fetch(`${API}?${dataQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as ({ rows: Row[]; total: Total } & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
        setError("")
        setReport(body)
      })
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name === "AbortError") return
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные")
      })
    return () => controller.abort()
  }, [dataQuery])

  const q = query ?? {}
  const rows = useMemo(() => report?.rows ?? [], [report])
  const total = report?.total ?? null
  const currency = currencyLabel(total?.currency ?? "SUM")
  const pageSize = Math.max(1, Math.min(2000, Number(q.pageSize) || 25))
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, Number(q.page) || 1), pageCount)
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const shown = COLUMNS.filter((column) => visible[column.key])
  const ordering = q.ordering ?? ""
  const openClient = Number(q.openOrdersDialog) || 0
  const orderDetails = Number(q.orderDetails) || 0

  // «Фильтр / N» counts the filter keys in the address as Linko does: the created period once, its realization
  // period twice (begin and end), every other key once.
  const filterCount =
    (q.fromDate || q.toDate ? 1 : 0) +
    (q.acceptedDateBegin ? 1 : 0) +
    (q.acceptedDateEnd ? 1 : 0) +
    LIST_KEYS.filter((key) => q[key]).length +
    RANGE_KEYS.filter((key) => q[key]).length
  // Next to the button Linko names the chosen organizations and branches («Electronika 777»), else the whole company.
  const namesOf = (key: string, list: Option[] | undefined) =>
    (q[key] ?? "")
      .split("-")
      .map((id) => list?.find((item) => String(item.id) === id)?.name)
      .filter(Boolean)
      .join(", ")
  const scope = [namesOf("division", options?.divisions), namesOf("branch", options?.branches)].filter(Boolean).join(" ")
  const period = q.fromDate || q.toDate ? `${dotted(q.fromDate ?? "")} - ${dotted(q.toDate ?? "")}` : ""

  function sortBy(key: ColumnKey) {
    const next = ordering === key ? `-${key}` : key
    update({ ordering: next, page: null })
  }

  function downloadExcel() {
    const head = shown.map((column) => t(column.title))
    const body = rows.map((row) =>
      shown.map((column) => {
        if (column.key === "name") return row.name
        if (column.key === "gears") return gearText(row.gears, t("шт."))
        return fmt(row[column.key])
      }),
    )
    downloadExcelTable("equipment-efficiency", [head, ...body])
  }

  const content = (
    <>
      <div className="flex h-[34px] items-center">
        <button type="button" onClick={() => setFilterOpen(true)} className="flex h-[34px] items-center rounded-[5px] bg-[#1E4A9A] pl-[12px] text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden><path d={RI.filter} /></svg>
          <span className="pl-[8px] pr-[16px] leading-[34px]">{filterCount ? `${t("Фильтр")} / ${filterCount}` : t("Фильтр")}</span>
        </button>
        <button type="button" onClick={() => setFilterOpen(true)} className={`${period ? "" : "ml-[4px] "}px-[10px] text-left text-[13px] font-semibold leading-[34px] text-[#1E4A9A]`}>
          {period ? `${period} ` : ""}
          {scope || t("Во всей организации")}
        </button>
        <button type="button" onClick={downloadExcel} className="ml-auto flex h-[34px] items-center rounded-[5px] bg-[#71ce87] pl-[12px] text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden><path d={RI.chart} /></svg>
          <span className="pl-[8px] pr-[16px] leading-[34px]">{t("Скачать")}</span>
        </button>
      </div>

      <Summary total={total} currency={currency} limits={limits} onLimits={(next) => { setLimits(next); writeLocal(LIMITS_KEY, next) }} />

      {error && <p className="py-3 text-[13px] text-[#e57373]">{t(error)}</p>}

      {rows.length > 0 || !report || q.search ? (
        // «Расширенный вид» lays the toolbar and the table over the page under the menu bar (Linko puts its toolbar under
        // the bar, out of reach; here it stays visible so the view can be left again).
        <div className={expanded ? "fixed inset-x-0 bottom-0 top-[50px] z-30 overflow-auto bg-white px-[30px]" : ""}>
          <div className="flex h-[50px] items-center justify-between">
            <div className="text-[13px] font-semibold text-[#333]">{t("Продажи")}</div>
            <label className="relative flex h-[48px] w-[182px] items-center border-b border-[#e0e0e0] pr-[35px] focus-within:border-[#5d6474]">
              <input
                value={q.search ?? ""}
                onChange={(event) => update({ search: event.target.value, page: null })}
                placeholder={t("Поиск")}
                aria-label={t("Поиск")}
                className="h-full w-full bg-transparent text-[13px] text-[#333] outline-none placeholder:text-black/30"
              />
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[2px] top-[12px] h-6 w-6 fill-[#ccc]" aria-hidden>
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            </label>
            <div className="flex items-center text-[13px] text-[#5d6474]">
              <div className="mr-[27px]"><PageSizeSelect value={pageSize} onChange={(size) => update({ pageSize: String(size), page: null })} /></div>
              <span className="mr-[5px] whitespace-nowrap leading-[16.25px]">
                {rows.length ? (page - 1) * pageSize + 1 : 1} - {(page - 1) * pageSize + pageRows.length} {t("из")} {rows.length}
              </span>
              <button type="button" disabled={page <= 1} onClick={() => update({ page: page - 1 > 1 ? String(page - 1) : null })} aria-label={t("Назад")} className="px-[5px]">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
              </button>
              <button type="button" disabled={page >= pageCount} onClick={() => update({ page: String(page + 1) })} aria-label={t("Вперед")}>
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
              </button>
              <RefTip text={t("Вкл/Выкл колонки")} side="left">
                <button type="button" onClick={() => setColumnsOpen(true)} aria-label={t("Вкл/Выкл колонки")} className="ml-[10px] flex h-10 w-10 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]"><path d={TABLE_SETTINGS_ICON} /></svg>
                </button>
              </RefTip>
              <RefTip text={expanded ? t("Обычный вид") : t("Расширенный вид")} side="left">
                <button type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? t("Обычный вид") : t("Расширенный вид")} className="ml-[10px] flex h-10 w-10 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]"><path d={expanded ? FULLSCREEN_EXIT : FULLSCREEN} /></svg>
                </button>
              </RefTip>
            </div>
          </div>

          {/* Linko drops the toolbar with an empty result, so a search that finds nothing could not be cleared there;
              here the toolbar stays while a search is set and the robot replaces the table. */}
          {rows.length === 0 && report ? (
            <div className="bg-[url(/robot-empty.png)] bg-[length:200px] bg-center bg-no-repeat pt-[200px] text-center text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}</div>
          ) : (
          <div className="-mx-[30px]">
            <div className="overflow-x-auto px-px pt-[2px]">
              <table className="w-full min-w-[1100px] table-fixed border-collapse text-[13px] leading-[16.25px] text-[#333]">
                <colgroup>{shown.map((column) => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}</colgroup>
                <thead className="relative shadow-[0_4px_14px_rgba(0,0,0,0.15)]">
                  <tr className="h-[29px] bg-[#f0f4f9]">
                    {shown.map((column) => {
                      const dir = ordering === column.key ? "asc" : ordering === `-${column.key}` ? "desc" : null
                      return (
                        <th
                          key={column.key}
                          onClick={column.sortable ? () => sortBy(column.key) : undefined}
                          aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                          className={`border-b border-r border-[#efefef] p-[5px] text-center font-semibold text-[#374557] ${column.sortable ? "cursor-pointer select-none" : ""} ${dir === "asc" ? "shadow-[inset_0_3px_0_0_rgba(0,0,0,0.6)]" : dir === "desc" ? "shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.6)]" : ""}`}
                        >
                          {t(column.title)}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, index) => (
                    <tr key={row.id} className={index % 2 ? "bg-[#f4f8fb]" : "bg-white"}>
                      {shown.map((column) => {
                        if (column.key === "name") {
                          return (
                            <td key={column.key} className="border-b border-r border-[#efefef] px-[5px] py-[7px]">
                              <button type="button" onClick={() => update({ openOrdersDialog: String(row.id), dPage: null, dPageSize: null }, true)} className="block w-full truncate text-left hover:font-semibold hover:text-[#1E4A9A]">
                                {row.name}
                              </button>
                            </td>
                          )
                        }
                        if (column.key === "gears") return <td key={column.key} className="border-b border-r border-[#efefef] px-[5px] py-[7px]">{gearText(row.gears, t("шт."))}</td>
                        return <td key={column.key} className="border-b border-r border-[#efefef] px-[5px] py-[7px] text-right">{fmt(row[column.key])}</td>
                      })}
                    </tr>
                  ))}
                  {/* Linko's table keeps at least three rows: empty striped ones fill a shorter page. */}
                  {Array.from({ length: Math.max(0, 3 - pageRows.length) }, (_, index) => (
                    <tr key={`filler-${index}`} aria-hidden className={(pageRows.length + index) % 2 ? "bg-[#f4f8fb]" : "bg-white"}>
                      {shown.map((column) => <td key={column.key} className="h-[31px] border-b border-r border-[#efefef]" />)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      ) : (
        // Linko's emptyQuery: the robot over its text, no toolbar.
        <div className="bg-[url(/robot-empty.png)] bg-[length:200px] bg-center bg-no-repeat pt-[200px] text-center text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}</div>
      )}
    </>
  )

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title={t("Эффективность оборудования")} />
      </div>
      <section className="min-h-[calc(100vh-110px)] bg-white px-[30px] pb-[20px] pt-[20px] shadow-[0_-1px_6px_rgba(0,0,0,0.09),0_-1px_4px_rgba(0,0,0,0.1)]">{query ? content : null}</section>

      {columnsOpen && (
        <TableColumnsDrawer
          columns={COLUMNS}
          visible={visible}
          onSave={(next) => {
            setVisible(next)
            writeLocal(COLUMNS_KEY, next)
            setColumnsOpen(false)
          }}
          onClose={() => setColumnsOpen(false)}
        />
      )}
      {filterOpen && query && (
        <GearFilter
          query={query}
          options={options}
          onClose={() => setFilterOpen(false)}
          onApply={(patch) => {
            update({ ...patch, page: null })
            setFilterOpen(false)
          }}
          onReset={() => {
            const cleared: Record<string, null> = {}
            for (const key of [...LIST_KEYS, ...RANGE_KEYS, ...DATE_KEYS]) cleared[key] = null
            update({ ...cleared, page: null })
            setFilterOpen(false)
          }}
        />
      )}
      {openClient > 0 && query && (
        <ClientOrdersDialog
          client={rows.find((row) => row.id === openClient) ?? null}
          clientId={openClient}
          query={query}
          cardOpen={orderDetails > 0}
          onPage={(next) => update({ dPage: next.page > 1 ? String(next.page) : null, dPageSize: next.pageSize !== 25 ? String(next.pageSize) : null })}
          onOpenOrder={(id) => update({ orderDetails: String(id) }, true)}
          onClose={() => update({ openOrdersDialog: null, dPage: null, dPageSize: null }, true)}
        />
      )}
      {orderDetails > 0 && <ActivityOrderDialog orderId={orderDetails} onClose={() => update({ orderDetails: null }, true)} />}
    </ReportPage>
  )
}

/** The blue equipment count after a figure, with Linko's «Кол-во оборудования» hint under it. */
function GearCount({ value }: { value: number }) {
  const { t } = useLanguage()
  return (
    <RefTip text={t("Кол-во оборудования")} side="bottom">
      <span className="-mb-px ml-[7px] text-[#1E4A9A]">{fmt(value)}</span>
    </RefTip>
  )
}

/** A card's caption (Linko: a block span 13px #666, 10px above and 5px below; inside a row of its own, as the group
 * limits are, it takes that row's 20px lines). */
function Caption({ children, inRow = false }: { children: ReactNode; inRow?: boolean }) {
  return <span className={`mb-[5px] mt-[10px] block text-[13px] font-normal text-[#666] ${inRow ? "leading-5" : "leading-[16.25px]"}`}>{children}</span>
}

/** A card's figure line (Linko: 14px, 600, #333, 20px lines). */
function Figure({ children }: { children: ReactNode }) {
  return <div className="flex items-center text-[14px] font-semibold leading-5 text-[#333]">{children}</div>
}

/** The four summary cards of Linko's gear page. */
function Summary({ total, currency, limits, onLimits }: { total: Total | null; currency: string; limits: { first: number; second: number }; onLimits: (limits: { first: number; second: number }) => void }) {
  const { t } = useLanguage()
  const value = (key: keyof Omit<Total, "currency">) => total?.[key] ?? 0
  const groups = value("firstAmount") + value("secondAmount") + value("thirdAmount")
  const card = "w-[calc(100%/3-10px)] rounded-[2px] border-b border-r border-[#efefef] px-[15px] pb-[10px]"
  return (
    <div className="mt-[15px] flex justify-between border-b border-[#efefef] pb-[15px] pt-0 text-[#666]">
      <div className={card}>
        <Caption>{t("ОКВ / ОКВ с оборудованием")}</Caption>
        <Figure>
          {fmt(value("okb"))} / {fmt(value("okbGear"))} ({fmt(pct(value("okbGear"), value("okb")), "%")}) <GearCount value={value("okbGearCount")} />
        </Figure>
        <Caption>{t("АКВ / АКВ с оборудованием")}</Caption>
        <Figure>
          {fmt(value("akb"))} / {fmt(value("akbGear"))} ({fmt(pct(value("akbGear"), value("akb")), "%")}) <GearCount value={value("akbGearCount")} />
        </Figure>
      </div>
      <div className={card}>
        <Caption>{t("Средний чек одного оборудования")}</Caption>
        <Figure>{fmt(value("avgCheck"), currency)}</Figure>
        <div className="flex items-center">
          <Caption inRow>{t("От")} {fmt(0, currency)} {t("до")} {fmt(limits.first, currency)}</Caption>
        </div>
        <Figure>
          {fmt(value("firstAmount"), t("шт."))} ({pct(value("firstAmount"), groups)}%)<GearCount value={value("firstGearCount")} />
        </Figure>
      </div>
      <div className={card}>
        <LimitsEditor currency={currency} limits={limits} onSave={onLimits} />
        <Figure>
          {fmt(value("secondAmount"), t("шт."))} ({pct(value("secondAmount"), groups)}%) <GearCount value={value("secondGearCount")} />
        </Figure>
        <div className="flex items-center">
          <Caption inRow>{t("Больше")} {fmt(limits.second, currency)}</Caption>
        </div>
        <Figure>
          {fmt(value("thirdAmount"), t("шт."))} ({pct(value("thirdAmount"), groups)}%) <GearCount value={value("thirdGearCount")} />
        </Figure>
      </div>
      <div className={`${card} text-right`}>
        <Caption>{t("Фактическая продажа")}</Caption>
        <div className="text-[14px] font-semibold leading-5 text-[#333]">{fmt(value("totalFact"), currency)}</div>
        <Caption>{t("С оборудованием")}</Caption>
        <div className="text-[14px] font-semibold leading-5 text-[#333]">
          {fmt(value("totalFactGear"), currency)} ({fmt(pct(value("totalFactGear"), value("totalFact")), "%")})
        </div>
      </div>
    </div>
  )
}

/** «От 1 500 000 SUM до 3 000 000 SUM» with the pencil; editing shows two «Кол-во» fields, ✓ saves, ✕ cancels. */
function LimitsEditor({ currency, limits, onSave }: { currency: string; limits: { first: number; second: number }; onSave: (limits: { first: number; second: number }) => void }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState(String(limits.first))
  const [second, setSecond] = useState(String(limits.second))
  const field = (value: string, onChange: (value: string) => void) => (
    <label className="relative block h-[40px] min-w-0 flex-1">
      <span className={`pointer-events-none absolute left-0 transition-all ${value ? "top-[2px] text-[10px]" : "top-[16px] text-[13px]"} text-black/40`}>{t("Кол-во")}</span>
      <input type="number" value={value} onChange={(event) => onChange(event.target.value)} aria-label={t("Кол-во")} className="absolute inset-x-0 bottom-[2px] h-[22px] border-b border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none focus:border-b-2 focus:border-[#5d6474]" />
    </label>
  )
  return (
    <div className="flex items-center">
      {editing ? (
        <div className="flex w-[230px] items-center">
          <span className="mr-[10px] text-[13px] font-normal text-[#666]">{t("От")}</span>
          {field(first, setFirst)}
          <span className="mx-[10px] text-[13px] font-normal text-[#666]">{t("до")}</span>
          {field(second, setSecond)}
        </div>
      ) : (
        <Caption inRow>{t("От")} {fmt(limits.first, currency)} {t("до")} {fmt(limits.second, currency)}</Caption>
      )}
      {editing ? (
        <>
          <button
            type="button"
            aria-label={t("Сохранить")}
            onClick={() => {
              const next = { first: Number(first) || FIRST_DEFAULT, second: Number(second) || SECOND_DEFAULT }
              onSave(next)
              setEditing(false)
            }}
            className="flex h-[25px] w-[30px] items-center justify-center"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d={CHECK} /></svg>
          </button>
          <button
            type="button"
            aria-label={t("Отмена")}
            onClick={() => {
              setFirst(String(limits.first))
              setSecond(String(limits.second))
              setEditing(false)
            }}
            className="flex h-[25px] w-[30px] items-center justify-center"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={CLOSE} /></svg>
          </button>
        </>
      ) : (
        <button type="button" aria-label={t("Изменить")} onClick={() => setEditing(true)} className="flex h-[25px] w-[30px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={RI.edit} /></svg>
        </button>
      )}
    </div>
  )
}

/** Linko's MUI text field of a range («От» / «До»): the caption inside until a value is typed. */
function RangeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  return (
    <label className="relative mt-[7px] block h-[45px]">
      <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${value ? "top-[1px] text-[10px] leading-3" : "top-[13px] text-[13px] leading-[18px]"}`}>{t(label)}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.,-]/g, ""))}
        aria-label={t(label)}
        className="peer absolute inset-x-0 top-[14px] h-[22px] bg-transparent text-[13px] text-black outline-none"
      />
      <span className="absolute inset-x-0 top-[36px] h-px bg-[#e0e0e0]" />
      <span className="absolute inset-x-0 top-[35px] h-[2px] scale-x-0 bg-[#5d6474] transition-transform peer-focus:scale-x-100" />
    </label>
  )
}

/** A blue-underlined group title of the filter (Linko's sectionTitle). */
function SectionTitle({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return <div className={`${first ? "mt-[13px]" : "mt-[18px]"} mb-[4px] border-b-2 border-[#adbce8] pb-[2px] text-[12px] font-bold leading-[15px] tracking-[0.3px] text-[#6b7a99]`}>{children}</div>
}

const toOptions = (list: Option[] | undefined): LinkoOption[] | null => (list ? list.map((item) => ({ value: String(item.id), label: item.name })) : null)
const splitIds = (value: string | undefined) => (value ? value.split("-").filter(Boolean) : [])

/** The filter of Linko's gear page: «Клиенты и инвентарь» and «Заказы», four fields a row. */
function GearFilter({ query, options, onClose, onApply, onReset }: { query: Query; options: Options | null; onClose: () => void; onApply: (patch: Record<string, string | null>) => void; onReset: () => void }) {
  const { t } = useLanguage()
  const today = todayIso()
  const monthStart = `${today.slice(0, 8)}01`
  const monthEnd = (() => {
    const [year, month] = today.split("-").map(Number)
    return `${today.slice(0, 8)}${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`
  })()
  const [draft, setDraft] = useState<Query>(() => ({ ...query }))
  const list = (key: string) => splitIds(draft[key])
  const setList = (key: string) => (next: string[]) => setDraft((current) => ({ ...current, [key]: next.join("-") }))
  const set = (key: string) => (value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const clientTypes = options?.clientTypes ?? []
  const productTypes = options?.productTypes ?? []
  const typeParents = list("marketTypeParent")
  const typeChildren = clientTypes.filter((item) => item.parentId != null && typeParents.includes(String(item.parentId)))
  const productParents = list("productTypeForOrder")
  const productChildren = productTypes.filter((item) => item.parentId != null && productParents.includes(String(item.parentId)))

  function apply() {
    const patch: Record<string, string | null> = {}
    for (const key of [...LIST_KEYS, ...RANGE_KEYS, ...DATE_KEYS]) patch[key] = draft[key] ? draft[key] : null
    // The created period is Linko's date field: kept in the address once set, the month when never chosen.
    if (!patch.fromDate || !patch.toDate) {
      patch.fromDate = null
      patch.toDate = null
    }
    if (!typeParents.length) patch.marketType = null
    if (!productParents.length) patch.parentTypeForOrder = null
    onApply(patch)
  }

  return (
    <ReportFilterPanel normalCase onClose={onClose} onApply={apply} onReset={onReset}>
      <div className="col-span-full -mb-[1px]">
        <SectionTitle first>{t("Клиенты и инвентарь")}</SectionTitle>
        <div className="mb-[10px] grid grid-cols-4 items-end gap-x-[10px]">
          <div className="mt-[5px]"><LinkoMultiField label="Ответственный агент клиента" options={toOptions(options?.agents)} value={list("responsibleAgents")} onChange={setList("responsibleAgents")} /></div>
          <div className="mt-[5px]"><LinkoMultiField label="Организация инвентаря" options={toOptions(options?.divisions)} value={list("division")} onChange={setList("division")} /></div>
          <div className="mt-[5px]"><LinkoMultiField label="Зона" options={toOptions(options?.zones)} value={list("borders")} onChange={setList("borders")} /></div>
          <div className="mt-[5px]"><LinkoMultiField label="Филиалы" options={toOptions(options?.branches)} value={list("branch")} onChange={setList("branch")} /></div>
          <div className="mt-[5px]"><LinkoMultiField label="Инвентарь" options={toOptions(options?.gears)} value={list("gear")} onChange={setList("gear")} /></div>
          <div className="mt-[5px]"><LinkoMultiField label="Тип инвентаря (продукт)" options={toOptions(options?.gearProducts)} value={list("product")} onChange={setList("product")} /></div>
          <div className="mt-[5px]"><LinkoMultiField label="Тип клиента" options={toOptions(clientTypes.filter((item) => item.parentId == null))} value={typeParents} onChange={setList("marketTypeParent")} /></div>
          {typeParents.length > 0 && typeChildren.length > 0 && (
            <div className="mt-[5px]"><LinkoMultiField label="Подкатегория типа клиента" options={toOptions(typeChildren)} value={list("marketType")} onChange={setList("marketType")} /></div>
          )}
        </div>
        <SectionTitle>{t("Заказы")}</SectionTitle>
        <div className="mb-[19px] grid grid-cols-4 items-end gap-x-[10px]">
          <div className="pt-[5px]">
            <LinkoPeriodField
              label="Период по дате создания"
              begin={draft.fromDate || monthStart}
              end={draft.toDate || monthEnd}
              onChange={(begin, end) => setDraft((current) => ({ ...current, fromDate: begin, toDate: end }))}
            />
          </div>
          <div className="pt-[5px]">
            <LinkoPeriodField
              label="Период по дате реализации"
              begin={draft.acceptedDateBegin ?? ""}
              end={draft.acceptedDateEnd ?? ""}
              onChange={(begin, end) => setDraft((current) => ({ ...current, acceptedDateBegin: begin, acceptedDateEnd: end }))}
            />
          </div>
          <div>
            <p className="text-[13px] leading-4 text-[#333]">{t("Фактическая продажа")}</p>
            <div className="grid grid-cols-2 gap-[15px]">
              <RangeInput label="От" value={draft.factFrom ?? ""} onChange={set("factFrom")} />
              <RangeInput label="До" value={draft.factTo ?? ""} onChange={set("factTo")} />
            </div>
          </div>
          <div>
            <p className="text-[13px] leading-4 text-[#333]">{t("Факт продаж оборудования")}</p>
            <div className="grid grid-cols-2 gap-[15px]">
              <RangeInput label="От" value={draft.factByGearFrom ?? ""} onChange={set("factByGearFrom")} />
              <RangeInput label="До" value={draft.factByGearTo ?? ""} onChange={set("factByGearTo")} />
            </div>
          </div>
          <div className="mt-[5px]"><LinkoMultiField label="Продукт" options={toOptions(options?.products)} value={list("productForOrder")} onChange={setList("productForOrder")} /></div>
          <div className="mt-[5px]"><LinkoMultiField label="Тип товара заказа" options={toOptions(productTypes.filter((item) => item.parentId == null))} value={productParents} onChange={setList("productTypeForOrder")} /></div>
          {productParents.length > 0 && productChildren.length > 0 && (
            <div className="mt-[5px]"><LinkoMultiField label="Подкатегория типа товара заказа" options={toOptions(productChildren)} value={list("parentTypeForOrder")} onChange={setList("parentTypeForOrder")} /></div>
          )}
        </div>
      </div>
    </ReportFilterPanel>
  )
}

/** Linko's dottedList row of the orders window: 50px, 30px sides, a dotted line under every row but the last. */
const DOTTED_ROW =
  "relative flex h-[50px] items-center px-[30px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[linear-gradient(to_right,#d5d5d5_2px,transparent_2px)] after:bg-[length:6px_1px] last:after:hidden"
const ORDER_WIDTHS = ["9%", "21%", "14%", "19%", "15%", "15%"]

/** The client's orders window (Linko: a click on the client name, ?openOrdersDialog=<id>); a row opens the order. */
function ClientOrdersDialog({
  client,
  clientId,
  query,
  cardOpen,
  onPage,
  onOpenOrder,
  onClose,
}: {
  client: Row | null
  clientId: number
  query: Query
  /** The order card is open over the window: Escape closes the card first. */
  cardOpen: boolean
  onPage: (next: { page: number; pageSize: number }) => void
  onOpenOrder: (id: number) => void
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const [orders, setOrders] = useState<GearOrder[] | null>(null)
  const today = todayIso()
  const pageSize = Math.max(1, Math.min(2000, Number(query.dPageSize) || 25))
  const page = Math.max(1, Number(query.dPage) || 1)
  const ordersQuery = useMemo(() => {
    const params = new URLSearchParams()
    for (const key of ["fromDate", "toDate", "acceptedDateBegin", "acceptedDateEnd", "division", "productForOrder", "productTypeForOrder"]) if (query[key]) params.set(key, query[key])
    params.set("orders", String(clientId))
    return params.toString()
  }, [query, clientId])

  useEffect(() => {
    const controller = new AbortController()
    setOrders(null)
    fetch(`${API}?${ordersQuery}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<GearOrder[]>) : Promise.reject()))
      .then(setOrders)
      .catch((cause: unknown) => {
        if ((cause as { name?: string }).name !== "AbortError") setOrders([])
      })
    return () => controller.abort()
  }, [ordersQuery])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !cardOpen && !document.querySelector("[data-order-overlay]")) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, cardOpen])

  const cell = (index: number) => ({ flexBasis: ORDER_WIDTHS[index], maxWidth: ORDER_WIDTHS[index] })
  const shown = (orders ?? []).slice((page - 1) * pageSize, page * pageSize)
  const money = (value: number, currency: string) => `${formatMoney(value, 3)} ${currencyLabel(currency)}`
  return (
    <div className="fixed inset-0 z-[99] flex overflow-y-auto bg-black/[0.54]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="m-auto w-[1000px] max-w-[calc(100vw-32px)] bg-[#fcfcfc] text-[13px] text-[#333] shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]" role="dialog" aria-modal="true">
        <div className="flex h-[60px] items-center justify-between pl-[30px] pr-[10px] font-bold uppercase">
          <span>{client?.name ?? ""}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6 fill-[#666]"><path d={CLOSE} /></svg>
          </button>
        </div>
        <div className="flex h-[51px] items-center justify-end border-t border-[#efefef] px-[30px]">
          <BalancePagination page={page} pageSize={pageSize} count={orders?.length ?? 0} onChange={onPage} />
        </div>
        <div className="border-t border-[#efefef]">
          <div className={`${DOTTED_ROW} font-semibold text-[#666]`}>
            <div style={cell(0)} className="pr-[5px]">№ {t("заказа")}</div>
            <div style={cell(1)} className="px-[5px]">{t("Ожидаемая дата оплаты")}</div>
            <div style={cell(2)} className="px-[5px]">{t("Тип оплаты")}</div>
            <div style={cell(3)} className="px-[5px] text-right">{t("Сумма заказа")}</div>
            <div style={cell(4)} className="px-[5px] text-right">{t("Осталось")}</div>
            <div style={cell(5)} className="pl-[5px] text-center">{t("Статус")}</div>
          </div>
          {orders === null ? (
            <p className="py-[50px] text-center text-[#999]">{t("Загрузка...")}</p>
          ) : (
            shown.map((order) => (
              <div key={order.id} className={`${DOTTED_ROW} group cursor-pointer hover:bg-[#f2f5f8]`} onClick={() => onOpenOrder(order.id)}>
                <div style={cell(0)} className="pr-[5px]">{order.id}</div>
                <div style={cell(1)} className="px-[5px]">{order.paymentDate ? formatRuDate(order.paymentDate, false, language) : ""}</div>
                <div style={cell(2)} className="px-[5px]">{order.paymentType === "cash" ? `${t("Нал")}.` : `${t("Переч")}.`}</div>
                <div style={cell(3)} className="whitespace-nowrap px-[5px] text-right">{money(order.totalPrice, order.currency)}</div>
                <div style={cell(4)} className="whitespace-nowrap px-[5px] text-right">{money(order.remaining, order.currency)}</div>
                {/* Linko shows the status and payment icons of a row on hover only. */}
                <div style={cell(5)} className="flex justify-end pl-[5px] opacity-0 transition-opacity group-hover:opacity-100">
                  <OrderPaymentStatus row={{ ...order, paymentType: order.paymentType === "cash" ? "cash" : "bank" }} today={today} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
