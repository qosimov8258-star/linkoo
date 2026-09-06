"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  Expand,
  Filter,
  Info,
  MinusCircle,
  Pencil,
  PlusCircle,
  Search,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Money = { sum: number; usd: number; eur: number }
type Vansel = {
  id: number
  name: string
  opening: Money
  transferToWarehouse: Money
  transferReturn: Money
  cash: Money
  transferred: Money
}

const zero: Money = { sum: 0, usd: 0, eur: 0 }

const initialVansels: Vansel[] = []

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function addMoney(a: Money, b: Money): Money {
  return { sum: a.sum + b.sum, usd: a.usd + b.usd, eur: a.eur + b.eur }
}

function closingBalance(vansel: Vansel): Money {
  return addMoney(addMoney(addMoney(vansel.opening, vansel.transferToWarehouse), vansel.cash), vansel.transferred)
}

function AmountCell({ value }: { value: number }) {
  if (value > 0) return <span className="text-[#3aa76d]">{number(value)}</span>
  if (value < 0) return <span className="text-[#e5484d]">{number(value)}</span>
  return <span className="text-[#17233b]">0</span>
}

export function VansellBalanceView() {
  const [vansels, setVansels] = useState(initialVansels)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ type: "add" | "expense"; vanselId: number } | null>(null)
  const [limitModalOpen, setLimitModalOpen] = useState(false)

  const filtered = useMemo(
    () => vansels.filter((vansel) => vansel.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search, vansels],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const openingTotal = vansels.reduce((acc, vansel) => addMoney(acc, vansel.opening), zero)
  const closingTotal = vansels.reduce((acc, vansel) => addMoney(acc, closingBalance(vansel)), zero)
  const transferToWarehouseTotal = vansels.reduce((acc, vansel) => addMoney(acc, vansel.transferToWarehouse), zero)
  const transferReturnTotal = vansels.reduce((acc, vansel) => addMoney(acc, vansel.transferReturn), zero)

  const allSelected = visible.length > 0 && visible.every((vansel) => selected.has(vansel.id))
  const toggleAll = () => {
    setSelected((current) => {
      if (allSelected) {
        const next = new Set(current)
        visible.forEach((vansel) => next.delete(vansel.id))
        return next
      }
      const next = new Set(current)
      visible.forEach((vansel) => next.add(vansel.id))
      return next
    })
  }
  const toggleOne = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/vansell-transactions")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные")
        return (await response.json()) as Vansel[]
      })
      .then((data) => {
        if (!cancelled) setVansels(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const applyTransaction = async (vanselId: number, kind: "add" | "expense", currency: keyof Money, amount: number) => {
    try {
      const response = await fetch("/api/vansell-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vanselId, currency, amount, kind }),
      })
      if (!response.ok) return
      const saved = (await response.json()) as Vansel
      setVansels((current) => current.map((vansel) => (vansel.id === vanselId ? saved : vansel)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Баланс вансел</span>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
        <div className="space-y-6">
          <div>
            <p className="text-[#586174]">Передача на склад</p>
            <p className="font-semibold"><AmountCell value={transferToWarehouseTotal.eur} /> Euro</p>
            <p className="font-semibold"><AmountCell value={transferToWarehouseTotal.sum} /> SUM</p>
            <p className="font-semibold"><AmountCell value={transferToWarehouseTotal.usd} /> USD</p>
          </div>
          <div>
            <p className="text-[#586174]">Возврат передачи</p>
            <p className="font-semibold"><AmountCell value={transferReturnTotal.eur} /> Euro</p>
            <p className="font-semibold"><AmountCell value={transferReturnTotal.sum} /> SUM</p>
            <p className="font-semibold"><AmountCell value={transferReturnTotal.usd} /> USD</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-[#586174]">Принятие оплаты</p>
            <p className="flex items-center gap-1.5 font-semibold"><Info className="h-4 w-4 text-[#9aa3b6]" /> 0 Euro</p>
            <p className="flex items-center gap-1.5 font-semibold"><Info className="h-4 w-4 text-[#9aa3b6]" /> 0 SUM</p>
            <p className="flex items-center gap-1.5 font-semibold"><Info className="h-4 w-4 text-[#9aa3b6]" /> 0 USD</p>
          </div>
          <div>
            <p className="text-[#586174]">Отход</p>
            <p className="font-semibold">0 Euro</p>
            <p className="font-semibold">0 SUM</p>
            <p className="font-semibold">0 USD</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-[#586174]">Прочие приходы</p>
            <p className="font-semibold">0 Euro</p>
            <p className="font-semibold">0 SUM</p>
            <p className="font-semibold">0 USD</p>
          </div>
          <div>
            <p className="text-[#586174]">Прочие расходы</p>
            <p className="font-semibold">0 Euro</p>
            <p className="font-semibold">0 SUM</p>
            <p className="font-semibold">0 USD</p>
          </div>
        </div>

        <div className="space-y-6 lg:text-right">
          <div>
            <p className="text-[#586174]">Баланс на начало периода</p>
            <p className="font-semibold"><AmountCell value={openingTotal.eur} /> Euro</p>
            <p className="font-semibold"><AmountCell value={openingTotal.sum} /> SUM</p>
            <p className="font-semibold"><AmountCell value={openingTotal.usd} /> USD</p>
          </div>
          <div>
            <p className="text-[#586174]">Баланс на конец периода</p>
            <p className="font-semibold"><AmountCell value={closingTotal.eur} /> Euro</p>
            <p className="font-semibold"><AmountCell value={closingTotal.sum} /> SUM</p>
            <p className="font-semibold"><AmountCell value={closingTotal.usd} /> USD</p>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-5 border-b border-[#e1e5eb] bg-white px-6 py-3 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          <Filter className="h-4 w-4" /> Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>

        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>

        <button onClick={() => setLimitModalOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f71dc] px-5 font-semibold text-white">
          <Pencil className="h-5 w-5" /> Изменить лимит
        </button>

        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>

        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}</span>

        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 rotate-90" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-3 md:px-9">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Вансел
            <input placeholder="Введите имя..." className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" onChange={(event) => setSearch(event.target.value)} value={search} />
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1750px] w-full border-collapse text-[14px]">
          <thead className="bg-[#edf2f7] text-[#253653]">
            <tr>
              <th className="border border-[#e1e5eb] px-4 py-2" />
              <th className="border border-[#e1e5eb] px-2 py-2" />
              <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Баланс на начало периода</th>
              <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Передача на склад</th>
              <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Возврат передачи</th>
              <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Наличные</th>
              <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Перечисление</th>
              <th colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">Баланс на конец периода</th>
            </tr>
            <tr>
              <th className="border border-[#e1e5eb] px-4 py-2 text-left font-semibold">Вансел</th>
              <th className="border border-[#e1e5eb] px-2 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-[#4f70e7]" /></th>
              {Array.from({ length: 6 }).map((_, groupIndex) =>
                ["SUM", "USD", "Euro"].map((currency) => (
                  <th key={`${groupIndex}-${currency}`} className="border border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((vansel, index) => {
              const closing = closingBalance(vansel)
              return (
                <tr key={vansel.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                  <td className="border border-[#e1e5eb] px-4 py-4">
                    <div className="flex items-center gap-2">
                      <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", vanselId: vansel.id })} className="text-[#ff5d63] hover:text-[#e5484d]"><MinusCircle className="h-6 w-6 fill-[#ff5d63] text-white" /></button>
                      <button aria-label="Добавить" onClick={() => setModal({ type: "add", vanselId: vansel.id })} className="text-[#39ca79] hover:text-[#2fb56b]"><PlusCircle className="h-6 w-6 fill-[#39ca79] text-white" /></button>
                      <span>{vansel.name}</span>
                    </div>
                  </td>
                  <td className="border border-[#e1e5eb] px-2 py-4 text-center">
                    <input type="checkbox" checked={selected.has(vansel.id)} onChange={() => toggleOne(vansel.id)} className="h-4 w-4 accent-[#4f70e7]" />
                  </td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.opening.sum} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.opening.usd} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.opening.eur} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferToWarehouse.sum} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferToWarehouse.usd} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferToWarehouse.eur} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferReturn.sum} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferReturn.usd} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferReturn.eur} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.cash.sum} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.cash.usd} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.cash.eur} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferred.sum} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferred.usd} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={vansel.transferred.eur} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={closing.sum} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={closing.usd} /></td>
                  <td className="border border-[#e1e5eb] px-4 py-4"><AmountCell value={closing.eur} /></td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={20} className="border border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {modal && (
        <TransactionModal
          vansel={vansels.find((item) => item.id === modal.vanselId)!}
          type={modal.type}
          onClose={() => setModal(null)}
          onSave={(currency, amount) => {
            applyTransaction(modal.vanselId, modal.type, currency, amount)
            setModal(null)
          }}
        />
      )}

      {limitModalOpen && <LimitModal count={selected.size || visible.length} onClose={() => setLimitModalOpen(false)} />}
    </main>
  )
}

