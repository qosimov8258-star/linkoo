"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import * as echarts from "echarts"

import { SelectField } from "./select-field"
import { CARD_CLASS } from "./stat-cards"
import { BREAKDOWN_GROUPS, BREAKDOWN_MEASURES, type DashboardBreakdown } from "@/lib/dashboard-breakdown-types"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

const DEFAULT_GROUP = "По брендам"
const DEFAULT_MEASURE = "Факт продажи"
const COLORS = ["#00e096", "#0095ff", "#ff3d71", "#ffaa00", "#7a5af8", "#fd7e14", "#20c997", "#6f42c1", "#3366ff", "#e83e8c"]
/** Slices beyond this many are summed into one "Прочие" slice (a donut of 60 clients is unreadable). */
const MAX_SLICES = 9

const fmt = (value: number, digits = 2) => value.toLocaleString("ru-RU", { maximumFractionDigits: digits })
/** ECharts puts what a tooltip formatter returns into the page as HTML: a name typed by a user
 * (a product, a client, an agent) must go in as text, never as markup. */
const escapeHtml = (text: string) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char)

/** "2026-10-05" → "05.10"; a week starts on its Monday ("05.10 – 11.10"); "2026-10" → "10.2026". */
function timeLabel(group: string, name: string): string {
  if (group === "По месяцам" && /^\d{4}-\d{2}$/.test(name)) return `${name.slice(5)}.${name.slice(0, 4)}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return name
  const day = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
  if (group !== "По неделям") return day(name)
  const sunday = new Date(`${name}T00:00:00Z`)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  return `${day(name)} – ${day(sunday.toISOString().slice(0, 10))}`
}

export function RightPanel({ begin, end }: { begin: string; end: string }) {
  const { t } = useLanguage()
  const [grouping, setGrouping] = useState(DEFAULT_GROUP)
  const [measure, setMeasure] = useState(DEFAULT_MEASURE)
  const [data, setData] = useState<DashboardBreakdown | null>(null)
  const [failed, setFailed] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)

  // A cleared select falls back to its default, as the reference does after "×".
  const group = grouping || DEFAULT_GROUP
  const measured = measure || DEFAULT_MEASURE

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    const query = new URLSearchParams({ begin, end, group, measure: measured })
    fetch(`/api/dashboard-summary/breakdown?${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((next: DashboardBreakdown) => {
        if (!cancelled) setData(next)
      })
      .catch(() => {
        if (!cancelled) {
          setData(null)
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [begin, end, group, measured])

  const slices = useMemo(() => {
    const rows = (data?.rows ?? []).filter((row) => row.value > 0).map((row) => ({ name: timeLabel(group, row.name === "Не указано" ? t(row.name) : row.name), value: row.value }))
    if (rows.length <= MAX_SLICES + 1) return rows
    const rest = rows.slice(MAX_SLICES).reduce((sum, row) => sum + row.value, 0)
    return [...rows.slice(0, MAX_SLICES), { name: t("Прочие"), value: rest }]
  }, [data, group, t])

  useEffect(() => {
    if (!chartRef.current) return
    const chart = echarts.init(chartRef.current)
    chart.setOption({
      animation: false,
      tooltip: { trigger: "item", formatter: (item: { name: string; value: number; percent: number }) => `${escapeHtml(item.name)}<br/><b>${fmt(item.value)}</b> (${item.percent}%)` },
      series: [
        {
          type: "pie",
          radius: ["55%", "85%"],
          center: ["50%", "50%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderWidth: 1, borderColor: "#fff" },
          data: slices.map((row, index) => ({ ...row, itemStyle: { color: COLORS[index % COLORS.length] } })),
        },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener("resize", resize)
    return () => {
      window.removeEventListener("resize", resize)
      chart.dispose()
    }
  }, [slices])

  const unit = data?.unit ?? "money"
  const suffix = unit === "money" ? ` ${currencyLabel(data?.currency ?? "SUM")}` : unit === "pieces" ? ` ${t("шт.")}` : unit === "kg" ? ` ${t("кг")}` : ""
  const total = data?.total ?? 0
  const sum = slices.reduce((acc, row) => acc + row.value, 0)

  return (
    <div className={`${CARD_CLASS} flex min-h-[450px] flex-col gap-[10px] p-[10px]`}>
      <div className={`${CARD_CLASS} relative z-20 grid h-[70px] grid-cols-[200px_200px] gap-x-[9.3px] pl-[29.7px] pt-[6.2px]`}>
        <SelectField label={t("Группировка")} options={[...BREAKDOWN_GROUPS]} value={grouping} onChange={setGrouping} />
        <SelectField label={t("Измерять")} options={[...BREAKDOWN_MEASURES]} value={measure} onChange={setMeasure} />
      </div>

      <div className={`${CARD_CLASS} flex flex-1 flex-col`}>
        <div className="relative h-[260px]">
          <div ref={chartRef} className="absolute inset-[10px]" />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[13px] font-semibold leading-[18px]">
              {fmt(total, unit === "kg" ? 3 : 2)}
              {suffix}
            </span>
            <span className="text-[10px] font-semibold leading-[14px] text-[#675c5c]">{t("итого")}</span>
          </div>
        </div>
        {failed ? (
          <p className="px-[15px] pb-[10px] text-center text-[12px] text-[#999]">{t("Не удалось загрузить данные")}</p>
        ) : (
          <ul className="max-h-[160px] overflow-y-auto px-[15px] pb-[10px] text-[12px] leading-[20px]">
            {slices.map((row, index) => (
              <li key={row.name} className="flex items-center gap-[8px]">
                <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                <span data-no-translate className="min-w-0 flex-1 truncate" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 font-semibold">{fmt(row.value, unit === "kg" ? 3 : 2)}</span>
                <span className="w-[42px] shrink-0 text-right text-[#999]">{sum ? Math.round((row.value / sum) * 1000) / 10 : 0}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
