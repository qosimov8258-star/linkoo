"use client"

import { Fragment, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bookmark, Download, FolderOpen } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage, ReportRangeField } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { CheckRow, DEFAULT_OPTIONS, OptionsPanelBody, Panel, toggleIn, usePanelDismiss, type TableOptions } from "./builder-panels"
import { currentMonthRange, isCountedOrder, useBuilderOrders, type BuilderOrder } from "./builder-orders"

const measures = ["Сумма продаж", "Количество заказов", "Количество клиентов", "Средний чек"]
const horizontalGroupings = ["По месяцам", "По кварталам"]
type PanelKey = "columns" | "table" | "vertical" | "horizontal" | "filters"

/** Vertical grouping label (a Russian i18n key) → the order's value. */
const VERTICAL_KEY: Record<string, (order: BuilderOrder) => string> = {
  "Филиал": (order) => order.branch || "Не указано",
  "Агент": (order) => order.agent || "Не указано",
  "Склад": (order) => order.warehouse || "Не указано",
  "Организация": (order) => order.organization || "Не указано",
  "Статус": (order) => order.status || "Не указано",
}
const verticalGroupings = Object.keys(VERTICAL_KEY)
const CURRENCY_LABEL = "Валюта"
/** Measures in money: their figures are only meaningful with the currency next to them. */
const MONEY_MEASURES = new Set(["Сумма продаж", "Средний чек"])
const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

/** Measures over real orders; money measures stay within one currency (see `byCurrency`). */
function aggregate(measure: string, rows: BuilderOrder[]) {
  const sum = rows.reduce((total, order) => total + order.amount, 0)
  const orders = rows.length
  if (measure === "Сумма продаж") return Math.round(sum * 100) / 100
  if (measure === "Количество заказов") return orders
  if (measure === "Количество клиентов") return new Set(rows.map((order) => (order.clientId != null ? `id:${order.clientId}` : `name:${order.client}`))).size
  return orders ? Math.round(sum / orders) : 0
}

