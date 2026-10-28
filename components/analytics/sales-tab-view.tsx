"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RefMultiField } from "@/components/ref/multi-field"
import { ReportPage, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { formatRangeLabel, parseISODate, rangeForPeriod, toISODate, type PeriodKey } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"
import type { SalesGroup, SalesOptions, SalesRow, SalesStats } from "@/lib/sales-stats-repo"
import { formatNumber, SalesBars, SalesCombo, SalesDonut, Spinner } from "./sales-tab-charts"

// Dashboard tab "ПРОДАЖА" (demo #/?toggleTab=sales): period + filter in the address bar
// (beginDate / endDate / typeDate / sortBy), data from /api/sales-stats.

type Metric = "amount" | "akb" | "okb" | "akbIndex"
type FilterKey = "zones" | "marketTypes" | "productTypes" | "agents" | "brands"
type Filters = Record<FilterKey, string[]>
type Range = "day" | "week" | "month"

const PERIOD_TYPES: { key: PeriodKey; type: string }[] = [
  { key: "СЕГОДНЯ", type: "today" },
  { key: "ВЧЕРА", type: "yesterday" },
  { key: "ПОСЛ. 7", type: "week" },
  { key: "МЕСЯЦ", type: "month" },
  { key: "СВОЯ", type: "ownDate" },
]
const METRICS: { key: Metric; label: string; param: string }[] = [
  { key: "akb", label: "АКБ", param: "akb" },
  { key: "okb", label: "ОКБ", param: "okb" },
  { key: "akbIndex", label: "Индекс АКБ", param: "akbIndex" },
  { key: "amount", label: "Продажи", param: "amount" },
]
const RANGES: { key: Range; label: string }[] = [
  { key: "day", label: "По дням" },
  { key: "week", label: "По неделям" },
  { key: "month", label: "По месяцам" },
]
const SECTIONS: { key: keyof Pick<SalesStats, "marketType" | "border" | "user" | "productType">; title: string }[] = [
  { key: "marketType", title: "Продажи по типу клиента" },
  { key: "border", title: "Продажи по территории" },
  { key: "user", title: "Продажи по пользователям" },
  { key: "productType", title: "Продажи по типу продукта" },
]
const FILTER_FIELDS: { key: FilterKey; label: string; option: keyof SalesOptions }[] = [
  { key: "zones", label: "Зона", option: "zones" },
  { key: "marketTypes", label: "Тип клиента", option: "marketTypes" },
  { key: "productTypes", label: "Тип товара", option: "productTypes" },
  { key: "agents", label: "Агент", option: "agents" },
  { key: "brands", label: "Бренд", option: "brands" },
]
const NO_FILTERS: Filters = { zones: [], marketTypes: [], productTypes: [], agents: [], brands: [] }

const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
const FLAT = "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12)] hover:bg-slate-50"
const RAISED = "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
const BTN = "h-8 min-w-[70px] whitespace-nowrap rounded-[5px] px-4 pt-[1px] text-[13px] font-normal uppercase"
const BAR = "#5869f0"
const CELL = "border-r border-[#e8e8e8] px-[17.5px]"

const metricValue = (row: SalesRow, metric: Metric) => row[metric]
const percentText = (value: number) => `${formatNumber(Math.round(value * 10) / 10, 1)} %`
const indexText = (value: number, digits: number) => `${formatNumber(Math.round(value * 10 ** digits) / 10 ** digits, digits)} %`

/** The demo sorts ascending (stable) and then reverses, which is what decides ties. */
function rankedRows(rows: SalesRow[], metric: Metric) {
  return [...rows].sort((a, b) => metricValue(a, metric) - metricValue(b, metric)).reverse()
}

function BarList({ rows, metric, expandable = true }: { rows: SalesRow[]; metric: Metric; expandable?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ranked = useMemo(() => rankedRows(rows, metric), [rows, metric])
  const sum = ranked.reduce((total, row) => total + metricValue(row, metric), 0)
  const shown = open || !expandable ? ranked : ranked.slice(0, 5)
  const text = (row: SalesRow) => (metric === "akbIndex" ? formatNumber(row.akbIndex, 1) : formatNumber(metricValue(row, metric)))
  return (
    <div>
      {shown.map((row) => {
        const percent = sum > 0 ? (metricValue(row, metric) / sum) * 100 : 0
        const width = Math.max(20, percent)
        return (
          <div key={row.id} className="h-[60px]">
            <h4 className="h-5 truncate text-[15px] font-medium leading-5 text-[#333]">{row.name}</h4>
            <div className="mt-[5px] flex items-center">
              <div className="relative h-[25px] rounded-[5px] text-[13px] font-medium text-white" style={{ width: `${width}%`, background: BAR }}>
                <span className="absolute left-[10px] top-0 leading-[25px]">{percentText(percent)}</span>
                {percent > 90 && <span className="absolute right-[10px] top-0 translate-x-[-34%] leading-[25px]">{text(row)}</span>}
              </div>
              {percent <= 90 && <span className="ml-[4px] text-[13px] font-medium leading-[25px]" style={{ color: BAR }}>{text(row)}</span>}
            </div>
          </div>
        )
      })}
      {expandable && ranked.length > 5 && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="mt-[10px] flex h-[30px] w-full items-center justify-center gap-[4px] rounded-full bg-[#f0f4f8] text-[13px]" style={{ color: BAR }}>
          {open ? t("Скрыть") : t("Показать еще")}
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" style={{ fill: BAR }}>
            <path d={open ? "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" : "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"} />
          </svg>
        </button>
      )}
    </div>
  )
}

function SortIcon({ active, desc }: { active: boolean; desc: boolean }) {
  return (
    <svg viewBox="0 0 10 14" className="ml-[8px] h-[14px] w-[10px] fill-[#9aa3b2]" aria-hidden>
      <path d="M5 1L9 6H1z" opacity={active && desc ? 0.3 : 1} />
      <path d="M5 13L1 8h8z" opacity={active && !desc ? 0.3 : 1} />
    </svg>
  )
}

function Breakdown({ title, group, loading }: { title: string; group: SalesGroup | undefined; loading: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<{ column: "name" | "okb" | "akb" | "akbIndex" | "amount"; desc: boolean } | null>(null)
  const rows = useMemo(() => {
    const data = group?.data ?? []
    if (!sort) return data
    const sorted = [...data].sort((a, b) => (sort.column === "name" ? a.name.localeCompare(b.name, "ru") : a[sort.column] - b[sort.column]))
    return sort.desc ? sorted.reverse() : sorted
  }, [group, sort])
  const columns = [
    { key: "name", label: "Название" },
    { key: "okb", label: "ОКБ" },
    { key: "akb", label: "АКБ" },
    { key: "akbIndex", label: "Индекс АКБ" },
    { key: "amount", label: "Продажи" },
  ] as const
  const total = group?.total
  return (
    <section>
      <h2 className="mt-[36px] h-7 text-[20px] font-semibold leading-7 text-[#333]">{t(title)}</h2>
      <div className={`mt-[10px] flex min-h-[335px] rounded-[10px] pb-[30px] ${CARD}`}>
        <div className="w-[1080px] shrink-0 overflow-hidden">
          <table className="w-full table-auto border-collapse text-[13px] text-[#333]">
            <thead>
              <tr className="h-[36px] border-b border-[#e8e8e8]">
                {columns.map((column) => (
                  <th key={column.key} className="whitespace-nowrap border-r border-[#e8e8e8] px-[17.5px] text-left font-semibold text-[#374557]">
                    <button
                      type="button"
                      onClick={() => setSort((current) => (current?.column === column.key ? { column: column.key, desc: !current.desc } : { column: column.key, desc: column.key !== "name" }))}
                      className="flex items-center"
                    >
                      {t(column.label)}
                      <SortIcon active={sort?.column === column.key} desc={!!sort?.desc} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(open ? rows : rows.slice(0, 8)).map((row) => (
                <tr key={row.id} className="h-[36px] border-b border-[#e8e8e8]">
                  <td className={CELL}>{row.name}</td>
                  <td className={CELL}>{formatNumber(row.okb)}</td>
                  <td className={CELL}>{formatNumber(row.akb)}</td>
                  <td className={CELL}>{indexText(row.akbIndex, 1)}</td>
                  <td className={CELL}>{formatNumber(row.amount)}</td>
                </tr>
              ))}
              {rows.length >= 8 && (
                <tr className="h-[46px] border-b border-[#e8e8e8]">
                  <td colSpan={5} className="text-center">
                    <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-[4px] text-[13px]" style={{ color: BAR }}>
                      {open ? t("Скрыть") : t("Показать еще")}
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" style={{ fill: BAR }}>
                        <path d={open ? "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" : "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"} />
                      </svg>
                    </button>
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="h-[200px] bg-[url('/robot-empty.png')] bg-[length:200px_auto] bg-center bg-no-repeat pt-[150px] text-center text-[13px] text-[#333]">{t("Нет данных")}</td>
                </tr>
              )}
              <tr className="h-[36px] font-semibold">
                <td className={CELL}>{t("Итого")}</td>
                <td className={CELL}>{formatNumber(total?.okb ?? 0)}</td>
                <td className={CELL}>{formatNumber(total?.akb ?? 0)}</td>
                <td className={CELL}>{indexText(total?.akbIndex ?? 0, 3)}</td>
                <td className={CELL}>{formatNumber(total?.amount ?? 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <SalesDonut rows={(group?.data ?? []).map((row) => ({ name: row.name, percent: row.percent }))} total={formatNumber(total?.amount ?? 0)} label={t("итого")} />
        </div>
      </div>
    </section>
  )
}

export function SalesTabView() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const today = useMemo(() => new Date(), [])

  const urlType = searchParams.get("typeDate") ?? "month"
  const period = PERIOD_TYPES.find((item) => item.type === urlType)?.key ?? "МЕСЯЦ"
  const metric = (METRICS.find((item) => item.param === searchParams.get("sortBy"))?.key ?? "amount") as Metric
  const urlBegin = searchParams.get("beginDate")
  const urlEnd = searchParams.get("endDate")
  const range = useMemo(() => {
    const custom = urlBegin && urlEnd ? { begin: parseISODate(urlBegin), end: parseISODate(urlEnd) } : rangeForPeriod("ПОСЛ. 7", today, { begin: today, end: today })
    return rangeForPeriod(period, today, custom)
  }, [period, today, urlBegin, urlEnd])
  const beginISO = toISODate(range.begin)
  const endISO = toISODate(range.end)

  const [stats, setStats] = useState<SalesStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [options, setOptions] = useState<SalesOptions | null>(null)
  const [filterOpen, setFilterOpen] = useState(searchParams.get("openSalesTabFilterDialog") === "true")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draftPickerOpen, setDraftPickerOpen] = useState(false)
  const [draftRange, setDraftRange] = useState({ begin: beginISO, end: endISO })
  const [salesRange, setSalesRange] = useState<Range>("day")

  const go = useCallback(
    (next: { period?: PeriodKey; metric?: Metric; begin?: string; end?: string; filterDialog?: boolean }) => {
      const nextPeriod = next.period ?? period
      const span = next.begin && next.end ? { begin: parseISODate(next.begin), end: parseISODate(next.end) } : rangeForPeriod(nextPeriod, today, range)
      const params = new URLSearchParams()
      params.set("beginDate", toISODate(span.begin))
      params.set("endDate", toISODate(span.end))
      if (next.filterDialog) params.set("openSalesTabFilterDialog", "true")
      params.set("sortBy", METRICS.find((item) => item.key === (next.metric ?? metric))!.param)
      params.set("toggleTab", "sales")
      params.set("typeDate", PERIOD_TYPES.find((item) => item.key === nextPeriod)!.type)
      router.replace(`/analytics/sales-tab?${params}`)
    },
    [metric, period, range, router, today],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ begin: beginISO, end: endISO })
    for (const key of Object.keys(filters) as FilterKey[]) if (filters[key].length) params.set(key, filters[key].join("|"))
    fetch(`/api/sales-stats?${params}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<SalesStats>) : null))
      .then((data) => {
        if (cancelled) return
        setStats(data)
        setLoading(false)
      })
      .catch(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [beginISO, endISO, filters])

  useEffect(() => {
    if (!filterOpen || options) return
    fetch("/api/sales-stats?options=1")
      .then((response) => (response.ok ? (response.json() as Promise<SalesOptions>) : null))
      .then((data) => data && setOptions(data))
      .catch(() => {})
  }, [filterOpen, options])

  const rangeLabel = formatRangeLabel(range.begin, range.end)
  const filterCount = 1 + (Object.values(filters) as string[][]).filter((list) => list.length > 0).length
  const bars = stats ? stats[salesRange] : []

  function openFilter() {
    setDraft(filters)
    setDraftRange({ begin: beginISO, end: endISO })
    setFilterOpen(true)
  }

  return (
    <ReportPage>
      <WidgetHeader active="ПРОДАЖА" />
      <WidgetUserCard
        period={PERIOD_TYPES.find((item) => item.key === period)?.key}
        onPeriod={(value) => go({ period: value as PeriodKey })}
        rangeSlot={
          <div className="relative ml-auto mr-[15px]">
            <button type="button" onClick={() => setPickerOpen((open) => !open)} className="text-[13px] font-bold capitalize text-[#4f71dc]">
              {rangeLabel}
            </button>
            {pickerOpen && (
              <DateRangePicker
                positionClassName="right-[-5px] top-[calc(100%+21px)]"
                begin={beginISO}
                end={endISO}
                onClose={() => setPickerOpen(false)}
                onApply={(from, to) => {
                  go({ period: "СВОЯ", begin: from, end: to })
                  setPickerOpen(false)
                }}
              />
            )}
          </div>
        }
      />

      <div className="relative mx-[30px] mt-[20px] flex h-[48.3px] items-start justify-between">
        <div className="flex">
          {METRICS.map((item) => (
            <button key={item.key} type="button" onClick={() => go({ metric: item.key })} className={`${BTN} ${metric === item.key ? `bg-[#2bcd53] text-white ${RAISED}` : FLAT}`}>
              {t(item.label)}
            </button>
          ))}
        </div>
        <div className="flex h-[48.3px] w-[260px] items-stretch bg-[#efefef] text-[13px] text-[#666]">
          <span className="flex flex-1 items-center pl-[30px]">{t("Фильтр:")} {filterCount} {t("элемента")}</span>
          <button type="button" onClick={openFilter} aria-label={t("Изменить")} className="flex w-[48px] items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]"><path d="M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z" /><path d="M0 20h24v4H0z" /></svg>
          </button>
          <button type="button" onClick={() => { setFilters(NO_FILTERS) }} aria-label={t("Сбросить фильтр")} className="flex w-[48px] items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]"><path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
          </button>
        </div>

        {filterOpen && (
          <div className={`absolute left-0 right-0 top-0 z-40 h-[253px] ${CARD}`}>
            <h3 className="absolute left-[20px] top-[25px] text-[14px] leading-[18px] text-[#666]">{t("Фильтр")}</h3>
            <button type="button" onClick={() => { setFilterOpen(false); setDraftPickerOpen(false) }} aria-label={t("Закрыть")} className="absolute right-[22px] top-[24px]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]"><path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
            </button>
            <div className="absolute left-[20px] right-[20px] top-[64px] grid grid-cols-4 gap-x-[10px] gap-y-[13px]">
              <div className="relative h-[54px]">
                <button type="button" onClick={() => setDraftPickerOpen((open) => !open)} className="absolute inset-0 border-b border-[#e0e0e0] text-left">
                  <span className="absolute inset-x-0 top-[28px] text-[13px] leading-[18px] text-black">
                    {formatShortRange(draftRange.begin)} - {formatShortRange(draftRange.end)}
                  </span>
                </button>
                {draftPickerOpen && (
                  <DateRangePicker
                    positionClassName="left-0 top-[58px]"
                    begin={draftRange.begin}
                    end={draftRange.end}
                    onClose={() => setDraftPickerOpen(false)}
                    onApply={(from, to) => {
                      setDraftRange({ begin: from, end: to })
                      setDraftPickerOpen(false)
                    }}
                  />
                )}
              </div>
              {FILTER_FIELDS.map((field) => (
                <RefMultiField key={field.key} label={field.label} options={(options?.[field.option] ?? []).map((name) => ({ value: name, label: name }))} value={draft[field.key]} onChange={(next) => setDraft((current) => ({ ...current, [field.key]: next }))} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setFilters(draft)
                setFilterOpen(false)
                if (draftRange.begin !== beginISO || draftRange.end !== endISO) go({ period: "СВОЯ", begin: draftRange.begin, end: draftRange.end })
              }}
              className="absolute left-[20px] top-[207px] h-9 rounded-[3px] bg-[#5d6474] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] hover:brightness-110"
            >
              {t("Применить")}
            </button>
          </div>
        )}
      </div>

      <section className="mx-[30px] mt-[15px] grid grid-cols-3 gap-[16px]">
        {[
          { title: "Продажи по территории", group: stats?.border },
          { title: "Продажи по пользователям", group: stats?.user },
          { title: "Продажи по типу продукта", group: stats?.productType },
        ].map((card) => (
          <div key={card.title} className={`min-h-[410px] rounded-[10px] p-[20px] ${CARD}`}>
            <h2 className="mb-[10px] h-5 text-[17px] font-semibold leading-5 text-[#333]">{t(card.title)}</h2>
            {card.group && <BarList rows={card.group.data} metric={metric} />}
          </div>
        ))}
      </section>

      <section className={`mx-[30px] mt-[16px] rounded-[10px] px-[20px] pb-[23px] pt-[10px] ${CARD}`}>
        <div className="flex h-8 items-center">
          <h2 className="mt-[1px] w-[630.9px] text-[20px] font-semibold leading-7 text-[#333]">{t("Продажа")}</h2>
          <div className="flex">
            {RANGES.map((item) => (
              <button key={item.key} type="button" onClick={() => setSalesRange(item.key)} className={`${BTN} ${salesRange === item.key ? `bg-[#2bcd53] text-white ${RAISED}` : FLAT}`}>
                {t(item.label)}
              </button>
            ))}
          </div>
          <h2 className="-mt-[2px] ml-[50px] text-[20px] font-semibold leading-7 text-[#333]">{t("По типам оплаты")}</h2>
        </div>
        <div className="mt-[30px] flex min-h-[320px]">
          <div className="w-[960px] shrink-0">
            {loading ? (
              <div className="flex h-[300px] items-center justify-center"><Spinner /></div>
            ) : bars.length > 0 ? (
              <SalesBars points={bars} />
            ) : (
              <div className="-mt-[17px] h-[250px] bg-[url('/robot-empty.png')] bg-[length:200px_auto] bg-center bg-no-repeat pt-[212px] text-center text-[13px] text-[#999]">{t("По вашему запросу ничего не найдено")}</div>
            )}
          </div>
          <div className="ml-[50px] -mt-[17px] h-[250px] flex-1 bg-[url('/robot-empty.png')] bg-[length:200px_auto] bg-center bg-no-repeat pt-[212px] text-center text-[13px] text-[#999]">{t("По вашему запросу ничего не найдено")}</div>
        </div>
      </section>

      <section className={`mx-[30px] mt-[16px] overflow-hidden rounded-[10px] px-[10px] pb-[18px] pt-[18px] ${CARD}`}>
        {loading ? (
          <div className="flex h-[300px] items-center justify-center"><Spinner /></div>
        ) : (
          <SalesCombo points={(stats?.dynamic ?? []).map((day) => ({ date: day.date, sales: day.sales, akb: day.akb, reject: day.reject }))} width={1400} />
        )}
      </section>

      <div className="mx-[30px] pb-[40px]">
        {SECTIONS.map((section) => (
          <Breakdown key={section.key} title={section.title} group={stats?.[section.key]} loading={loading} />
        ))}
      </div>
    </ReportPage>
  )
}

function formatShortRange(iso: string) {
  const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
  const date = parseISODate(iso)
  return `${String(date.getDate()).padStart(2, "0")} ${months[date.getMonth()]} ${date.getFullYear()}`
}