function TransactionModal({
  vansel,
  type,
  onClose,
  onSave,
}: {
  vansel: Vansel
  type: "add" | "expense"
  onClose: () => void
  onSave: (currency: keyof Money, amount: number) => void
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
            Пользователь
            <div className="mt-1 flex items-center justify-between text-[16px] font-semibold text-[#17233b]">
              {vansel.name}
              <span className="flex items-center gap-2 text-[#9aa3b6]"><X className="h-4 w-4" /><ChevronDown className="h-4 w-4" /></span>
            </div>
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Валюта
            <select value={currency} onChange={(event) => setCurrency(event.target.value as keyof Money)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              <option value="sum">SUM</option>
              <option value="usd">USD</option>
              <option value="eur">Euro</option>
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
              if (value > 0) onSave(currency, value)
            }}
            className="font-bold uppercase tracking-wide text-[#4f70e7]"
          >
            Сохранить
          </button>
        </footer>
      </div>
    </div>
  )
}

function LimitModal({ count, onClose }: { count: number; onClose: () => void }) {
  const [limit, setLimit] = useState("")
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[460px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">Изменить лимит</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="px-8 py-7">
          <p className="mb-5 text-sm text-[#586174]">Будет применено к {count} {count === 1 ? "вансел" : "вансел(ам)"}</p>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Новый лимит (SUM)
            <input type="number" value={limit} onChange={(event) => setLimit(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button onClick={onClose} className="font-bold uppercase tracking-wide text-[#4f70e7]">Сохранить</button>
        </footer>
      </div>
    </div>
  )
}
