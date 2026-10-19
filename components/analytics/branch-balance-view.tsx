"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, MinusCircle, PlusCircle, X } from "lucide-react"

import { RefHeader } from "@/components/ref/list-kit"
import { ReportAmount, ReportBalanceBoxes, ReportBalanceToolbar, ReportGridTable, ReportPage, ReportPager, ReportSearchField, type BalanceTone } from "@/components/ref/report-kit"

type Money = { sum: number; usd: number }
type Branch = { id: number; name: string; opening: Money }

const branches: Branch[] = []


const groups = ["Баланс на начало периода", "Передача на склад", "Возврат передачи", "Оплата", "Прочие приходы", "Прочие расходы", "Баланс на конец"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

export function BranchBalanceView() {
  const [rows, setRows] = useState(branches)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ type: "add" | "expense"; branchId: number } | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/branches").then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить филиалы")
        return (await response.json()) as { id: number; name: string }[]
      }),
      fetch("/api/branch-balance-transactions").then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить транзакции")
        return (await response.json()) as { branchId: number; kind: "add" | "expense"; currency: keyof Money; amount: number }[]
      }),
    ])
      .then(([branchList, transactions]) => {
        if (cancelled) return
        const withTx = new Set(transactions.map((transaction) => transaction.branchId))
        const merged: Branch[] = branchList.filter((item) => withTx.has(item.id)).map((item) => {
          const opening = transactions
            .filter((transaction) => transaction.branchId === item.id)
            .reduce(
              (acc, transaction) => {
                const signed = transaction.kind === "expense" ? -transaction.amount : transaction.amount
                return { ...acc, [transaction.currency]: acc[transaction.currency] + signed }
              },
              { sum: 0, usd: 0 } as Money,
            )
          return { id: item.id, name: item.name, opening }
        })
        setRows(merged.sort((a, b) => b.opening.sum - a.opening.sum || b.opening.usd - a.opening.usd))
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить баланс филиалов с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () => rows.filter((branch) => branch.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [rows, search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const TOTAL_BRANCHES = rows.length
  const FIXED_TOTALS = rows.reduce((acc, branch) => ({ sum: acc.sum + branch.opening.sum, usd: acc.usd + branch.opening.usd }), { sum: 0, usd: 0 })
  const totalLabel = isDefaultView ? TOTAL_BRANCHES : filtered.length

  const applyTransaction = (branchId: number, kind: "add" | "expense", currency: keyof Money, amount: number) => {
    setRows((current) =>
      current.map((branch) => {
        if (branch.id !== branchId) return branch
        const signedAmount = kind === "add" ? amount : -amount
        return { ...branch, opening: { ...branch.opening, [currency]: branch.opening[currency] + signedAmount } }
      }),
    )
  }

  const saveTransaction = async (
    branchId: number,
    branchName: string,
    kind: "add" | "expense",
    currency: keyof Money,
    amount: number,
    date: string,
    comment: string,
  ) => {
    try {
      const response = await fetch("/api/branch-balance-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, branchName, kind, currency, amount, date, comment }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось сохранить транзакцию")
        return false
      }
      applyTransaction(branchId, kind, currency, amount)
      return true
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
      return false
    }
  }

  const zeros = [{ text: "0 SUM" }, { text: "0 USD" }]
  const tone = (value: number): BalanceTone => (value > 0 ? "plus" : value < 0 ? "minus" : "default")
  const openingLines = [
    { text: `${money(FIXED_TOTALS.sum)} SUM`, tone: tone(FIXED_TOTALS.sum) },
    { text: `${money(FIXED_TOTALS.usd)} USD`, tone: tone(FIXED_TOTALS.usd) },
  ]
  const pair = (m: Money) => [m.sum, m.usd].map((value, index) => <ReportAmount key={index} value={value} />)

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Баланс филиалов" /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[10px]">
        {loadError && <p className="px-[30px] pb-2 text-[13px] text-red-500">{loadError}</p>}
        <ReportBalanceBoxes
          columns={[
            { blocks: [{ title: "Баланс на начало периода", lines: openingLines }, { title: "Принятие оплаты", lines: zeros }] },
            { blocks: [{ title: "Передача на склад", lines: zeros }, { title: "Возврат передачи", lines: zeros }] },
            { blocks: [{ title: "Прочие приходы", lines: zeros }, { title: "Прочие расходы", lines: zeros }] },
            { right: true, blocks: [{ title: "Баланс на конец периода", lines: openingLines }] },
          ]}
        />

        <ReportBalanceToolbar
          onFilter={() => setFilterOpen((value) => !value)}
          search={search}
          onSearch={(value) => { setSearch(value); setPage(1) }}
          pager={
            <div className="flex items-center gap-[20px]">
              <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${filtered.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filtered.length)} из ${totalLabel}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
              <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
            </div>
          }
        />
        {filterOpen && (
          <div className="mx-[10px] w-[300px] bg-white p-5 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={260} label="Филиал" />
          </div>
        )}

        <ReportGridTable
          minWidth={1750}
          colWidths={["220px", ...Array.from({ length: 14 }, () => "")]}
          groups={[{ title: "", span: 1 }, ...groups.map((group) => ({ title: group, span: 2 }))]}
          heads={["Филиал", ...groups.flatMap(() => ["SUM", "USD"])]}
          rows={visible.map((branch) => [
            <div key="n" className="flex items-center gap-[10px]">
              <span className="w-[110px] truncate">{branch.name}</span>
              <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", branchId: branch.id })}><MinusCircle className="h-[22px] w-[22px] fill-[#ff5d63] text-white" /></button>
              <button aria-label="Добавить" onClick={() => setModal({ type: "add", branchId: branch.id })}><PlusCircle className="h-[22px] w-[22px] fill-[#71ce87] text-white" /></button>
            </div>,
            ...pair(branch.opening),
            ...Array.from({ length: 10 }, () => 0),
            ...pair(branch.opening),
          ])}
        />
      </section>

      {modal && (
        <TransactionModal
          branch={rows.find((item) => item.id === modal.branchId)!}
          type={modal.type}
          onClose={() => setModal(null)}
          onSave={async (currency, amount, date, comment) => {
            const branch = rows.find((item) => item.id === modal.branchId)
            const ok = await saveTransaction(modal.branchId, branch?.name ?? "", modal.type, currency, amount, date, comment)
            if (ok) setModal(null)
          }}
        />
      )}

    </ReportPage>
  )
}

function TransactionModal({
  branch,
  type,
  onClose,
  onSave,
}: {
  branch: Branch
  type: "add" | "expense"
  onClose: () => void
  onSave: (currency: keyof Money, amount: number, date: string, comment: string) => void
}) {
  const [currency, setCurrency] = useState<keyof Money>("sum")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[600px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">{type === "add" ? "Добавить" : "Добавить расход"}</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Филиал
            <div className="mt-1 text-[16px] font-semibold text-[#17233b]">{branch.name}</div>
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value as keyof Money)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              <option value="sum">SUM</option>
              <option value="usd">USD</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Сумма
            <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Дата создания
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            <input placeholder="Оставить комментарий..." value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] outline-none placeholder:text-[#586174]" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button
            onClick={() => {
              const value = Number(amount)
              if (value > 0) onSave(currency, value, date, comment)
            }}
            className="font-bold uppercase tracking-wide text-[#4f71dc]"
          >
            Сохранить
          </button>
        </footer>
      </div>
    </div>
  )
}
