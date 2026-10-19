"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"
import { BalanceSections } from "@/components/analytics/balance-sections"


const money = (value: number, fraction = 0) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value)

const CASH_TOTALS = { euro: 0, sum: 0, usd: 0 }
const CLIENT_DEBT_SUM_TOTAL = 0
const CLIENT_DEBT_USD_TOTAL = 0
const SUPPLIER_DEBT_SUM_TOTAL = 0
const SUPPLIER_DEBT_USD_TOTAL = 0
const WAREHOUSE_TOTAL = 0

function WidgetCell({ label, lines, info }: { label: string; lines: { value: number; suffix: string }[]; info?: boolean }) {
  return (
    <div>
      <p className="flex items-start justify-between gap-2 text-[12px] font-medium uppercase leading-[16px] text-[#777]">
        <span>{label}</span>
        {info && <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[#4f71dc] stroke-2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>}
      </p>
      {lines.map((line, index) => (
        <p key={index} className="mt-[8px] text-[15px] font-semibold leading-[20px] text-[#444]">{money(line.value, line.value % 1 ? 2 : 0)} {line.suffix}</p>
      ))}
    </div>
  )
}

const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

export function BalanceTabView() {
  const monthGen = MONTH_GEN[new Date().getMonth()]
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const { t } = useLanguage()
  const [organization, setOrganization] = useState("Все организации")
  const [applied, setApplied] = useState(false)
  const [period, setPeriod] = useState("МЕСЯЦ")

  const downloadAll = () => {
    const header = [t("Раздел"), "SUM", "USD", "Euro"]
    const body = [
      [t("Баланс на начало периода"), CASH_TOTALS.sum, CASH_TOTALS.usd, CASH_TOTALS.euro],
      [t("Долги клиентов (SUM)"), CLIENT_DEBT_SUM_TOTAL, "", ""],
      [t("Долги клиентов (USD)"), "", CLIENT_DEBT_USD_TOTAL, ""],
      [t("Обязательства перед поставщиками (SUM)"), SUPPLIER_DEBT_SUM_TOTAL, "", ""],
      [t("Обязательства перед поставщиками (USD)"), "", SUPPLIER_DEBT_USD_TOTAL, ""],
    ]
    downloadExcelTable("balance.xls", [header, ...body])
  }

  return (
    <ReportPage>
      <WidgetHeader active="БАЛАНС" />
      <WidgetUserCard period={period} onPeriod={(value) => setPeriod(value)} />


      <section className="mx-[30px] mt-[20px] flex h-[77px] items-center bg-white px-[30px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="w-[240px]"><ReportSelectField label="Организация" value={organization === "Все организации" ? "" : organization} onChange={(value) => setOrganization(value || "Все организации")} options={["Linko"]} clearable={false} /></div>
        <button
          onClick={() => {
            setApplied(true)
            window.setTimeout(() => setApplied(false), 1800)
          }}
          className="ml-auto mr-[18px] mt-[6px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95"
        >
          {applied ? t("Применено ✓") : t("Применить")}
        </button>
        <button onClick={downloadAll} className="mr-[10px] mt-[6px] flex h-[30px] items-center rounded-[3px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">
          <Download className="mr-2 h-4 w-4" /> {t("Скачать Excel")}
        </button>
      </section>

      <section className="mx-[30px] mt-[10px] grid grid-cols-1 gap-[16px] pb-[20px] lg:grid-cols-[420px_1fr_420px]">
        <div>
          <h3 className="mb-[10px] text-[18px] font-semibold">{t("Баланс на")} 1 {monthGen}</h3>
          <div className="grid grid-cols-2 rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] [&>div]:min-h-[110px] [&>div]:border-b [&>div]:border-r [&>div]:border-[#efefef] [&>div]:p-[16px] [&>div:nth-child(2n)]:border-r-0">
            <WidgetCell label={t("Склад")} lines={[{ value: WAREHOUSE_TOTAL, suffix: "SUM" }]} />
            <WidgetCell label={t("Авансы, полученные от покупателей")} info lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Касса")} lines={[{ value: CASH_TOTALS.sum, suffix: "SUM" }, { value: CASH_TOTALS.euro, suffix: "EURO" }, { value: CASH_TOTALS.usd, suffix: "USD" }]} />
            <WidgetCell label={t("Долги поставщикам")} info lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Задолженность клиентов")} info lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Задолженность по оплате труда")} info lines={[{ value: 0, suffix: "SUM" }]} />
            <WidgetCell label={t("Предоплаты поставщикам")} info lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Кешбэк покупателей")} info lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Авансы, выданные по оплате труда")} info lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Сумма обязательств в основной валюте")} lines={[{ value: 0, suffix: "SUM" }]} />
            <WidgetCell label={t("Сумма активов в основной валюте")} lines={[{ value: 0, suffix: "SUM" }]} />
            <WidgetCell label={t("Собственный капитал")} lines={[{ value: 0, suffix: "SUM" }]} />
          </div>
        </div>

        <div className="space-y-[14px]">
          <h3 className="text-[18px] font-semibold">{t("Продажа за период")}</h3>
          <div className="flex items-center gap-[14px] rounded-[12px] bg-white p-[16px] text-[15px] font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            <span className="flex h-[44px] w-[44px] items-center justify-center rounded-[8px] bg-[#f2f5f8]"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d="M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z" /></svg></span>0 SUM
          </div>
          <h3 className="text-[18px] font-semibold">{t("Приход денежных средств")}</h3>
          <div className="rounded-[12px] bg-white p-[16px] text-[15px] font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">0 SUM</div>
          <h3 className="text-[18px] font-semibold">{t("Собственный капитал не изменился")}</h3>
          <div className="rounded-[12px] bg-white p-[16px] text-[15px] font-semibold shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">0 SUM</div>
        </div>

        <div>
          <h3 className="mb-[10px] text-[18px] font-semibold">{t("Баланс на")} {lastDay} {monthGen}</h3>
          <div className="grid grid-cols-2 rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] [&>div]:min-h-[110px] [&>div]:border-b [&>div]:border-r [&>div]:border-[#efefef] [&>div]:p-[16px] [&>div:nth-child(2n)]:border-r-0">
            <WidgetCell label={t("Склад")} lines={[{ value: WAREHOUSE_TOTAL, suffix: "SUM" }]} />
            <WidgetCell label={t("Авансы, полученные от покупателей")} info lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Касса")} lines={[{ value: CASH_TOTALS.sum, suffix: "SUM" }, { value: CASH_TOTALS.euro, suffix: "EURO" }, { value: CASH_TOTALS.usd, suffix: "USD" }]} />
            <WidgetCell label={t("Долги поставщикам")} info lines={[{ value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Задолженность клиентов")} info lines={[{ value: 0, suffix: "EURO" }, { value: 0, suffix: "SUM" }, { value: 0, suffix: "USD" }]} />
            <WidgetCell label={t("Задолженность по оплате труда")} info lines={[{ value: 0, suffix: "SUM" }]} />
          </div>
        </div>
      </section>

      <BalanceSections />
    </ReportPage>
  )
}
