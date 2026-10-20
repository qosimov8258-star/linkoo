"use client"

import { useEffect, useMemo, useState } from "react"
import { Download } from "lucide-react"
import { ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"
import { BalanceSections, useBalanceOverview } from "@/components/analytics/balance-sections"
import { currencyLabel } from "@/lib/finance/currency"
import { formatDayMonth, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import type { BalanceOverview } from "@/lib/finance/overview-types"
import { pnlMetrics } from "@/lib/finance/pnl-types"

// Dashboard tab "БАЛАНС": the management balance of the whole company (every
// branch summed, the same numbers as "Управленческий баланс по филиалам") at
// the start and the end of the chosen period, the period's sales / cash
// income / equity change, and the detail sections — all from
// GET /api/balances/overview.

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function WidgetCell({ label, lines, info }: { label: string; lines: { value: number; suffix: string }[]; info?: boolean }) {
  return (
    <div>
      <p className="flex items-start justify-between gap-2 text-[12px] font-medium uppercase leading-[16px] text-[#777]">
        <span>{label}</span>
        {info && <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[#4f71dc] stroke-2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>}
      </p>
      {(lines.length ? lines : [{ value: 0, suffix: "" }]).map((line, index) => (
        <p key={index} className="mt-[8px] text-[15px] font-semibold leading-[20px] text-[#444]">{money(line.value)} {line.suffix}</p>
      ))}
    </div>
  )
}

function shiftDay(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Period of a WidgetUserCard chip (СВОЯ = the custom from / to). */
export function periodRange(period: string, custom: { from: string; to: string }): { from: string; to: string } {
  const today = todayIso()
  if (period === "СЕГОДНЯ") return { from: today, to: today }
  if (period === "ВЧЕРА") return { from: shiftDay(today, -1), to: shiftDay(today, -1) }
  if (period === "ПОСЛ. 7") return { from: shiftDay(today, -6), to: today }
  if (period === "СВОЯ") return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }
  return { from: monthStartIso(today), to: monthEndIso(today) }
}

const CELLS: Array<{ label: string; section: "assets" | "passives"; info?: boolean; base?: boolean }> = [
  { label: "Склад", section: "assets", base: true },
  { label: "Авансы, полученные от покупателей", section: "passives", info: true },
  { label: "Касса", section: "assets" },
  { label: "Долги поставщикам", section: "passives", info: true },
  { label: "Задолженность клиентов", section: "assets", info: true },
  { label: "Задолженность по оплате труда", section: "passives", info: true },
  { label: "Предоплаты поставщикам", section: "assets", info: true },
  { label: "Кешбэк покупателей", section: "passives", info: true, base: true },
  { label: "Авансы, выданные по оплате труда", section: "assets", info: true },
  { label: "Задолженность филиалов", section: "assets", info: true },
  { label: "Авансы полученные от филиалов", section: "passives", info: true },
]

function cellLines(data: BalanceOverview | null, label: string, side: "begin" | "end") {
  return (data?.lines ?? []).filter((line) => line.label === label && line[side]).map((line) => ({ value: line[side], suffix: currencyLabel(line.currency) }))
}

function BalanceCard({ title, data, side }: { title: string; data: BalanceOverview | null; side: "begin" | "end" }) {
  const { t } = useLanguage()
  const base = currencyLabel(data?.baseCurrency ?? "SUM")
  return (
    <div>
      <h3 className="mb-[10px] text-[18px] font-semibold">{title}</h3>
      <div className="grid grid-cols-2 rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] [&>div]:min-h-[110px] [&>div]:border-b [&>div]:border-r [&>div]:border-[#efefef] [&>div]:p-[16px] [&>div:nth-child(2n)]:border-r-0">
        {CELLS.map((cell) => {
          const lines = cellLines(data, cell.label, side)
          return <WidgetCell key={cell.label} label={t(cell.label)} info={cell.info} lines={lines.length || !cell.base ? lines : [{ value: 0, suffix: base }]} />
        })}
        <WidgetCell label={t("Сумма обязательств в основной валюте")} lines={[{ value: data?.totals.passives[side] ?? 0, suffix: base }]} />
        <WidgetCell label={t("Сумма активов в основной валюте")} lines={[{ value: data?.totals.assets[side] ?? 0, suffix: base }]} />
        <WidgetCell label={t("Собственный капитал")} lines={[{ value: data?.totals.equity[side] ?? 0, suffix: base }]} />
      </div>
    </div>
  )
}

export function BalanceTabView() {
  const { t, language } = useLanguage()
  const [organization, setOrganization] = useState("")
  const [organizations, setOrganizations] = useState<string[]>([])
  const [period, setPeriod] = useState("МЕСЯЦ")
  const [custom, setCustom] = useState(() => ({ from: monthStartIso(), to: todayIso() }))
  const [applied, setApplied] = useState(() => ({ ...periodRange("МЕСЯЦ", custom), organization: "" }))
  const { data, loading, error } = useBalanceOverview(applied)

  useEffect(() => {
    let cancelled = false
    fetch("/api/organizations")
      .then(async (response) => (response.ok ? ((await response.json()) as Array<{ name: string }>) : []))
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setOrganizations(rows.map((row) => row.name).filter(Boolean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const choosePeriod = (value: string) => {
    setPeriod(value)
    if (value !== "СВОЯ") setApplied((current) => ({ ...current, ...periodRange(value, custom) }))
  }
  const apply = () => setApplied({ ...periodRange(period, custom), organization })

  const base = currencyLabel(data?.baseCurrency ?? "SUM")
  const sales = data ? pnlMetrics(data.sales).net : 0
  const income = useMemo(() => Object.entries(data?.cashIncome ?? {}).filter(([, value]) => value), [data])
  const equityChange = data ? data.totals.equity.end - data.totals.equity.begin : 0
  const dayLabel = (iso: string) => `${formatDayMonth(iso, language)} ${iso.slice(0, 4)}`
  const range = `${dayLabel(applied.from)} - ${dayLabel(applied.to)}`

  const downloadAll = () => {
    if (!data) return
    const header = [t("Раздел"), t("Валюта"), t("Баланс на начало периода"), t("Баланс на конец периода")]
    const body: Array<Array<string | number>> = data.lines.map((line) => [t(line.label), currencyLabel(line.currency), line.begin, line.end])
    body.push([t("Сумма активов в основной валюте"), base, data.totals.assets.begin, data.totals.assets.end])
    body.push([t("Сумма обязательств в основной валюте"), base, data.totals.passives.begin, data.totals.passives.end])
    body.push([t("Собственный капитал"), base, data.totals.equity.begin, data.totals.equity.end])
    downloadExcelTable("balance.xls", [header, ...body])
  }

  return (
    <ReportPage>
      <WidgetHeader active="БАЛАНС" />
      <WidgetUserCard period={period} onPeriod={choosePeriod} range={range}>
        {period === "СВОЯ" && (
          <span className="ml-[8px] flex items-center gap-[6px] text-[13px]">
            <input type="date" value={custom.from} max={custom.to} onChange={(event) => event.target.value && setCustom((value) => ({ ...value, from: event.target.value }))} className="h-[30px] border-b" />
            <input type="date" value={custom.to} min={custom.from} onChange={(event) => event.target.value && setCustom((value) => ({ ...value, to: event.target.value }))} className="h-[30px] border-b" />
          </span>
        )}
      </WidgetUserCard>

      <section className="mx-[30px] mt-[20px] flex h-[77px] items-center bg-white px-[30px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="w-[240px]"><ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={organizations} /></div>
        <span className="ml-[16px] text-[12px] text-[#777]">
          {loading ? t("Загрузка...") : error ? t(error) : data?.missingRates.length ? `${t("Нет курса валюты, суммы не учтены")}: ${data.missingRates.map(currencyLabel).join(", ")}` : ""}
        </span>
        <button onClick={apply} className="ml-auto mr-[18px] mt-[6px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">
          {t("Применить")}
        </button>
        <button onClick={downloadAll} disabled={!data} className="mr-[10px] mt-[6px] flex h-[30px] items-center rounded-[3px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50">
          <Download className="mr-2 h-4 w-4" /> {t("Скачать Excel")}
        </button>
      </section>

      <section className="mx-[30px] mt-[10px] grid grid-cols-1 gap-[16px] pb-[20px] lg:grid-cols-[420px_1fr_420px]">
        <BalanceCard title={`${t("Баланс на")} ${dayLabel(applied.from)}`} data={data} side="begin" />

        <div className="space-y-[14px]">
          <h3 className="text-[18px] font-semibold">{t("Продажа за период")}</h3>
          <div className="flex items-center gap-[14px] rounded-[12px] bg-white p-[16px] text-[15px] font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <span className="flex h-[44px] w-[44px] items-center justify-center rounded-[8px] bg-[#f2f5f8]"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d="M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z" /></svg></span>
            {money(sales)} {base}
          </div>
          <h3 className="text-[18px] font-semibold">{t("Приход денежных средств")}</h3>
          <div className="rounded-[12px] bg-white p-[16px] text-[15px] font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {income.length ? income.map(([currency, value]) => <p key={currency}>{money(value)} {currencyLabel(currency)}</p>) : `0 ${base}`}
          </div>
          <h3 className="text-[18px] font-semibold">{equityChange === 0 ? t("Собственный капитал не изменился") : t("Изменение собственного капитала")}</h3>
          <div className={`rounded-[12px] bg-white p-[16px] text-[15px] font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] ${equityChange > 0 ? "text-[#3aa76d]" : equityChange < 0 ? "text-[#e5484d]" : ""}`}>
            {money(equityChange)} {base}
          </div>
        </div>

        <BalanceCard title={`${t("Баланс на")} ${dayLabel(applied.to)}`} data={data} side="end" />
      </section>

      <BalanceSections data={data} />
    </ReportPage>
  )
}
