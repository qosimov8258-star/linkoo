"use client"

import { useMemo, useState } from "react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportFilterPanel, ReportGridTable, ReportMoneyBox, ReportPage, ReportRangeField, ReportSortHead, ReportTopRow } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"

import { registers, type Currency, type Register } from "./cash-balance-data"


const FIXED_TOTALS = { opening: { euro: 20, sum: 25884391057.44, usd: 6577793.296 }, closing: { euro: 20, sum: 25884391057.44, usd: 6577793.296 } }

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

function toIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function formatDate(date: Date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

function AmountCell({ amount, currency }: { amount: number; currency: Currency }) {
  if (amount === 0) return <span>0</span>
  const color = amount > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(amount)} {currency}</span>
}

type SortKey = "opening" | "income" | "expense" | "transferIn" | "transferOut" | "closing"
type SortDir = "asc" | "desc"

export function CashBalanceView() {
  const [filterOpen, setFilterOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const today = useMemo(() => new Date(), [])
  const defaultFrom = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [appliedFrom, setAppliedFrom] = useState(() => formatDate(defaultFrom))
  const [appliedTo, setAppliedTo] = useState(() => formatDate(today))

  const filterCount = appliedFrom && appliedTo ? 1 : 0

  const sorted = useMemo(() => {
    if (!sortKey) return registers
    const copy = [...registers]
    copy.sort((a, b) => {
      const valueOf = (row: Register) => {
        if (sortKey === "opening") return row.openingAmount
        if (sortKey === "closing") return row.openingAmount + row.income - row.expense + row.transferIn - row.transferOut
        return row[sortKey]
      }
      const result = valueOf(a) - valueOf(b)
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [sortDir, sortKey])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((direction) => (direction === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const applyFilter = () => {
    if (dateFrom) setAppliedFrom(formatDate(new Date(dateFrom)))
    if (dateTo) setAppliedTo(formatDate(new Date(dateTo)))
    setFilterOpen(false)
  }

  const downloadAll = () => {
    const header = ["Кассы", "Баланс на начало периода", "Приход за период", "Расход за период", "Перевод на кассу", "Перевод с кассы", "Баланс на конец периода", "Кассир", "Тип"]
    const body = sorted.map((row) => {
      const closing = row.openingAmount + row.income - row.expense + row.transferIn - row.transferOut
      return [
        row.name,
        row.openingAmount === 0 ? "0" : `${money(row.openingAmount)} ${row.openingCurrency}`,
        row.income,
        row.expense,
        row.transferIn,
        row.transferOut,
        closing === 0 ? "0" : `${money(closing)} ${row.openingCurrency}`,
        row.cashier,
        row.type,
      ]
    })
    downloadExcelTable("cash-balance.xls", [header, ...body])
  }

  const lineText = (euro: number | string, sum: number | string, usd: number | string, tone?: "plus" | "minus") => [
    { text: `${euro} Euro`, tone },
    { text: `${typeof sum === "number" ? money(sum) : sum} SUM`, tone },
    { text: `${typeof usd === "number" ? money(usd) : usd} USD`, tone },
  ]

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Баланс кассы" /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[21px]">
        <div className="px-[30px]">
          <ReportTopRow filterLabel={`Фильтр / ${filterCount}`} scope={`${appliedFrom} - ${appliedTo} Во всей организации`} onFilter={() => setFilterOpen(true)} onDownload={downloadAll} />
          <div className="mt-[15px] grid grid-cols-1 gap-x-[10px] gap-y-[10px] sm:grid-cols-2 lg:grid-cols-4">
            <ReportMoneyBox title="Баланс на начало периода" lines={lineText(FIXED_TOTALS.opening.euro, FIXED_TOTALS.opening.sum, FIXED_TOTALS.opening.usd)} />
            <ReportMoneyBox title="Приход за период" lines={lineText(0, 0, 0, "plus")} />
            <ReportMoneyBox title="Перевод на кассу" lines={lineText(0, 0, 0, "plus")} />
            <ReportMoneyBox title="Баланс на конец периода" right lines={lineText(FIXED_TOTALS.closing.euro, FIXED_TOTALS.closing.sum, FIXED_TOTALS.closing.usd)} />
            <ReportMoneyBox title="Расход за период" className="lg:col-start-2" lines={lineText(0, 0, 0, "minus")} />
            <ReportMoneyBox title="Перевод с кассы" lines={lineText(0, 0, 0, "minus")} />
          </div>
        </div>

        <div className="mt-[20px] px-[30px]">
          <ReportGridTable
            minWidth={1400}
            headClass="bg-[#4f71dc]"
            headTextClass="text-white"
            heads={[
              <span key="k" className="font-semibold text-white">Кассы</span>,
              ...([["Баланс на начало периода", "opening"], ["Приход за период", "income"], ["Расход за период", "expense"], ["Перевод на кассу", "transferIn"], ["Перевод с кассы", "transferOut"], ["Баланс на конец периода", "closing"]] as const).map(([label, key]) => <ReportSortHead key={key} label={label} active={sortKey === key} dir={sortDir} onClick={() => toggleSort(key)} />),
              <span key="c" className="font-semibold text-white">Кассир</span>,
              <span key="t" className="font-semibold text-white">Тип</span>,
            ]}
            rows={sorted.map((row) => {
              const closing = row.openingAmount + row.income - row.expense + row.transferIn - row.transferOut
              return [row.name, <AmountCell key="o" amount={row.openingAmount} currency={row.openingCurrency} />, 0, 0, 0, 0, <AmountCell key="c" amount={closing} currency={row.openingCurrency} />, row.cashier, row.type]
            })}
          />
        </div>
      </section>

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={applyFilter}>
          <ReportRangeField label="Диапазон дат" from={dateFrom || toIso(defaultFrom)} to={dateTo || toIso(today)} onFrom={setDateFrom} onTo={setDateTo} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