/** The month ("2026-10") or quarter ("2026-Q4") buckets of the period, in order. */
function periodKeys(from: string, to: string, quarterly: boolean): string[] {
  const keys: string[] = []
  const [fromYear, fromMonth] = from.split("-").map(Number)
  const [toYear, toMonth] = to.split("-").map(Number)
  if (!fromYear || !fromMonth || !toYear || !toMonth) return keys
  // Months as a running index (year * 12 + month), capped at 20 years of columns.
  const last = Math.min(toYear * 12 + toMonth - 1, fromYear * 12 + fromMonth - 1 + 240)
  for (let index = fromYear * 12 + fromMonth - 1; index <= last; index++) {
    const year = Math.floor(index / 12)
    const month = (index % 12) + 1
    const key = quarterly ? `${year}-Q${Math.ceil(month / 3)}` : `${year}-${String(month).padStart(2, "0")}`
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}
const periodOfDay = (day: string, quarterly: boolean) => (quarterly ? `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}` : day.slice(0, 7))
const periodLabel = (key: string) => (key.includes("Q") ? `${key.slice(5)} ${key.slice(0, 4)}` : `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`)

export type OldReportSettings = {
  chosen: string[]
  statusFilter: string[]
  quickFilter: string
  vertical: string[]
  horizontal: string[]
  period: { from: string; to: string }
}

/**
 * The builder's table over the orders of the period. Cancelled / unconfirmed orders are not sales
 * unless the status filter asks for them. Money is never shown without its currency, and money of
 * different currencies is never added up: with a money measure chosen, the currency is the last
 * grouping column and the bottom totals come one row per currency of the rows shown ("Итого SUM"),
 * even when they hold a single currency.
 */
export function oldReportTable(inPeriod: BuilderOrder[], settings: OldReportSettings) {
  const { chosen, statusFilter, quickFilter, vertical, horizontal, period } = settings
  const byCurrency = chosen.some((measure) => MONEY_MEASURES.has(measure))
  const query = quickFilter.trim().toLowerCase()
  const scope = inPeriod.filter((order) =>
    (statusFilter.length ? statusFilter.includes(order.status) : isCountedOrder(order.status)) &&
    (!query || [order.client, ...vertical.map((label) => VERTICAL_KEY[label]?.(order) ?? "")].some((value) => value.toLowerCase().includes(query))),
  )
  const accessors = [...vertical.map((label) => VERTICAL_KEY[label]).filter(Boolean), ...(byCurrency ? [(order: BuilderOrder) => order.currency] : [])]
  const groups = new Map<string, { keys: string[]; rows: BuilderOrder[] }>()
  for (const rec of scope) {
    const keys = accessors.map((fn) => fn(rec))
    const id = keys.join("\u0000")
    const group = groups.get(id) ?? { keys, rows: [] }
    group.rows.push(rec)
    groups.set(id, group)
  }
  const body = [...groups.values()].sort((x, y) => x.keys.join("\u0000").localeCompare(y.keys.join("\u0000"), "ru"))
  // Without groupings every order falls into the one group with no keys (a single "Все" row).
  const quarterly = horizontal[0] === "По кварталам"
  const periods = horizontal.length ? periodKeys(period.from, period.to, quarterly) : []
  const cellsFor = (rows: BuilderOrder[]) => chosen.map((measure) => ({
    periods: periods.map((key) => aggregate(measure, rows.filter((order) => periodOfDay(order.day, quarterly) === key))),
    total: aggregate(measure, rows),
  }))
  const rows = body.map((g) => ({ keys: g.keys, cells: cellsFor(g.rows) }))
  const spans = rows.map((row, i) => row.keys.map((_, c) => {
    const same = (j: number) => j > 0 && rows[j].keys.slice(0, c + 1).join("\u0000") === rows[j - 1].keys.slice(0, c + 1).join("\u0000")
    if (same(i)) return 0
    let n = 1
    while (i + n < rows.length && same(i + n)) n++
    return n
  }))
  const currencies = [...new Set(scope.map((order) => order.currency))].sort()
  const totals = byCurrency
    ? currencies.map((currency) => ({ label: currency, cells: cellsFor(scope.filter((order) => order.currency === currency)) }))
    : [{ label: "", cells: cellsFor(scope) }]
  return { periods, rows, totals, spans, byCurrency, count: scope.length }
}

const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
const LINK = "text-[13px] text-[#4f71dc]"
const CHIP = "flex h-[32px] w-[114px] flex-col items-center justify-center rounded-[3px] bg-[#4f71dc] px-1 text-center text-[13px] font-semibold leading-[15px] text-white hover:brightness-95"

const VIEW_ICONS = [
  "M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z",
  "M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z",
  "M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z",
  "M10 10.02h5V21h-5zM17 21h3c1.1 0 2-.9 2-2v-9h-5v11zm3-18H5c-1.1 0-2 .9-2 2v3h19V5c0-1.1-.9-2-2-2zM3 19c0 1.1.9 2 2 2h3V10H3v9z",
]

export function OldReportBuilderView() {
  const router = useRouter()
  const { t } = useLanguage()
  const { orders, loading, error } = useBuilderOrders(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [period, setPeriod] = useState(currentMonthRange)
  const [saved, setSaved] = useState(false)
  const [options, setOptions] = useState<TableOptions>(DEFAULT_OPTIONS)
  const [vertical, setVertical] = useState<string[]>([])
  const [horizontal, setHorizontal] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [open, setOpen] = useState<PanelKey | null>(null)
  const [dChosen, setDChosen] = useState<string[]>([])
  const [dOptions, setDOptions] = useState<TableOptions>(DEFAULT_OPTIONS)
  const [dVertical, setDVertical] = useState<string[]>([])
  const [dHorizontal, setDHorizontal] = useState<string[]>([])
  const [dStatusFilter, setDStatusFilter] = useState<string[]>([])
  const [quickFilterOpen, setQuickFilterOpen] = useState(false)
  const [quickFilter, setQuickFilter] = useState("")
  const [view, setView] = useState(3)
  const toolbarRef = useRef<HTMLDivElement>(null)

  const openPanel = (key: PanelKey) => {
    if (open === key) return setOpen(null)
    setQuickFilterOpen(false)
    setDChosen(chosen); setDOptions(options); setDVertical(vertical); setDHorizontal(horizontal); setDStatusFilter(statusFilter)
    setOpen(key)
  }
  const accept = () => {
    if (open === "columns") setChosen(dChosen)
    if (open === "table") setOptions(dOptions)
    if (open === "vertical") setVertical(dVertical)
    if (open === "horizontal") setHorizontal(dHorizontal)
    if (open === "filters") setStatusFilter(dStatusFilter)
    setOpen(null)
  }
  usePanelDismiss(open !== null, toolbarRef, () => setOpen(null))

  // Statuses of the loaded orders, for the "Фильтры" panel.
  const statuses = useMemo(() => [...new Set(orders.map((order) => order.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")), [orders])
  // Orders of the period; cancelled / unconfirmed ones are not sales unless the status filter asks for them.
  const inPeriod = useMemo(() => orders.filter((order) => order.day && order.day >= period.from && order.day <= period.to), [orders, period])
  const table = useMemo(
    () => oldReportTable(inPeriod, { chosen, statusFilter, quickFilter, vertical, horizontal, period }),
    [inPeriod, chosen, statusFilter, quickFilter, vertical, horizontal, period],
  )

  const fmt = (value: number) => (options.formatted ? value.toLocaleString("ru-RU") : String(value))
  const groupLabels = [...(vertical.length ? vertical : ["Все"]), ...(table.byCurrency ? [CURRENCY_LABEL] : [])]
  const showPeriods = table.periods.length > 0
  // with periods the per-measure "Итого" column is the right-hand total; without them the single value column already is the total
  const rightTotal = options.totalsRight && showPeriods

  const download = () => {
    const header = [...groupLabels.map((g) => t(g)), ...chosen.flatMap((m) => [...table.periods.map((p) => `${t(m)} ${t(periodLabel(p))}`), ...(rightTotal ? [`${t(m)} ${t("Итого")}`] : showPeriods ? [] : [t(m)])])]
    const rows = table.rows.map((row) => [...(vertical.length ? [] : [t("Все")]), ...row.keys, ...row.cells.flatMap((c) => [...c.periods, ...(rightTotal || !showPeriods ? [c.total] : [])])])
    const footer = options.totalsBottom ? table.totals.map((total) => [`${t("Итого")}${total.label ? ` ${total.label}` : ""}`, ...groupLabels.slice(1).map(() => ""), ...total.cells.flatMap((c) => [...c.periods, ...(rightTotal || !showPeriods ? [c.total] : [])])]) : []
    downloadExcelTable("old-report-builder.xls", [header, ...rows, ...footer])
  }
  const save = async () => {
    try {
      const config = { chosen, options, vertical, horizontal, statusFilter, from: period.from, to: period.to }
      const response = await fetch("/api/old-saved-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Отчёт ${new Date().toLocaleString("ru-RU")}`, config }),
      })
      if (response.ok) {
        setSaved(true)
        window.setTimeout(() => setSaved(false), 1800)
      }
    } catch {
      // ignore network failures, no flash on failure
    }
  }
  const cell = "border border-[#ececec] px-3 py-2"

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Конструктор отчетов")} /></div>

      <section className={`mx-7 ${CARD}`}>
        <div className="relative flex h-[48px] items-center border-b border-[#ececec] px-[38px]">
          <div className="w-[300px] pt-[2px]"><ReportRangeField label="Период" from={period.from} to={period.to} onFrom={(from) => setPeriod((current) => ({ from, to: current.to < from ? from : current.to }))} onTo={(to) => setPeriod((current) => ({ from: current.from > to ? to : current.from, to }))} /></div>
          <div className="ml-auto flex gap-[1px]">
            {VIEW_ICONS.map((path, index) => (
              <button key={index} type="button" onClick={() => setView(index)} aria-label={`view-${index}`} className={`flex h-[26px] w-[48px] items-center justify-center rounded-[3px] ${view === index ? "bg-[#4f71dc]" : "bg-[#e0e0e0]"}`}>
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d={path} /></svg>
              </button>
            ))}
          </div>
        </div>
        <div ref={toolbarRef} className="relative flex flex-wrap items-center gap-[14px] px-[30px] py-[8px]">
          <button onClick={() => openPanel("columns")} className={LINK}>{t("Колонки")} ⌄</button>
          <button onClick={download} className="ml-[60px] flex h-[32px] items-center rounded-[3px] bg-[#4db6ac] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Download className="mr-3 h-[16px] w-[16px]" />{t("Скачать")}</button>
          <button onClick={() => void save()} className="flex h-[32px] items-center rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Bookmark className="mr-3 h-[16px] w-[16px] fill-white" />{saved ? t("Сохранено ✓") : t("Сохранить")}</button>
          <button onClick={() => router.push("/analytics/report-list")} className="flex h-[32px] items-center rounded-[3px] bg-[#ff8a6f] px-4 text-[13px] font-semibold text-white hover:brightness-95"><FolderOpen className="mr-3 h-[16px] w-[16px] fill-white" />{t("Отчеты")}</button>
          <button onClick={() => router.push("/analytics/flexible-dashboard")} className="flex h-[32px] items-center rounded-[3px] bg-[#ff8a6f] px-4 text-[13px] font-semibold text-white hover:brightness-95"><FolderOpen className="mr-3 h-[16px] w-[16px] fill-white" />{t("Виджеты")}</button>
          <div className="ml-auto flex items-center gap-[14px]">
            <button onClick={() => openPanel("table")} className={CHIP}><span>{t("Оптимизация таблицы")} ⌄</span></button>
            <button onClick={() => openPanel("vertical")} className={CHIP}><span>{t("Вертикальная группировка")} ⌄</span></button>
            <button onClick={() => openPanel("horizontal")} className={CHIP}><span>{t("Горизонтальная группировка")} ⌄</span></button>
            <button onClick={() => openPanel("filters")} className={LINK}>{t("Фильтры")}{statusFilter.length ? ` (${statusFilter.length})` : ""} ⌄</button>
            <div className="relative">
              <button onClick={() => { setOpen(null); setQuickFilterOpen((v) => !v) }} className={LINK}>{t("Быстрый фильтр")} ⌄</button>
              {quickFilterOpen && <div className="absolute right-0 top-full z-20 mt-1 w-64 border border-[#e8e8e8] bg-white p-3 shadow-xl"><input autoFocus value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)} placeholder={`${t("Поиск")}...`} className="w-full border-b border-[#e0e0e0] py-2 text-[13px] outline-none" /></div>}
            </div>
          </div>

          {open === "columns" && (
            <Panel title={t("Колонки")} onClose={() => setOpen(null)} onAccept={accept} className="left-[30px]">
              {measures.map((item) => <CheckRow key={item} checked={dChosen.includes(item)} onChange={() => setDChosen(toggleIn(dChosen, item))}>{t(item)}</CheckRow>)}
            </Panel>
          )}
          {open === "table" && (
            <Panel title={t("Оптимизация таблицы")} onClose={() => setOpen(null)} onAccept={accept} className="right-[330px]">
              <OptionsPanelBody value={dOptions} onChange={setDOptions} />
            </Panel>
          )}
          {open === "vertical" && (
            <Panel title={t("Вертикальная группировка")} onClose={() => setOpen(null)} onAccept={accept} className="right-[200px]">
              {verticalGroupings.map((item) => <CheckRow key={item} checked={dVertical.includes(item)} onChange={() => setDVertical(toggleIn(dVertical, item))}>{t(item)}</CheckRow>)}
            </Panel>
          )}
          {open === "horizontal" && (
            <Panel title={t("Горизонтальная группировка")} onClose={() => setOpen(null)} onAccept={accept} className="right-[120px]">
              {horizontalGroupings.map((item) => <CheckRow key={item} checked={dHorizontal.includes(item)} onChange={() => setDHorizontal(dHorizontal.includes(item) ? [] : [item])}>{t(item)}</CheckRow>)}
            </Panel>
          )}
          {open === "filters" && (
            <Panel title={t("Фильтры")} onClose={() => setOpen(null)} onAccept={accept} className="right-[60px]">
              <p className="pb-1 text-[13px] font-semibold uppercase text-[#4f71dc]">{t("Статус")}</p>
              {statuses.length === 0 && <p className="py-2 text-[13px] text-[#999]">{t("Нет данных")}</p>}
              {statuses.map((item) => <CheckRow key={item} checked={dStatusFilter.includes(item)} onChange={() => setDStatusFilter(toggleIn(dStatusFilter, item))}>{t(item)}</CheckRow>)}
            </Panel>
          )}
        </div>
      </section>

      <section className={`mx-7 mt-[20px] ${CARD}`}>
        {chosen.length === 0 ? (
          <ReportEmpty className="pb-[34px] pt-[10px]" text={t("Выберите замеры и группировки, затем примените изменения")} />
        ) : loading ? (
          <ReportEmpty className="pb-[34px] pt-[10px]" text={t("Загрузка...")} />
        ) : error ? (
          <ReportEmpty className="pb-[34px] pt-[10px]" text={t(error)} />
        ) : table.count === 0 ? (
          <ReportEmpty className="pb-[34px] pt-[10px]" text={t("Нет данных за выбранный период")} />
        ) : (
          <div className="overflow-x-auto p-6">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#f2f5f8]">
                  {groupLabels.map((g) => <th key={g} rowSpan={showPeriods ? 2 : 1} className={`${cell} text-left`}>{t(g)}</th>)}
                  {chosen.map((m) => <th key={m} colSpan={showPeriods ? table.periods.length + (rightTotal ? 1 : 0) : 1} className={`${cell} ${showPeriods ? "text-center" : "text-right"}`}>{t(m)}</th>)}
                </tr>
                {showPeriods && (
                  <tr className="bg-[#f2f5f8]">
                    {chosen.map((m) => (
                      <Fragment key={m}>
                        {table.periods.map((p) => <th key={p} className={`${cell} text-right font-medium`}>{t(periodLabel(p))}</th>)}
                        {rightTotal && <th className={`${cell} text-right`}>{t("Итого")}</th>}
                      </Fragment>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {vertical.length === 0 && <td className={cell}>{t("Все")}</td>}
                    {row.keys.map((key, c) => {
                      const span = table.spans[i][c]
                      if (options.merge) return span ? <td key={c} rowSpan={span} className={`${cell} align-top`}>{t(key)}</td> : null
                      return <td key={c} className={cell}>{t(key)}</td>
                    })}
                    {row.cells.map((c, m) => (
                      <Fragment key={m}>
                        {showPeriods ? c.periods.map((v, p) => <td key={p} className={`${cell} text-right`}>{fmt(v)}</td>) : <td className={`${cell} text-right`}>{fmt(c.total)}</td>}
                        {rightTotal && <td className={`${cell} bg-[#fafbfc] text-right font-semibold`}>{fmt(c.total)}</td>}
                      </Fragment>
                    ))}
                  </tr>
                ))}
                {options.totalsBottom && table.totals.map((total) => (
                  <tr key={total.label || "total"} className="bg-[#f2f5f8] font-bold">
                    <td colSpan={groupLabels.length} className={cell}>{t("Итого")}{total.label ? ` ${total.label}` : ""}</td>
                    {total.cells.map((c, m) => (
                      <Fragment key={m}>
                        {showPeriods ? c.periods.map((v, p) => <td key={p} className={`${cell} text-right`}>{fmt(v)}</td>) : <td className={`${cell} text-right`}>{fmt(c.total)}</td>}
                        {rightTotal && <td className={`${cell} text-right`}>{fmt(c.total)}</td>}
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ReportPage>
  )
}
