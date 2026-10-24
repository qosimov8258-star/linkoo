"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Download } from "lucide-react"
import { ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatRangeLabel, rangeForPeriod, startOfMonth, endOfMonth, toISODate, type PeriodKey } from "@/lib/dashboard-date-range"
import type { ManagementReport } from "@/lib/finance-management-balance-types"
import { useSearchParams } from "next/navigation"
import { BalanceSections } from "@/components/analytics/balance-sections"

type Side = "begin" | "end"
type Section = "assets" | "passives"
type Summary = { sales: { value: number; currency: string }; payments: { value: number; currency: string } }

const CARD_SHADOW = "shadow-[rgba(149,157,165,0.2)_0px_8px_24px]"
const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const TIP_MAX_WIDTH = 1008

// A cell of the "Баланс на …" cards, in the reference order (two per row).
type CellSpec = { id: string; label: string; section: Section; key: string; info?: string; baseFirst?: boolean }
const CELLS: CellSpec[] = [
  { id: "stock", label: "Склад", section: "assets", key: "stock" },
  { id: "advances", label: "Авансы, полученные от покупателей", section: "passives", key: "market_balance", info: "Сумма предоплаты клиента" },
  { id: "cash", label: "Касса", section: "assets", key: "cashbox", baseFirst: true },
  { id: "supplierDebt", label: "Долги поставщикам", section: "passives", key: "provider_balance", info: "Долги перед поставщиками" },
  { id: "clientDebt", label: "Задолженность клиентов", section: "assets", key: "market_balance", info: "Деньги, которые нам нужно получить от клиентов" },
  { id: "wageDebt", label: "Задолженность по оплате труда", section: "passives", key: "staff_balance", info: "Долги перед сотрудниками" },
  { id: "prepay", label: "Предоплаты поставщикам", section: "assets", key: "provider_balance", info: "Авансы поставщикам" },
  { id: "cashback", label: "Кешбэк покупателей", section: "passives", key: "cashback_balance", info: "Кешбэк покупателей" },
  { id: "wageAdvance", label: "Авансы, выданные по оплате труда", section: "assets", key: "staff_balance", info: "Авансы сотрудникам" },
]

const money = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(rounded).replace(/[   ]/g, " ")
}

