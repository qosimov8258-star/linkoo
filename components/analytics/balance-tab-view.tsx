"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Download } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"
import { BalanceSections, useBalanceOverview } from "@/components/analytics/balance-sections"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatDayMonth, formatStatementDate, isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import type { BalanceOverview } from "@/lib/finance/overview-types"
import { pnlMetrics } from "@/lib/finance/pnl-types"

// Dashboard tab "БАЛАНС": the management balance of the whole company (every
// branch summed, the same numbers as "Управленческий баланс по филиалам") at
// the start and the end of the chosen period, the period's sales / cash
// income / equity change, and the detail sections — all from
// GET /api/balances/overview. A link may open it on a period with
// ?beginDate=YYYY-MM-DD&endDate=YYYY-MM-DD.

type Side = "begin" | "end"
type Section = "assets" | "passives"

const CARD_SHADOW = "shadow-[rgba(149,157,165,0.2)_0px_8px_24px]"

const money = (value: number) => formatMoney(value)

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

// A cell of the "Баланс на …" cards, in the reference order (two per row, asset left / liability right).
// `label` is the overview line label (a Russian i18n key); optional: shown only when the period has an amount on it.
type CellSpec = { label: string; section: Section; info?: string; baseFirst?: boolean; optional?: boolean }
const CELLS: CellSpec[] = [
  { label: "Склад", section: "assets" },
  { label: "Авансы, полученные от покупателей", section: "passives", info: "Сумма предоплаты клиента" },
  { label: "Касса", section: "assets", baseFirst: true },
  { label: "Долги поставщикам", section: "passives", info: "Долги перед поставщиками" },
  { label: "Задолженность клиентов", section: "assets", info: "Деньги, которые нам нужно получить от клиентов" },
  { label: "Задолженность по оплате труда", section: "passives", info: "Долги перед сотрудниками" },
  { label: "Предоплаты поставщикам", section: "assets", info: "Авансы поставщикам" },
  { label: "Кешбэк покупателей", section: "passives", info: "Кешбэк покупателей" },
  { label: "Авансы, выданные по оплате труда", section: "assets", info: "Авансы сотрудникам" },
  { label: "Авансы полученные от филиалов", section: "passives", info: "Долги перед филиалами" },
  { label: "Задолженность филиалов", section: "assets", info: "Деньги, которые нам должны филиалы" },
  { label: "Неоплаченные доп. расходы", section: "passives", info: "Доп. расходы принятых поставок, которые ещё не оплачены" },
  { label: "Деньги у агентов", section: "assets", info: "Оплаты клиентов, собранные агентами и ещё не принятые в кассу" },
  { label: "Предоплаченные доп. расходы", section: "assets", info: "Оплаченные доп. расходы сверх принятых поставок", optional: true },
]

/** Per-currency amounts of one overview line (already summed over every branch). */
function lineAmounts(data: BalanceOverview | null, cell: CellSpec, side: Side) {
  const totals = new Map<string, number>()
  for (const line of data?.lines ?? []) {
    if (line.label !== cell.label || line.section !== cell.section) continue
    totals.set(line.currency, (totals.get(line.currency) ?? 0) + line[side])
  }
  return totals
}

function InfoTip({ text }: { text: string }) {
  const { t } = useLanguage()
  const [side, setSide] = useState<"right" | "left" | null>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const label = t(text)
  // Like the reference tooltip: open to the right of the icon and flip left when it would leave the viewport.
  useLayoutEffect(() => {
    if (side !== "right" || !tipRef.current) return
    if (tipRef.current.getBoundingClientRect().right > window.innerWidth + 2) setSide("left")
  }, [side])
  return (
    <span
      className="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center"
      onMouseEnter={() => setSide("right")}
      onMouseLeave={() => setSide(null)}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]" aria-hidden>
        <path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z" />
      </svg>
      {side && (
        <span
          ref={tipRef}
          className={`pointer-events-none absolute top-1/2 z-50 w-max max-w-[1008px] -translate-y-1/2 rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-normal leading-[17px] text-white opacity-90 ${side === "right" ? "left-[calc(100%+10px)]" : "right-[calc(100%+12px)]"}`}
        >
          {label}
        </span>
      )}
    </span>
  )
}

