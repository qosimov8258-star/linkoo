"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, MoreVertical, X } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportAmount, ReportBalanceBoxes, ReportBalanceToolbar, ReportGridTable, ReportPage, ReportPager, ReportSearchField, type BalanceTone } from "@/components/ref/report-kit"
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

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

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

  const tone = (value: number): BalanceTone => (value > 0 ? "plus" : value < 0 ? "minus" : "default")
  const zeros = [{ text: "0 Euro" }, { text: "0 SUM" }, { text: "0 USD" }]
  const openingLines = [
    { text: `${money(FIXED_TOTALS.eur)} Euro`, tone: tone(FIXED_TOTALS.eur) },
    { text: `${money(FIXED_TOTALS.sum)} SUM`, tone: tone(FIXED_TOTALS.sum) },
    { text: `${money(FIXED_TOTALS.usd)} USD`, tone: tone(FIXED_TOTALS.usd) },
  ]
  const triple = (m: Money) => [m.sum, m.usd, m.eur].map((value, index) => <ReportAmount key={index} value={value} />)

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Баланс сотрудников" /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[10px]">
        <ReportBalanceBoxes
          columns={[
            { blocks: [{ title: "Баланс на начало периода", lines: openingLines }, { title: "Зарплата", lines: zeros }] },
            { blocks: [{ title: "Зачислено KPI", lines: zeros }, { title: "Введено с кассы", lines: zeros }] },
            { blocks: [{ title: "Штрафы", lines: zeros }, { title: "Коректировки", lines: zeros }] },
            { right: true, blocks: [{ title: "Баланс на конец периода", lines: openingLines }] },
          ]}
        />

        <ReportBalanceToolbar
          filterAsButton
          onFilter={() => setFilterOpen((value) => !value)}
          search={search}
          onSearch={(value) => { setSearch(value); setPage(1) }}
          searchLeft={555}
          pager={
            <div className="flex items-center gap-[20px]">
              <button onClick={downloadAll} aria-label="Скачать"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg></button>
              <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${filtered.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filtered.length)} из ${totalLabel}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
              <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
            </div>
          }
        />
        {filterOpen && (
          <div className="mx-[10px] w-[300px] bg-white p-5 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={260} label="Пользователь" />
          </div>
        )}

        <ReportGridTable
          minWidth={1900}
          colWidths={["220px", ...Array.from({ length: 21 }, () => "")]}
          groups={[{ title: "", span: 1 }, ...groups.map((group) => ({ title: group, span: 3 }))]}
          heads={["Пользователь", ...groups.flatMap(() => ["SUM", "USD", "Euro"])]}
          rows={visible.map((employee) => [
            <div key="n" className="relative flex items-center gap-2">
              <button aria-label="Действия" onClick={() => setMenuOpenId((current) => (current === employee.id ? null : employee.id))} className="text-[#333]"><MoreVertical className="h-5 w-5" /></button>
              <span className="truncate">{employee.name}</span>
              {menuOpenId === employee.id && (
                <div ref={menuRef} className="absolute left-0 top-full z-20 w-44 rounded-sm bg-white py-1 shadow-xl">
                  <button onClick={() => { setModal({ type: "add", employeeId: employee.id }); setMenuOpenId(null) }} className="block w-full px-4 py-2 text-left text-[13px] text-[#3aa76d] hover:bg-[#f2f5f8]">Зачислить</button>
                  <button onClick={() => { setModal({ type: "expense", employeeId: employee.id }); setMenuOpenId(null) }} className="block w-full px-4 py-2 text-left text-[13px] text-[#e5484d] hover:bg-[#f2f5f8]">Списать</button>
                </div>
              )}
            </div>,
            ...triple(employee.opening),
            ...Array.from({ length: 15 }, () => 0),
            ...triple(employee.opening),
          ])}
        />
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

    </ReportPage>
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
            className="font-bold uppercase tracking-wide text-[#4f71dc] disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  )
}