/** Per-currency amounts of one report line, summed over every branch card. */
function lineAmounts(report: ManagementReport | null, section: Section, key: string, side: Side) {
  const totals = new Map<string, number>()
  for (const branch of report?.branches ?? []) {
    for (const sec of branch.sections) {
      if (sec.key !== section) continue
      for (const line of sec.lines) {
        if (line.key !== key) continue
        totals.set(line.currency, (totals.get(line.currency) ?? 0) + (side === "begin" ? line.begin_balance : line.end_balance))
      }
    }
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

const dayLabel = (iso: string) => {
  const [, month, day] = iso.split("-").map(Number)
  return `${day} ${MONTH_GEN[month - 1]}`
}

export function BalanceTabView() {
  const { t } = useLanguage()
  const [organization, setOrganization] = useState("")
  const [appliedOrganization, setAppliedOrganization] = useState("")
  const [organizations, setOrganizations] = useState<string[]>([])
  const searchParams = useSearchParams()
  const urlBegin = searchParams.get("beginDate")
  const urlEnd = searchParams.get("endDate")
  const urlRange = urlBegin && urlEnd && /^\d{4}-\d{2}-\d{2}$/.test(urlBegin) && /^\d{4}-\d{2}-\d{2}$/.test(urlEnd) ? { begin: new Date(`${urlBegin}T00:00:00`), end: new Date(`${urlEnd}T00:00:00`) } : null
  const [period, setPeriodState] = useState<PeriodKey>(urlRange ? "СВОЯ" : "МЕСЯЦ")
  const [report, setReport] = useState<ManagementReport | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)

  const today = useMemo(() => new Date(), [])
  const { begin, end } = useMemo(
    () => rangeForPeriod(period, today, urlRange ?? { begin: startOfMonth(today), end: endOfMonth(today) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, today, urlBegin, urlEnd],
  )
  const beginIso = toISODate(begin)
  const endIso = toISODate(end)

  useEffect(() => {
    let cancelled = false
    fetch("/api/organizations")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { name?: string }[]) => {
        if (!cancelled && Array.isArray(rows)) setOrganizations([...new Set(rows.map((row) => row.name ?? "").filter(Boolean))])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ beginDate: beginIso, endDate: endIso })
    if (appliedOrganization) query.append("division", appliedOrganization)
    fetch(`/api/balances/management-balance?${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<ManagementReport>) : null))
      .then((data) => setReport(data))
      .catch(() => {})
    fetch(`/api/dashboard-summary?begin=${beginIso}&end=${endIso}`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Summary>) : null))
      .then((data) => setSummary(data))
      .catch(() => {})
    return () => controller.abort()
  }, [beginIso, endIso, appliedOrganization])

  const baseCurrency = report?.baseCurrency ?? "SUM"
  const currencyLabel = (code: string) => report?.currencies.find((currency) => currency.code === code)?.label ?? code
  const rateOf = (code: string) => (code === baseCurrency ? 1 : (report?.currencies.find((currency) => currency.code === code)?.rate ?? 0))

  /** Non-zero currencies of a cell, alphabetical (base first for the cashboxes); "0 SUM" when empty. */
  const cellLines = (cell: CellSpec, side: Side) => {
    const amounts = [...lineAmounts(report, cell.section, cell.key, side)].filter(([, value]) => Math.abs(value) > 0.0000001)
    amounts.sort(([a], [b]) => {
      if (cell.baseFirst) return (a === baseCurrency ? -1 : 0) - (b === baseCurrency ? -1 : 0) || a.localeCompare(b)
      return a.localeCompare(b)
    })
    return amounts.length ? amounts : ([[baseCurrency, 0]] as [string, number][])
  }

  const totals = (side: Side) => {
    let assets = 0
    let passives = 0
    for (const cell of CELLS) {
      for (const [code, value] of lineAmounts(report, cell.section, cell.key, side)) {
        const converted = value * rateOf(code)
        if (cell.section === "assets") assets += converted
        else passives += converted
      }
    }
    return { assets, passives, equity: assets - passives }
  }
  const beginTotals = totals("begin")
  const endTotals = totals("end")
  const usdRate = report?.currencies.find((currency) => currency.code === "USD")?.rate ?? 0
  const equityDiff = endTotals.equity - beginTotals.equity
  const assetsPercent = beginTotals.assets ? ((endTotals.assets - beginTotals.assets) / Math.abs(beginTotals.assets)) * 100 : 0

  const downloadAll = () => {
    const header = [t("Раздел"), "SUM", "USD", "Euro"]
    const rows = CELLS.map((cell) => {
      const amounts = lineAmounts(report, cell.section, cell.key, "end")
      return [t(cell.label), amounts.get("SUM") ?? 0, amounts.get("USD") ?? 0, amounts.get("EUR") ?? 0]
    })
    downloadExcelTable("balance.xls", [header, ...rows])
  }

  const equityColor = (value: number) => (value < 0 ? "text-[#e27676]" : "text-[#48a34b]")

  const renderCells = (side: Side, withPercent: boolean) => (
    <div className={`flex flex-wrap rounded-[10px] bg-white ${CARD_SHADOW}`}>
      {CELLS.map((cell) => (
        <Cell key={cell.id} label={cell.label} info={cell.info}>
          {cellLines(cell, side).map(([code, value]) => (
            <div key={code}>
              {money(value)} {currencyLabel(code)}
            </div>
          ))}
        </Cell>
      ))}
      <div className="w-1/2 border-b border-r border-[#efefef]" aria-hidden />
      <Cell label="Сумма активов в основной валюте" info="Касса + Склад + Задолженность клиентов + Предоплаты поставщикам + Авансы, выданные по оплате труда">
        <div className="flex items-start justify-between gap-[8px]">
          <span className="text-[#48a34b]">
            {money(totals(side).assets)} {currencyLabel(baseCurrency)}
          </span>
          {withPercent && (
            <span className={`flex h-[38px] min-w-[42px] shrink-0 items-center justify-center gap-[2px] rounded-[3px] px-[4px] text-[10px] font-semibold leading-[12px] ${assetsPercent > 0 ? "bg-[#e3f4e4] text-[#48a34b]" : "bg-[#ffe3e3] text-[#ff5e5e]"}`}>
              <span aria-hidden className="text-[7px]">{assetsPercent > 0 ? "▲" : "▼"}</span>
              {money(Math.round(Math.abs(assetsPercent) * 100) / 100)} %
            </span>
          )}
        </div>
      </Cell>
      <Cell label="Сумма обязательств в основной валюте" info="Авансы, полученные от покупателей + Долги поставщикам + Задолженность по оплате труда">
        <span className="text-[#e27676]">
          {money(totals(side).passives)} {currencyLabel(baseCurrency)}
        </span>
      </Cell>
      <Cell label="Курс">{money(usdRate)}</Cell>
      <Cell
        label="Собственный капитал"
        info="Это деньги, вложенные в бизнес его владельцем, а также объём нераспределённой прибыли, которую бизнес успел заработать и реинвестировать в развитие или отложить в фонды. Размер капитала не статичен, он постоянно меняется. Чтобы его узнать, нужно из суммы всех активов вычесть сумму обязательств. Полученное значение — это те деньги, которые непосредственно работают в бизнесе"
      >
        <span className={equityColor(totals(side).equity)}>
          {money(totals(side).equity)} {currencyLabel(baseCurrency)}
        </span>
      </Cell>
    </div>
  )

  const incomeLabel = (amount?: { value: number; currency: string }) => `${money(amount?.value ?? 0)} ${amount?.currency ?? baseCurrency}`
  const equityLabel = Math.abs(equityDiff) < 0.0005 ? "Собственный капитал не изменился" : equityDiff > 0 ? "Собственный капитал увеличился на:" : "Собственный капитал уменьшился на:"

  return (
    <ReportPage>
      <WidgetHeader active="БАЛАНС" />
      <WidgetUserCard period={period} onPeriod={(value) => setPeriodState(value as PeriodKey)} range={formatRangeLabel(begin, end)} />

      <section className="mx-[30px] mt-[20px] flex h-[77px] items-center bg-white px-[30px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="w-[240px]"><ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={organizations} /></div>
        <button
          type="button"
          onClick={() => setAppliedOrganization(organization)}
          className="ml-auto mr-[18px] mt-[6px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95"
        >
          {t("Применить")}
        </button>
        <button type="button" onClick={downloadAll} className="mr-[10px] mt-[6px] flex h-[30px] items-center rounded-[3px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">
          <Download className="mr-2 h-4 w-4" /> {t("Скачать Excel")}
        </button>
      </section>

      <section className="mx-[30px] mt-[10px] grid grid-cols-1 gap-[16px] pb-[20px] lg:grid-cols-3">
        <div>
          <Heading>{t("Баланс на")} {dayLabel(beginIso)}</Heading>
          {renderCells("begin", false)}
        </div>

        <div>
          <Heading>{t("Продажа за период")}</Heading>
          <div className={`flex h-[74px] items-center gap-[13px] rounded-[10px] bg-white px-[16px] ${CARD_SHADOW}`}>
            <span className="flex h-[40px] w-[40px] items-center justify-center rounded-[8px] bg-[#f2f5f8]"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d="M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z" /></svg></span>
            <span className="text-[15.21px] font-semibold text-black">{incomeLabel(summary?.sales)}</span>
          </div>
          <div className="mt-[15px]"><Heading>{t("Приход денежных средств")}</Heading></div>
          <div className={`flex h-[63px] items-center rounded-[10px] bg-white px-[17px] text-[18px] font-semibold leading-[30px] text-[#495057] ${CARD_SHADOW}`}>{incomeLabel(summary?.payments)}</div>
          <div className="mt-[15px]"><Heading>{t(equityLabel)}</Heading></div>
          <div className={`flex h-[63px] items-center rounded-[10px] bg-white px-[17px] text-[18px] font-semibold leading-[30px] ${CARD_SHADOW} ${Math.abs(equityDiff) < 0.0005 ? "text-[#495057]" : equityColor(equityDiff)}`}>
            {money(Math.abs(equityDiff))} {currencyLabel(baseCurrency)}
          </div>
        </div>

        <div>
          <Heading>{t("Баланс на")} {dayLabel(endIso)}</Heading>
          {renderCells("end", true)}
        </div>
      </section>

      <BalanceSections from={beginIso} to={endIso} />
    </ReportPage>
  )
}