function Cell({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="flex w-1/2 flex-col border-b border-r border-[#efefef] p-[16px] [&:nth-child(2n)]:border-r-0">
      <div className="flex items-center justify-between">
        <p className="m-0 text-[13px] font-medium uppercase leading-[16.25px] text-[#878a99]">{t(label)}</p>
        {info && <InfoTip text={info} />}
      </div>
      <div className="mt-[10px] text-[16px] font-semibold uppercase leading-[30px] text-[#495057]">{children}</div>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="m-0 mb-[7px] text-[20px] font-semibold leading-[28px] text-[#333]">{children}</h3>
}

export function BalanceTabView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const urlBegin = searchParams.get("beginDate")
  const urlEnd = searchParams.get("endDate")
  const urlRange = isIsoDay(urlBegin) && isIsoDay(urlEnd) ? { from: urlBegin, to: urlEnd } : null
  const [organization, setOrganization] = useState("")
  const [organizations, setOrganizations] = useState<string[]>([])
  const [period, setPeriod] = useState(urlRange ? "СВОЯ" : "МЕСЯЦ")
  const [custom, setCustom] = useState(() => urlRange ?? { from: monthStartIso(), to: todayIso() })
  const [applied, setApplied] = useState(() => ({ ...periodRange(urlRange ? "СВОЯ" : "МЕСЯЦ", urlRange ?? custom), organization: "" }))
  const { data, loading, error } = useBalanceOverview(applied)

  useEffect(() => {
    let cancelled = false
    fetch("/api/organizations")
      .then(async (response) => (response.ok ? ((await response.json()) as Array<{ name?: string }>) : []))
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setOrganizations([...new Set(rows.map((row) => row.name ?? "").filter(Boolean))])
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

  const baseCurrency = data?.baseCurrency ?? "SUM"
  const base = currencyLabel(baseCurrency)
  const dayLabel = (iso: string) => formatDayMonth(iso, language)
  const range = `${formatStatementDate(applied.from, language, false)} - ${formatStatementDate(applied.to, language, false)}`

  /** Non-zero currencies of a cell, alphabetical (base first for the cashboxes); "0 SUM" when empty. */
  const cellLines = (cell: CellSpec, side: Side) => {
    const amounts = [...lineAmounts(data, cell, side)].filter(([, value]) => Math.abs(value) > 0.0000001)
    amounts.sort(([a], [b]) => {
      if (cell.baseFirst) return (a === baseCurrency ? -1 : 0) - (b === baseCurrency ? -1 : 0) || a.localeCompare(b)
      return a.localeCompare(b)
    })
    return amounts.length ? amounts : ([[baseCurrency, 0]] as [string, number][])
  }
  const visibleCells = CELLS.filter((cell) => !cell.optional || (data?.lines ?? []).some((line) => line.label === cell.label && line.section === cell.section && (line.begin || line.end)))

  // Totals come from the server (base currency; a currency without a rate is left out and listed in missingRates).
  const totals = (side: Side) => ({
    assets: data?.totals.assets[side] ?? 0,
    passives: data?.totals.passives[side] ?? 0,
    equity: data?.totals.equity[side] ?? 0,
  })
  const beginTotals = totals("begin")
  const endTotals = totals("end")
  const equityDiff = endTotals.equity - beginTotals.equity
  const assetsPercent = beginTotals.assets ? ((endTotals.assets - beginTotals.assets) / Math.abs(beginTotals.assets)) * 100 : 0
  const rates = (data?.currencies ?? []).filter((currency) => !currency.isBase && currency.code !== baseCurrency && currency.rate)
  const sales = data ? pnlMetrics(data.sales).net : 0
  const income = useMemo(() => Object.entries(data?.cashIncome ?? {}).filter(([, value]) => value), [data])

  const downloadAll = () => {
    if (!data) return
    const header = [t("Раздел"), t("Валюта"), t("Баланс на начало периода"), t("Баланс на конец периода")]
    const body: Array<Array<string | number>> = data.lines.map((line) => [t(line.label), currencyLabel(line.currency), line.begin, line.end])
    body.push([t("Сумма активов в основной валюте"), base, data.totals.assets.begin, data.totals.assets.end])
    body.push([t("Сумма обязательств в основной валюте"), base, data.totals.passives.begin, data.totals.passives.end])
    body.push([t("Собственный капитал"), base, data.totals.equity.begin, data.totals.equity.end])
    downloadExcelTable("balance.xls", [header, ...body])
  }

  const equityColor = (value: number) => (value < 0 ? "text-[#e27676]" : "text-[#48a34b]")

  const renderCells = (side: Side, withPercent: boolean) => (
    <div className={`flex flex-wrap rounded-[10px] bg-white ${CARD_SHADOW}`}>
      {visibleCells.map((cell) => (
        <Cell key={`${cell.section}:${cell.label}`} label={cell.label} info={cell.info}>
          {cellLines(cell, side).map(([code, value]) => (
            <div key={code}>
              {money(value)} {currencyLabel(code)}
            </div>
          ))}
        </Cell>
      ))}
      {visibleCells.length % 2 === 1 && <div className="w-1/2 border-b border-r border-[#efefef]" aria-hidden />}
      <Cell label="Сумма активов в основной валюте" info="Касса + Склад + Задолженность клиентов + Предоплаты поставщикам + Авансы, выданные по оплате труда">
        <div className="flex items-start justify-between gap-[8px]">
          <span className="text-[#48a34b]">
            {money(totals(side).assets)} {base}
          </span>
          {withPercent && (
            <span className={`flex h-[38px] min-w-[42px] shrink-0 items-center justify-center gap-[2px] rounded-[3px] px-[4px] text-[10px] font-semibold leading-[12px] ${assetsPercent > 0 ? "bg-[#e3f4e4] text-[#48a34b]" : "bg-[#ffe3e3] text-[#ff5e5e]"}`}>
              <span aria-hidden className="text-[7px]">{assetsPercent > 0 ? "▲" : "▼"}</span>
              {money(Math.abs(assetsPercent))} %
            </span>
          )}
        </div>
      </Cell>
      <Cell label="Сумма обязательств в основной валюте" info="Авансы, полученные от покупателей + Долги поставщикам + Задолженность по оплате труда">
        <span className="text-[#e27676]">
          {money(totals(side).passives)} {base}
        </span>
      </Cell>
      <Cell label="Курс">
        {rates.length
          ? rates.map((currency) => (
              <div key={currency.code}>
                {currencyLabel(currency.code)}: {money(currency.rate ?? 0)} {base}
              </div>
            ))
          : money(0)}
      </Cell>
      <Cell
        label="Собственный капитал"
        info="Это деньги, вложенные в бизнес его владельцем, а также объём нераспределённой прибыли, которую бизнес успел заработать и реинвестировать в развитие или отложить в фонды. Размер капитала не статичен, он постоянно меняется. Чтобы его узнать, нужно из суммы всех активов вычесть сумму обязательств. Полученное значение — это те деньги, которые непосредственно работают в бизнесе"
      >
        <span className={equityColor(totals(side).equity)}>
          {money(totals(side).equity)} {base}
        </span>
      </Cell>
    </div>
  )

  const equityLabel = Math.abs(equityDiff) < 0.005 ? "Собственный капитал не изменился" : equityDiff > 0 ? "Собственный капитал увеличился на:" : "Собственный капитал уменьшился на:"

  return (
    <ReportPage>
      <WidgetHeader active="БАЛАНС" />
      <WidgetUserCard period={period} onPeriod={choosePeriod} range={range}>
        {period === "СВОЯ" && (
          <span className="ml-[8px] flex items-center gap-[6px] text-[13px]">
            <input type="date" aria-label={t("С")} value={custom.from} max={custom.to} onChange={(event) => event.target.value && setCustom((value) => ({ ...value, from: event.target.value }))} className="h-[30px] border-b" />
            <input type="date" aria-label={t("По")} value={custom.to} min={custom.from} onChange={(event) => event.target.value && setCustom((value) => ({ ...value, to: event.target.value }))} className="h-[30px] border-b" />
          </span>
        )}
      </WidgetUserCard>

      <section className="mx-[30px] mt-[20px] flex h-[77px] items-center bg-white px-[30px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="w-[240px]"><ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={organizations} /></div>
        <span className="ml-[16px] text-[12px] text-[#777]">
          {loading ? t("Загрузка...") : error ? t(error) : data?.missingRates.length ? `${t("Нет курса валюты, суммы не учтены")}: ${data.missingRates.map(currencyLabel).join(", ")}` : ""}
        </span>
        <button
          type="button"
          onClick={apply}
          className="ml-auto mr-[18px] mt-[6px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold uppercase text-white hover:brightness-95"
        >
          {t("Применить")}
        </button>
        <button type="button" onClick={downloadAll} disabled={!data} className="mr-[10px] mt-[6px] flex h-[30px] items-center rounded-[3px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50">
          <Download className="mr-2 h-4 w-4" /> {t("Скачать Excel")}
        </button>
      </section>

      <section className="mx-[30px] mt-[10px] grid grid-cols-1 gap-[16px] pb-[20px] lg:grid-cols-3">
        <div>
          <Heading>{t("Баланс на")} {dayLabel(applied.from)}</Heading>
          {renderCells("begin", false)}
        </div>

        <div>
          <Heading>{t("Продажа за период")}</Heading>
          <div className={`flex h-[74px] items-center gap-[13px] rounded-[10px] bg-white px-[16px] ${CARD_SHADOW}`}>
            <span className="flex h-[40px] w-[40px] items-center justify-center rounded-[8px] bg-[#f2f5f8]"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d="M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z" /></svg></span>
            <span className="text-[15.21px] font-semibold text-black">{money(sales)} {base}</span>
          </div>
          <div className="mt-[15px]"><Heading>{t("Приход денежных средств")}</Heading></div>
          <div className={`flex min-h-[63px] flex-col justify-center rounded-[10px] bg-white px-[17px] py-[8px] text-[18px] font-semibold leading-[30px] text-[#495057] ${CARD_SHADOW}`}>
            {income.length ? income.map(([currency, value]) => <span key={currency}>{money(value)} {currencyLabel(currency)}</span>) : `${money(0)} ${base}`}
          </div>
          <div className="mt-[15px]"><Heading>{t(equityLabel)}</Heading></div>
          <div className={`flex h-[63px] items-center rounded-[10px] bg-white px-[17px] text-[18px] font-semibold leading-[30px] ${CARD_SHADOW} ${Math.abs(equityDiff) < 0.005 ? "text-[#495057]" : equityColor(equityDiff)}`}>
            {money(Math.abs(equityDiff))} {base}
          </div>
        </div>

        <div>
          <Heading>{t("Баланс на")} {dayLabel(applied.to)}</Heading>
          {renderCells("end", true)}
        </div>
      </section>

      <BalanceSections data={data} />
    </ReportPage>
  )
}
