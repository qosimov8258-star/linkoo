"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Expand, MinusCircle, PlusCircle, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

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
  return <span className={`font-semibold ${value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"}`}>{number(value)}</span>
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
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f71dc]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Накопительная карта</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f71dc]">
          Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>
        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {totalLabel}</span>
        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f71dc] p-1 text-[#4f71dc] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-3 md:px-9">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Клиент
            <input placeholder="Введите имя..." value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" />
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-white text-[#17233b]">
              <th className="border-b border-[#e1e5eb] px-4 py-3 text-left font-semibold">Клиент</th>
              <th className="border-b border-[#e1e5eb] bg-[#eaf2fb] px-4 py-3 text-left font-semibold">Euro</th>
              <th className="border-b border-[#e1e5eb] bg-[#eaf2fb] px-4 py-3 text-left font-semibold">SUM</th>
              <th className="border-b border-[#e1e5eb] bg-[#eaf2fb] px-4 py-3 text-left font-semibold">USD</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={row.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", clientId: row.id })} className="text-[#e5484d]"><MinusCircle className="h-6 w-6 fill-[#ff5d63] text-white" /></button>
                    <button aria-label="Добавить" onClick={() => setModal({ type: "add", clientId: row.id })} className="text-[#39ca79]"><PlusCircle className="h-6 w-6 fill-[#39ca79] text-white" /></button>
                    <button onClick={() => setInfoTarget(row)} className="text-[#4f71dc] hover:underline">{row.client}</button>
                  </div>
                </td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.balance.euro} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.balance.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountText value={row.balance.usd} /></td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={4} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
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
    </main>
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
