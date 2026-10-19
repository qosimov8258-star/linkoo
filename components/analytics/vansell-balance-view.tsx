"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Info, MinusCircle, Pencil, PlusCircle, X } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportBalanceBoxes, ReportGridTable, ReportPage, ReportPager, ReportSearchField, type BalanceTone } from "@/components/ref/report-kit"

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

  const lines = (m: Money) => (["eur", "sum", "usd"] as const).map((key) => ({ text: `${number(m[key])} ${key === "eur" ? "Euro" : key.toUpperCase()}`, tone: (m[key] > 0 ? "plus" : m[key] < 0 ? "minus" : "default") as BalanceTone }))
  const zeros = [{ text: "0 Euro" }, { text: "0 SUM" }, { text: "0 USD" }]
  const infoZeros = zeros.map((line) => ({ ...line, info: true }))
  const cur = ["SUM", "USD", "Euro"]
  const money = (m: Money) => [m.sum, m.usd, m.eur].map((value, index) => <AmountCell key={index} value={value} />)

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Баланс вансел" /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[10px]">
        <ReportBalanceBoxes
          columns={[
            { blocks: [{ title: "Передача на склад", lines: lines(transferToWarehouseTotal) }, { title: "Возврат передачи", lines: lines(transferReturnTotal) }] },
            { blocks: [{ title: "Принятие оплаты", lines: infoZeros }, { title: "Отход", lines: zeros }] },
            { blocks: [{ title: "Прочие приходы", lines: zeros }, { title: "Прочие расходы", lines: zeros }] },
            { right: true, blocks: [{ title: "Баланс на начало периода", lines: lines(openingTotal) }, { title: "Баланс на конец периода", lines: lines(closingTotal) }] },
          ]}
        />

        <div className="relative mx-[10px] mt-[16px] flex h-[50px] items-center border-t border-[#e8e8e8]">
          <button onClick={() => setFilterOpen((value) => !value)} className="text-[13px] text-[#1ea1f2]">Показать фильтр ⌄</button>
          {filterOpen && (
            <div className="absolute left-0 top-[46px] z-20 w-[300px] bg-white p-5 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
              <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={260} label="Вансел" />
            </div>
          )}
          <div className="absolute left-[490px]"><ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={180} /></div>
          <div className="ml-auto flex items-center gap-[20px]">
            <button onClick={() => setLimitModalOpen(true)} className="flex h-[30px] items-center rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Pencil className="mr-[10px] h-[16px] w-[16px]" />Изменить лимит</button>
            <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${filtered.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filtered.length)} из ${filtered.length}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
            <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
          </div>
        </div>

        <ReportGridTable
          minWidth={1750}
          loading={loading}
          colWidths={["230px", "30px", ...Array.from({ length: 15 }, () => "")]}
          groups={[{ title: "", span: 2 }, ...["Баланс на начало периода", "Передача на склад", "Возврат передачи", "Наличные", "Перечисление", "Баланс на конец периода"].map((title) => ({ title, span: 3 }))]}
          heads={["Вансел", <input key="all" type="checkbox" checked={allSelected} onChange={toggleAll} className="h-[14px] w-[14px] accent-[#444]" />, ...Array.from({ length: 6 }).flatMap(() => cur)]}
          rows={visible.map((vansel) => {
            const closing = closingBalance(vansel)
            return [
              <div key="n" className="flex items-center gap-[10px]">
                <span className="w-[100px] truncate">{vansel.name}</span>
                <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", vanselId: vansel.id })}><MinusCircle className="h-[22px] w-[22px] fill-[#ff5d63] text-white" /></button>
                <button aria-label="Добавить" onClick={() => setModal({ type: "add", vanselId: vansel.id })}><PlusCircle className="h-[22px] w-[22px] fill-[#71ce87] text-white" /></button>
              </div>,
              <input key="c" type="checkbox" checked={selected.has(vansel.id)} onChange={() => toggleOne(vansel.id)} className="h-[14px] w-[14px] accent-[#444]" />,
              ...money(vansel.opening), ...money(vansel.transferToWarehouse), ...money(vansel.transferReturn), ...money(vansel.cash), ...money(vansel.transferred), ...money(closing),
            ]
          })}
        />
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
    </ReportPage>
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
            className="font-bold uppercase tracking-wide text-[#4f71dc]"
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
          <button onClick={onClose} className="font-bold uppercase tracking-wide text-[#4f71dc]">Сохранить</button>
        </footer>
      </div>
    </div>
  )
}
