"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Download, Expand, Filter, MoreVertical, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"

type Money = { sum: number; usd: number; eur: number }
type Employee = { id: number; name: string; opening: Money }
type ApiEmployee = { id: number; name: string }
type BalanceTransaction = {
  id: number
  employeeId: number
  kind: "add" | "expense"
  currency: keyof Money
  amount: number
  date: string
  comment: string
}

const zero: Money = { sum: 0, usd: 0, eur: 0 }

const groups = ["Баланс на начало периода", "Зарплата", "Зачислено KPI", "Введено с кассы", "Штрафы", "Коректировки", "Баланс на конец периода"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

export function EmployeeBalanceView() {
  const [employeesList, setEmployeesList] = useState<ApiEmployee[]>([])
  const [transactions, setTransactions] = useState<BalanceTransaction[]>([])
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null)
  const [modal, setModal] = useState<{ type: "add" | "expense"; employeeId: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpenId(null)
    }
    document.addEventListener("mousedown", closeMenu)
    return () => document.removeEventListener("mousedown", closeMenu)
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch("/api/employees").then((response) => (response.ok ? response.json() : [])),
      fetch("/api/employee-balance-transactions").then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([employeesData, transactionsData]) => {
        if (cancelled) return
        setEmployeesList(Array.isArray(employeesData) ? employeesData : [])
        setTransactions(Array.isArray(transactionsData) ? transactionsData : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<Employee[]>(
    () =>
      employeesList.map((employee) => {
        const opening = { ...zero }
        transactions
          .filter((transaction) => transaction.employeeId === employee.id)
          .forEach((transaction) => {
            const signed = transaction.kind === "add" ? transaction.amount : -transaction.amount
            opening[transaction.currency] += signed
          })
        return { id: employee.id, name: employee.name, opening }
      }),
    [employeesList, transactions],
  )

  const TOTAL_EMPLOYEES = rows.length
  const FIXED_TOTALS = useMemo(
    () =>
      rows.reduce(
        (totals, employee) => ({
          sum: totals.sum + employee.opening.sum,
          usd: totals.usd + employee.opening.usd,
          eur: totals.eur + employee.opening.eur,
        }),
        { sum: 0, usd: 0, eur: 0 },
      ),
    [rows],
  )

  const filtered = useMemo(
    () => rows.filter((employee) => employee.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [rows, search],
  )

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const totalLabel = isDefaultView ? TOTAL_EMPLOYEES : filtered.length

  const applyTransaction = async (employeeId: number, kind: "add" | "expense", currency: keyof Money, amount: number, date: string, comment: string) => {
    setSaving(true)
    try {
      const response = await fetch("/api/employee-balance-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, kind, currency, amount, date, comment }),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить транзакцию")
        return
      }
      const saved = (await response.json()) as BalanceTransaction
      setTransactions((current) => [saved, ...current])
      setModal(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const downloadAll = () => {
    const header = ["Пользователь", ...groups.flatMap((group) => [`${group} SUM`, `${group} USD`, `${group} Euro`])]
    const body = filtered.map((employee) => {
      const cells = groups.flatMap((group) =>
        group === "Баланс на начало периода" || group === "Баланс на конец периода"
          ? [employee.opening.sum, employee.opening.usd, employee.opening.eur]
          : [0, 0, 0],
      )
      return [employee.name, ...cells]
    })
    downloadExcelTable("employee-balance.xls", [header, ...body])
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Баланс сотрудников</span>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
        <div>
          <p className="text-[#586174]">Баланс на начало периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.eur} /> Euro</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.usd} /> USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Зачислено KPI</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Штрафы</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div className="lg:text-right">
          <p className="text-[#586174]">Баланс на конец периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.eur} /> Euro</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.usd} /> USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Зарплата</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Введено с кассы</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Коректировки</p>
          <p className="font-semibold">0 Euro</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-4 border-t border-[#e1e5eb] bg-white px-6 py-3 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> Показать фильтр
        </button>

        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>

        <button onClick={downloadAll} aria-label="Скачать" className="text-[#586174]"><Download className="h-5 w-5" /></button>

        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>

        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {totalLabel}</span>

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
            Пользователь
            <input placeholder="Введите имя..." className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" onChange={(event) => setSearch(event.target.value)} value={search} />
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1900px] w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-white text-[#253653]">
              <th className="border border-[#e1e5eb] px-4 py-2" />
              {groups.map((group) => (
                <th key={group} colSpan={3} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
              ))}
            </tr>
            <tr className="bg-white text-[#17233b]">
              <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold">Пользователь</th>
              {groups.map((group) =>
                ["SUM", "USD", "Euro"].map((currency) => (
                  <th key={`${group}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((employee, index) => (
              <tr key={employee.id} className={`relative ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                <td className="relative border-b border-[#e1e5eb] px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <button
                      aria-label="Действия"
                      onClick={() => setMenuOpenId((current) => (current === employee.id ? null : employee.id))}
                      className="text-[#586174] hover:text-[#17233b]"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {employee.name}
                  </div>
                  {menuOpenId === employee.id && (
                    <div ref={menuRef} className="absolute left-4 top-full z-20 w-44 rounded-sm bg-white py-1 shadow-xl">
                      <button
                        onClick={() => { setModal({ type: "add", employeeId: employee.id }); setMenuOpenId(null) }}
                        className="block w-full px-4 py-2.5 text-left text-[14px] text-[#3aa76d] hover:bg-slate-50"
                      >
                        Зачислить
                      </button>
                      <button
                        onClick={() => { setModal({ type: "expense", employeeId: employee.id }); setMenuOpenId(null) }}
                        className="block w-full px-4 py-2.5 text-left text-[14px] text-[#e5484d] hover:bg-slate-50"
                      >
                        Списать
                      </button>
                    </div>
                  )}
                </td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={employee.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={employee.opening.usd} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={employee.opening.eur} /></td>
                {Array.from({ length: 15 }).map((_, cellIndex) => (
                  <td key={cellIndex} className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                ))}
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={employee.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={employee.opening.usd} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={employee.opening.eur} /></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={22} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {modal && (
        <TransactionModal
          employee={rows.find((item) => item.id === modal.employeeId)!}
          type={modal.type}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(currency, amount, date, comment) => {
            void applyTransaction(modal.employeeId, modal.type, currency, amount, date, comment)
          }}
        />
      )}

    </main>
  )
}

function TransactionModal({
  employee,
  type,
  saving,
  onClose,
  onSave,
}: {
  employee: Employee
  type: "add" | "expense"
  saving: boolean
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
          <h2 className="text-xl font-bold uppercase tracking-wide">{type === "add" ? "Зачислить" : "Списать"}</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Пользователь
            <div className="mt-1 text-[16px] font-semibold text-[#17233b]">{employee.name}</div>
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
            disabled={saving}
            onClick={() => {
              const value = Number(amount)
              if (value > 0) onSave(currency, value, date, comment)
            }}
            className="font-bold uppercase tracking-wide text-[#4f70e7] disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  )
}
