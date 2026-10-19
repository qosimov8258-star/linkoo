"use client"

import { useEffect, useMemo, useState } from "react"
import { RefCard, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"

type Status = "pending" | "confirmed" | "paid" | "cancelled"
type ExpenseRow = {
  id: number
  supplier: string
  date: string
  debt: number
  stock: number
  amount: number
  currency: "SUM" | "USD" | "Euro"
  status: Status
  comment?: string
}


const statusLabel: Record<Status, string> = {
  pending: "В ожидании",
  confirmed: "Подтвержден",
  paid: "Оплачен",
  cancelled: "Отменен",
}
const statusColor: Record<Status, string> = {
  pending: "text-[#f0ad4e]",
  confirmed: "text-[#4f71dc]",
  paid: "text-[#71ce87]",
  cancelled: "text-[#f06c6c]",
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

type ApiSupplier = { id: number; name: string }
type SupplierTransaction = { id: number; supplierId: number; kind: string; currency: "sum" | "usd" | "eur"; amount: number; date: string; comment: string }
const currencyLabel = { sum: "SUM", usd: "USD", eur: "Euro" } as const

export function ExpectedExpensesView() {
  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [tab, setTab] = useState<"pending" | "confirmed" | "paid" | "all">("all")
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Expected expenses are the "fund request" transactions raised from the supplier balance report.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/suppliers").then((response) => (response.ok ? (response.json() as Promise<ApiSupplier[]>) : [])),
      fetch("/api/supplier-balance-transactions").then((response) => (response.ok ? (response.json() as Promise<SupplierTransaction[]>) : [])),
    ])
      .then(([suppliers, transactions]) => {
        if (cancelled) return
        const names = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
        setRows(
          transactions
            .filter((transaction) => transaction.kind === "fund_request")
            .map((transaction) => ({
              id: transaction.id,
              supplier: names.get(transaction.supplierId) ?? "",
              date: transaction.date,
              debt: 0,
              stock: 0,
              amount: transaction.amount,
              currency: currencyLabel[transaction.currency],
              status: "pending" as Status,
              comment: transaction.comment || undefined,
            }))
            .sort((a, b) => b.id - a.id),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab !== "all" && row.status !== tab) return false
      if (search.trim() && !row.supplier.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      return true
    })
  }, [rows, search, tab])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const tabLabels = { pending: "В ожидании", confirmed: "Подтвержденные", paid: "Оплаченные", all: "Все" } as const

  return (
    <RefPage>
      <RefHeader title="Ожидаемые расходы" />
      <RefTabs
        labels={Object.values(tabLabels)}
        value={tabLabels[tab]}
        onChange={(label) => { const next = (Object.keys(tabLabels) as (keyof typeof tabLabels)[]).find((key) => tabLabels[key] === label); if (next) { setTab(next); setPage(1); setExpandedId(null) } }}
      />
      <div className="mt-[19px]">
        <RefCard>
          <RefToolbar
            hideFilter
            query={search}
            onQuery={(value) => { setSearch(value); setPage(1) }}
            pageSize={pageSize}
            onPageSize={(size) => { setPageSize(size); setPage(1) }}
            from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
            to={Math.min(safePage * pageSize, filtered.length)}
            total={filtered.length}
            page={safePage}
            pageCount={maxPage}
            onPage={setPage}
          />
          <RefTable
            cols="0.54fr 1.5fr 1.2fr 1.1fr 0.9fr 1fr 1.1fr"
            heads={["№", "Поставщик", "Дата создания", "Задолженность", "Запас", "Сумма оплаты", "Статус"]}
            rows={visible}
            rowKey={(row) => row.id}
            onRowClick={(row) => setExpandedId((current) => (current === row.id ? null : row.id))}
            empty="Ничего не найдено"
            render={(row) => [
              row.id,
              row.supplier,
              row.date,
              number(row.debt),
              number(row.stock),
              `${number(row.amount)} ${row.currency}`,
              <span key="s" className={statusColor[row.status]}>{statusLabel[row.status]}</span>,
            ]}
            expanded={(row) => expandedId === row.id ? (
              <div className="bg-[#f2f5f8] px-6 py-6">
                <div className="bg-white p-6 shadow-md">
                  <h3 className="mb-5 text-[15px] font-bold">Запрос №{row.id} <span className={statusColor[row.status]}>({statusLabel[row.status]})</span></h3>
                  <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                    <div className="space-y-4">
                      {[["Поставщик", row.supplier], ["Сумма оплаты", `${number(row.amount)} ${row.currency}`]].map(([label, value]) => (
                        <div key={label} className="flex justify-between border-b border-dotted border-[#d6d6d6] pb-2"><span className="text-[#555]">{label}</span><span className="font-semibold">{value}</span></div>
                      ))}
                      <h4 className="pt-3 text-[12px] font-bold uppercase text-[#555]">Оплата:</h4>
                      {[["Баланс", `0 ${row.currency}`], ["Резерв", `0 ${row.currency}`], ["К оплате", `${row.status === "cancelled" ? 0 : number(row.amount)} ${row.currency}`]].map(([label, value]) => (
                        <div key={label} className="flex justify-between border-b border-dotted border-[#d6d6d6] pb-2"><span className="text-[#555]">{label}</span><span className="font-semibold">{value}</span></div>
                      ))}
                    </div>
                    <div>
                      <h4 className="mb-2 text-[12px] font-bold uppercase text-[#555]">Комментарий:</h4>
                      <p>{row.comment ?? "Не указано"}</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          />
        </RefCard>
      </div>
    </RefPage>
  )
}
