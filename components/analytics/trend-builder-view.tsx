"use client"

import { useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Download, FolderOpen, Plus, Trash2 } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportChipField, ReportEmpty, ReportPage } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { CheckRow, DEFAULT_OPTIONS, OptionsPanelBody, Panel, toggleIn, usePanelDismiss, type TableOptions } from "./builder-panels"

type Rec = Record<string, string | number>
type PanelKey = "columns" | "table" | "vertical" | "filters"
type DateFilter = { from: string; to: string }

const measures = ["Сумма заказов", "Количество заказов", "Количество клиентов", "Средний чек"]

const AGENTS = ["Алишер", "Бобур", "Дилшод", "Азиз"]
const DRIVERS = ["Рустам", "Сардор", "Жасур"]
const COLLECTORS = ["Нодира", "Комила"]
const STORES = ["Магазин Off", "Мини-маркет Сафо", "Оптовик Анвар", "Гастроном 7", "Супермаркет Олтин"]
const BRANDS = ["Coca-Cola", "Nestle", "Pepsi", "Lays"]
const BRANCHES = ["Ташкент", "Самарканд"]
const WAREHOUSES = ["Главный склад", "Склад №2"]
const ORGS = ["Linko Distribution", "Linko Trade"]
const PRODUCTS = ["Сок яблочный 1л", "Вода 0.5л", "Чипсы 150г", "Шоколад 90г", "Лимонад 1.5л", "Печенье 200г"]

/** Deterministic demo dataset of order products so the table is stable between renders. */
const RECORDS: Rec[] = Array.from({ length: 90 }, (_, i) => {
  const day = 1 + ((i * 7) % 31)
  const store = i % STORES.length
  const product = (i * 3) % PRODUCTS.length
  return {
    date: `2026-08-${String(day).padStart(2, "0")}`,
    orderId: 1000 + Math.floor(i / 2),
    clientId: 200 + store * 11 + (i % 3),
    agent: AGENTS[i % AGENTS.length],
    driver: DRIVERS[i % DRIVERS.length],
    collector: COLLECTORS[i % COLLECTORS.length],
    store: STORES[store],
    storeNo: store + 1,
    inn: `30${1000000 + store * 7919}`,
    brand: BRANDS[product % BRANDS.length],
    org: ORGS[i % ORGS.length],
    branch: BRANCHES[i % BRANCHES.length],
    warehouse: WAREHOUSES[i % WAREHOUSES.length],
    product: PRODUCTS[product],
    productId: 500 + product,
    code: `P-${100 + product}`,
    article: `ART-${product + 1}`,
    barcode: `478${String(1000000000 + product * 12345).slice(0, 10)}`,
    qty: 3 + ((i * 5) % 17),
    amount: 90000 + ((i * 37) % 23) * 21000,
  }
})

const DAY = 86400000
const toTime = (iso: string) => new Date(`${iso}T00:00:00`).getTime()
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("ru-RU")
const weekStart = (iso: string) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtDate(d.getTime()) }

/** Vertical grouping label -> accessor. Labels are Russian i18n keys. */
const GROUPINGS: [string, (r: Rec) => string | number][] = [
  ["Дата по дням", (r) => fmtDate(toTime(String(r.date)))],
  ["Дата по неделям", (r) => weekStart(String(r.date))],
  ["Дата по месяцам", (r) => String(r.date).slice(0, 7)],
  ["Дата по годам", (r) => String(r.date).slice(0, 4)],
  ["Доставщик", (r) => r.driver],
  ["Коллектор", (r) => r.collector],
  ["Магазин", (r) => r.store],
  ["ИНН магазина", (r) => r.inn],
  ["№ магазина", (r) => r.storeNo],
  ["Бренд", (r) => r.brand],
  ["Организация", (r) => r.org],
  ["Филиал", (r) => r.branch],
  ["Склад", (r) => r.warehouse],
  ["Ответственный агент магазина", (r) => r.agent],
  ["ИД продукта", (r) => r.productId],
  ["Продукт", (r) => r.product],
  ["Артикул продукта", (r) => r.article],
  ["Код продукта", (r) => r.code],
  ["Штрих-код продукта", (r) => r.barcode],
]
const GROUPING_KEYS = new Map(GROUPINGS)

function aggregate(measure: string, rows: Rec[]): number {
  if (!rows.length) return 0
  const sum = rows.reduce((s, r) => s + Number(r.amount), 0)
  const orders = new Set(rows.map((r) => r.orderId)).size
  if (measure === "Сумма заказов") return sum
  if (measure === "Количество заказов") return orders
  if (measure === "Количество клиентов") return new Set(rows.map((r) => r.clientId)).size
  return orders ? Math.round(sum / orders) : 0
}

