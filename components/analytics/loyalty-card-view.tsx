"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, MinusCircle, PlusCircle, X } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage, ReportPager, ReportSearchField } from "@/components/ref/report-kit"

type Money = { euro: number; sum: number; usd: number }
type Transaction = { id: number; type: string; action: string; date: string; amount: number; currency: keyof Money }
type CardClient = {
  id: number
  client: string
  balance: Money
  transactions: Transaction[]
}

const clients: CardClient[] = []

const TOTAL_CLIENTS = 0

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountText({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  return <span className={value > 0 ? "text-[#71ce87]" : "text-[#e57373]"}>{number(value)}</span>
}

export function LoyaltyCardView() {
  const [rows, setRows] = useState(clients)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [infoTarget, setInfoTarget] = useState<CardClient | null>(null)
  const [modal, setModal] = useState<{ type: "add" | "expense"; clientId: number } | null>(null)

  const filtered = useMemo(
    () => rows.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [rows, search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const totalLabel = isDefaultView ? TOTAL_CLIENTS : filtered.length

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/loyalty-card")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные")
        return (await response.json()) as CardClient[]
      })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const applyTransaction = async (clientId: number, kind: "add" | "expense", currency: keyof Money, amount: number, comment: string) => {
    try {
      const response = await fetch("/api/loyalty-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, currency, amount, kind, comment }),
      })
      if (!response.ok) return
      const saved = (await response.json()) as CardClient
      setRows((current) => current.map((row) => (row.id === clientId ? saved : row)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Накопительная карта" /></div>

      <section className="mx-[28px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="relative flex h-[55px] items-center">
          <button onClick={() => setFilterOpen((value) => !value)} className="ml-[30px] self-start pt-[12px] text-[13px] text-[#4f71dc]">Показать фильтр ⌄</button>
          <div className="absolute left-[460px] top-[16px]"><ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={255} /></div>
          <div className="ml-auto flex items-center gap-[20px] pr-[30px] pt-[8px]">
            <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${filtered.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filtered.length)} из ${totalLabel}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
            <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
          </div>
        </div>
        {filterOpen && (
          <div className="mx-[25px] mb-3 w-[300px] bg-white p-5 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={260} label="Клиент" />
          </div>
        )}

        <div className="flex overflow-x-auto border-t border-[#e8e8e8] text-[13px]">
          <div className="w-[300px] shrink-0 shadow-[2px_0_4px_rgba(0,0,0,0.1)]">
            <div className="flex h-[40px] items-center border-b border-[#e8e8e8] px-[15px] font-semibold">Клиент</div>
            {visible.map((row, index) => (
              <div key={row.id} className={`flex h-[40px] items-center justify-between px-[15px] ${index % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                <button onClick={() => setInfoTarget(row)} className="max-w-[190px] truncate text-left hover:underline">{row.client}</button>
                <span className="flex items-center gap-[12px]">
                  <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", clientId: row.id })}><MinusCircle className="h-[20px] w-[20px] fill-[#ff5d63] text-white" /></button>
                  <button aria-label="Добавить" onClick={() => setModal({ type: "add", clientId: row.id })}><PlusCircle className="h-[20px] w-[20px] fill-[#71ce87] text-white" /></button>
                </span>
              </div>
            ))}
          </div>
          <div className="min-w-[600px] flex-1">
            <div className="grid h-[40px] grid-cols-[200px_522px_1fr] items-center border-b border-[#e8e8e8] bg-white px-[20px] font-semibold text-[#555]"><span>Euro</span><span>SUM</span><span>USD</span></div>
            {visible.map((row, index) => (
              <div key={row.id} className={`grid h-[40px] grid-cols-[200px_522px_1fr] items-center px-[20px] ${index % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                <AmountText value={row.balance.euro} /><AmountText value={row.balance.sum} /><AmountText value={row.balance.usd} />
              </div>
            ))}
          </div>
        </div>
        {!loading && visible.length === 0 && <p className="py-16 text-center text-[13px] text-[#8c8c8c]">Ничего не найдено</p>}
      </section>

      {infoTarget && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 py-16" onClick={() => setInfoTarget(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[1000px] max-w-[94vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">Информация по клиенту {infoTarget.client}</h2>
              <button aria-label="Закрыть" onClick={() => setInfoTarget(null)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="text-left text-[#586174]">
                  <th className="border-b border-[#e1e5eb] px-8 py-4 font-semibold">Тип</th>
                  <th className="border-b border-[#e1e5eb] px-8 py-4 font-semibold">Акция</th>
                  <th className="border-b border-[#e1e5eb] px-8 py-4 font-semibold">Дата</th>
                  <th className="border-b border-[#e1e5eb] px-8 py-4 font-semibold">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {(rows.find((row) => row.id === infoTarget.id)?.transactions ?? []).map((tx) => (
                  <tr key={tx.id} className="border-b border-dashed border-slate-200">
                    <td className="px-8 py-4">{tx.type}</td>
                    <td className="px-8 py-4">{tx.action}</td>
                    <td className="px-8 py-4">{tx.date}</td>
                    <td className="px-8 py-4"><AmountText value={tx.amount} /> {tx.currency.toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(rows.find((row) => row.id === infoTarget.id)?.transactions.length ?? 0) === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="text-6xl">🤖</div>
                <p className="mt-4 text-[#9aa3b6]">Пока транзакции нет</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t px-8 py-4 text-[#586174]">
              1 - {rows.find((row) => row.id === infoTarget.id)?.transactions.length ?? 0} из {rows.find((row) => row.id === infoTarget.id)?.transactions.length ?? 0}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <TransactionModal
          client={rows.find((item) => item.id === modal.clientId)!}
          type={modal.type}
          onClose={() => setModal(null)}
          onSave={(currency, amount, comment) => {
            void applyTransaction(modal.clientId, modal.type, currency, amount, comment)
            setModal(null)
          }}
        />
      )}
    </ReportPage>
  )
}

function TransactionModal({
  client,
  type,
  onClose,
  onSave,
}: {
  client: CardClient
  type: "add" | "expense"
  onClose: () => void
  onSave: (currency: keyof Money, amount: number, comment: string) => void
}) {
  const [currency, setCurrency] = useState<keyof Money>("sum")
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[560px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">{type === "add" ? "Добавить приход клиенту" : "Добавить расход клиенту"}</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <p className="text-[15px]"><span className="text-[#586174]">Клиент:</span> <span className="font-semibold">{client.client}</span></p>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Цена
            <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value as keyof Money)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              <option value="sum">SUM</option>
              <option value="usd">USD</option>
              <option value="euro">Euro</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Комментарий
            <input value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] outline-none" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button
            onClick={() => {
              const value = Number(amount)
              if (value > 0) onSave(currency, value, comment)
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