export function TrendBuilderView() {
  const router = useRouter()
  const { t } = useLanguage()
  const [columns, setColumns] = useState<string[]>([])
  const [model, setModel] = useState("Продукты заказов по дате создания")
  const [saved, setSaved] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [from, setFrom] = useState("2026-08-01")
  const [to, setTo] = useState("2026-08-31")
  const [options, setOptions] = useState<TableOptions>(DEFAULT_OPTIONS)
  const [vertical, setVertical] = useState<string[]>([])
  const [dateFilters, setDateFilters] = useState<DateFilter[]>([])
  const [open, setOpen] = useState<PanelKey | null>(null)
  const [dColumns, setDColumns] = useState<string[]>([])
  const [dOptions, setDOptions] = useState<TableOptions>(DEFAULT_OPTIONS)
  const [dVertical, setDVertical] = useState<string[]>([])
  const [dFilters, setDFilters] = useState<DateFilter[]>([])
  const toolbarRef = useRef<HTMLDivElement>(null)

  const openPanel = (key: PanelKey) => {
    if (open === key) return setOpen(null)
    setDColumns(columns); setDOptions(options); setDVertical(vertical); setDFilters(dateFilters)
    setOpen(key)
  }
  const accept = () => {
    if (open === "columns") setColumns(dColumns)
    if (open === "table") setOptions(dOptions)
    if (open === "vertical") setVertical(dVertical)
    if (open === "filters") setDateFilters(dFilters.filter((f) => f.from && f.to))
    setOpen(null)
  }

  usePanelDismiss(open !== null, toolbarRef, () => setOpen(null))

  const selected = columns
  const table = useMemo(() => {
    const start = toTime(from)
    const end = toTime(to)
    const spanDays = Math.max(1, Math.round((end - start) / DAY) + 1)
    const step = Math.max(7, Math.ceil(spanDays / 12))
    const periodCount = Math.ceil(spanDays / step)
    const periods = Array.from({ length: periodCount }, (_, i) => fmtDate(start + i * step * DAY))
    const inScope = RECORDS.filter((r) => {
      const time = toTime(String(r.date))
      return time >= start && time <= end && dateFilters.every((f) => time >= toTime(f.from) && time <= toTime(f.to))
    })
    const accessors = vertical.map((label) => GROUPING_KEYS.get(label)).filter((fn): fn is (r: Rec) => string | number => !!fn)
    const groups = new Map<string, { keys: (string | number)[]; rows: Rec[] }>()
    for (const rec of inScope) {
      const keys = accessors.map((fn) => fn(rec))
      const id = keys.join("\u0000")
      const group = groups.get(id) ?? { keys, rows: [] }
      group.rows.push(rec)
      groups.set(id, group)
    }
    const sorted = [...groups.values()].sort((a, b) => a.keys.join("\u0000").localeCompare(b.keys.join("\u0000"), "ru", { numeric: true }))
    if (!accessors.length) sorted.push({ keys: [], rows: inScope })
    const periodOf = (r: Rec) => Math.min(periodCount - 1, Math.floor((toTime(String(r.date)) - start) / DAY / step))
    const cellsFor = (rows: Rec[]) => selected.map((measure) => ({
      periods: periods.map((_, p) => aggregate(measure, rows.filter((r) => periodOf(r) === p))),
      total: aggregate(measure, rows),
    }))
    const body = sorted.map((g) => ({ keys: g.keys, cells: cellsFor(g.rows) }))
    const totals = cellsFor(inScope)
    // rowSpan for "Объединение ячеек": a cell starts a span when its key prefix differs from the previous row
    const spans = body.map((row, i) => row.keys.map((_, c) => {
      const sameAsPrev = (j: number) => j > 0 && body[j].keys.slice(0, c + 1).join("\u0000") === body[j - 1].keys.slice(0, c + 1).join("\u0000")
      if (sameAsPrev(i)) return 0
      let n = 1
      while (i + n < body.length && sameAsPrev(i + n)) n++
      return n
    }))
    return { periods, body, totals, spans }
  }, [from, to, dateFilters, vertical, selected])

  const fmt = (value: number) => (options.formatted ? value.toLocaleString("ru-RU") : String(value))
  const groupLabels = vertical.length ? vertical : ["Все"]

  const exportExcel = () => {
    const header = [...groupLabels.map((g) => t(g)), ...selected.flatMap((m) => [...table.periods.map((p) => `${t(m)} ${p}`), ...(options.totalsRight ? [`${t(m)} ${t("Итого")}`] : [])])]
    const rows = table.body.map((row) => [...(vertical.length ? row.keys : [t("Все")]), ...row.cells.flatMap((c) => [...c.periods, ...(options.totalsRight ? [c.total] : [])])])
    const footer = options.totalsBottom ? [[t("Итого"), ...groupLabels.slice(1).map(() => ""), ...table.totals.flatMap((c) => [...c.periods, ...(options.totalsRight ? [c.total] : [])])]] : []
    downloadExcelTable("trend-report.xls", [header, ...rows, ...footer])
  }
  const addToReports = async () => {
    try {
      const response = await fetch("/api/trend-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Тренд ${from} - ${to}`,
          config: { columns: selected, from, to, options, vertical, dateFilters },
        }),
      })
      if (response.ok) setSaved(true)
    } catch {
      // network error - keep the button in its non-saved state
    }
  }

  const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
  const SMALL = "flex h-[28px] items-center rounded-[3px] px-[14px] text-[13px] font-semibold text-white hover:brightness-95"
  const CHIP = "flex h-[32px] w-[114px] items-center justify-center rounded-[3px] bg-[#4f71dc] px-1 text-center text-[13px] font-semibold leading-[15px] text-white hover:brightness-95"
  const cell = "border border-[#ececec] px-3 py-2"

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Тенденция")} /></div>

      <section className={`mx-7 ${CARD}`}>
        <div className="relative flex h-[48px] items-center border-b border-[#ececec] px-[20px]">
          <div className="relative">
            <button onClick={() => setDateOpen((v) => !v)} className={`${SMALL} bg-[#4f71dc]`}>⌄ <span className="ml-2">{t("Сверка даты")}</span></button>
            {dateOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 flex gap-4 border border-[#e8e8e8] bg-white p-4 shadow-xl">
                <label className="text-[11px]">{t("От")}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 block border-b py-1 text-[13px]" /></label>
                <label className="text-[11px]">{t("До")}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1 block border-b py-1 text-[13px]" /></label>
              </div>
            )}
          </div>
          <div className="absolute left-[518px] top-[8px] w-[270px]"><ReportChipField label={t("Модель")} value={model} options={["Продукты заказов по дате создания", "Заказы и возвраты"]} onChange={setModel} /></div>
        </div>

        <div ref={toolbarRef} className="relative flex flex-wrap items-center gap-[14px] px-[30px] py-[8px]">
          <button onClick={() => openPanel("columns")} className={`${SMALL} bg-[#4f71dc]`}>⌄ <span className="ml-2">{t("Колонки")}</span></button>
          <button onClick={exportExcel} className={`${SMALL} bg-[#71ce87]`}><Download className="mr-2 h-4 w-4" />{t("Сформировать Excel")}</button>
          <button onClick={addToReports} className={`${SMALL} bg-[#ff8a6f]`}><span className="mr-2">★</span>{saved ? t("Добавлено") : t("Добавить в отчеты")}</button>
          <button onClick={() => router.push("/analytics/report-list")} className={`${SMALL} bg-[#ff8a6f]`}><FolderOpen className="mr-2 h-4 w-4 fill-white" />{t("Отчеты")} (1)</button>
          <div className="ml-auto flex items-center gap-[14px]">
            <button onClick={() => openPanel("table")} className={CHIP}>{t("Оптимизация таблицы")} ⌄</button>
            <button onClick={() => openPanel("vertical")} className={CHIP}>{t("Вертикальная группировка")} ⌄</button>
            <button onClick={() => openPanel("filters")} className={`${SMALL} ml-[36px] w-[110px] justify-center bg-[#4f71dc]`}>⌄ <span className="ml-2">{t("Фильтры")}{dateFilters.length ? ` (${dateFilters.length})` : ""}</span></button>
          </div>

          {open === "columns" && (
            <Panel title={t("Колонки")} onClose={() => setOpen(null)} onAccept={accept} className="left-[30px]">
              {measures.map((item) => <CheckRow key={item} checked={dColumns.includes(item)} onChange={() => setDColumns(toggleIn(dColumns, item))}>{t(item)}</CheckRow>)}
            </Panel>
          )}
          {open === "table" && (
            <Panel title={t("Оптимизация таблицы")} onClose={() => setOpen(null)} onAccept={accept} className="right-[190px]">
              <OptionsPanelBody value={dOptions} onChange={setDOptions} />
            </Panel>
          )}
          {open === "vertical" && (
            <Panel title={t("Вертикальная группировка")} onClose={() => setOpen(null)} onAccept={accept} className="right-[60px]">
              {GROUPINGS.map(([label]) => <CheckRow key={label} checked={dVertical.includes(label)} onChange={() => setDVertical(toggleIn(dVertical, label))}>{t(label)}</CheckRow>)}
            </Panel>
          )}
          {open === "filters" && (
            <Panel title={t("Фильтры")} onClose={() => setOpen(null)} onAccept={accept} className="right-[20px]">
              <div className="border-t border-[#e0e0e0]">
                {dFilters.map((filter, index) => (
                  <div key={index} className="flex items-end gap-3 border-b border-[#eee] py-3">
                    <label className="flex-1 text-[11px]">{t("От")}<input type="date" value={filter.from} max={filter.to || undefined} onChange={(e) => setDFilters(dFilters.map((f, i) => i === index ? { ...f, from: e.target.value } : f))} className="block w-full border-b py-1 text-[13px]" /></label>
                    <label className="flex-1 text-[11px]">{t("До")}<input type="date" value={filter.to} min={filter.from || undefined} onChange={(e) => setDFilters(dFilters.map((f, i) => i === index ? { ...f, to: e.target.value } : f))} className="block w-full border-b py-1 text-[13px]" /></label>
                    <button type="button" onClick={() => setDFilters(dFilters.filter((_, i) => i !== index))} aria-label={t("Удалить")} className="pb-1 text-[#777] hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setDFilters([...dFilters, { from, to }])} className="flex h-[48px] items-center gap-2 px-3 text-[14px] font-medium uppercase hover:bg-[#f2f5f8]"><Plus className="h-4 w-4" />{t("Добавить дату")}</button>
              </div>
              <div className="h-[10px]" />
            </Panel>
          )}
        </div>
      </section>

      <section className={`mx-7 mt-[20px] ${CARD}`}>
        {selected.length === 0 ? (
          <ReportEmpty className="pb-[34px] pt-[10px]" text={t("Выберите замеры и группировки, затем примените изменения")} />
        ) : (
          <div className="overflow-x-auto p-6">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#f2f5f8]">
                  {groupLabels.map((g) => <th key={g} rowSpan={2} className={`${cell} text-left`}>{t(g)}</th>)}
                  {selected.map((m) => <th key={m} colSpan={table.periods.length + (options.totalsRight ? 1 : 0)} className={`${cell} text-center`}>{t(m)}</th>)}
                </tr>
                <tr className="bg-[#f2f5f8]">
                  {selected.map((m) => (
                    <FragmentCols key={m}>
                      {table.periods.map((p) => <th key={p} className={`${cell} text-right font-medium`}>{p}</th>)}
                      {options.totalsRight && <th className={`${cell} text-right`}>{t("Итого")}</th>}
                    </FragmentCols>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.body.map((row, i) => (
                  <tr key={i}>
                    {vertical.length === 0 && <td className={cell}>{t("Все")}</td>}
                    {row.keys.map((key, c) => {
                      const span = table.spans[i][c]
                      if (options.merge) return span ? <td key={c} rowSpan={span} className={`${cell} align-top`}>{key}</td> : null
                      return <td key={c} className={cell}>{key}</td>
                    })}
                    {row.cells.map((c, m) => (
                      <FragmentCols key={m}>
                        {c.periods.map((v, p) => <td key={p} className={`${cell} text-right`}>{fmt(v)}</td>)}
                        {options.totalsRight && <td className={`${cell} bg-[#fafbfc] text-right font-semibold`}>{fmt(c.total)}</td>}
                      </FragmentCols>
                    ))}
                  </tr>
                ))}
                {options.totalsBottom && (
                  <tr className="bg-[#f2f5f8] font-bold">
                    <td colSpan={groupLabels.length} className={cell}>{t("Итого")}</td>
                    {table.totals.map((c, m) => (
                      <FragmentCols key={m}>
                        {c.periods.map((v, p) => <td key={p} className={`${cell} text-right`}>{fmt(v)}</td>)}
                        {options.totalsRight && <td className={`${cell} text-right`}>{fmt(c.total)}</td>}
                      </FragmentCols>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ReportPage>
  )
}

function FragmentCols({ children }: { children: ReactNode }) {
  return <>{children}</>
}
