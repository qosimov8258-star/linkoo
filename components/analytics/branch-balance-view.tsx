"use client"

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Expand, FileText, MinusCircle, PlusCircle, Search, X } from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Money = { sum: number; usd: number }
type Branch = { id: number; name: string; opening: Money }

const branches: Branch[] = []

const TOTAL_BRANCHES = 0
const FIXED_TOTALS = { sum: 0, usd: 0 }

const groups = ["Баланс на начало периода", "Передача на склад", "Возврат передачи", "Оплата", "Прочие приходы", "Прочие расходы", "Баланс на конец"] as const

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "филиал": "branch", "branch": "branch",
  "валюта": "currency", "currency": "currency",
  "сумма": "amount", "amount": "amount",
  "дата": "date", "date": "date",
}

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

export function BranchBalanceView() {
  const [rows, setRows] = useState(branches)
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ type: "add" | "expense"; branchId: number } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
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
        const merged: Branch[] = branchList.map((item) => {
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
        setRows(merged)
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

  function downloadTemplate() {
    downloadExcelTable("branch-balance-template", [["Филиал", "Валюта", "Сумма", "Дата"]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const fileRows = await readExcelRows(importFile)
      if (!fileRows.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(fileRows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("branch")
      const dataRows = hasHeader ? fileRows.slice(1) : fileRows

      const parsed: { branch: string; currency: keyof Money; amount: number }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.branch = row[0] ?? ""
          record.currency = row[1] ?? ""
          record.amount = row[2] ?? ""
          record.date = row[3] ?? ""
        }
        if (!record.branch) continue
        const amount = Number(record.amount)
        if (!amount || amount <= 0) continue
        const currency: keyof Money = (record.currency || "").toLowerCase().includes("usd") ? "usd" : "sum"
        parsed.push({ branch: record.branch, currency, amount })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      let applied = 0
      let notFound = 0
      const today = new Date().toISOString().slice(0, 10)
      for (const item of parsed) {
        const match = rows.find((branch) => branch.name.trim().toLowerCase() === item.branch.trim().toLowerCase())
        if (match) {
          const ok = await saveTransaction(match.id, match.name, "add", item.currency, item.amount, today, "")
          if (ok) applied += 1
        } else {
          notFound += 1
        }
      }
      if (notFound || applied < parsed.length) window.alert(`Импортировано ${applied} из ${parsed.length}. Филиал не найден: ${notFound}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Баланс филиалов</span>
        </div>
      </header>

      {loadError && <p className="px-6 pt-3 text-sm text-red-500 md:px-9">{loadError}</p>}

      <section className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 md:px-9">
        <div>
          <p className="text-[#586174]">Баланс на начало периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.usd} /> USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Передача на склад</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие приходы</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div className="lg:text-right">
          <p className="text-[#586174]">Баланс на конец периода</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.sum} /> SUM</p>
          <p className="font-semibold"><AmountCell value={FIXED_TOTALS.usd} /> USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Принятие оплаты</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Возврат передачи</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
        <div>
          <p className="text-[#586174]">Прочие расходы</p>
          <p className="font-semibold">0 SUM</p>
          <p className="font-semibold">0 USD</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-5 border-t border-[#e1e5eb] bg-white px-6 py-3 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
          Показать фильтр <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
        </button>

        <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
          <FileText className="h-4 w-4" /> Импорт с Excel
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
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronDown className="h-5 w-5 -rotate-90" />
        </button>
        <button aria-label="Полный экран" onClick={() => document.documentElement.requestFullscreen?.()} className="text-[#586174]"><Expand className="h-5 w-5" /></button>
      </section>

      {filterOpen && (
        <section className="grid grid-cols-1 gap-6 border-b border-[#e1e5eb] bg-white px-6 py-6 sm:grid-cols-3 md:px-9">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Филиал
            <input placeholder="Введите название..." className="mt-1 block w-full bg-transparent text-[15px] font-normal outline-none placeholder:text-[#9aa3b6]" onChange={(event) => setSearch(event.target.value)} value={search} />
          </label>
        </section>
      )}

      <section className="overflow-x-auto bg-white pb-10">
        <table className="min-w-[1750px] w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-white text-[#253653]">
              <th className="border border-[#e1e5eb] px-4 py-2" colSpan={3} />
              {groups.map((group) => (
                <th key={group} colSpan={2} className="border border-[#e1e5eb] px-4 py-2 text-center font-medium">{group}</th>
              ))}
            </tr>
            <tr className="bg-white text-[#17233b]">
              <th className="border-b border-[#e1e5eb] px-4 py-2 text-left font-semibold" colSpan={3}>Филиал</th>
              {groups.map((group) =>
                ["SUM", "USD"].map((currency) => (
                  <th key={`${group}-${currency}`} className="border-b border-[#e1e5eb] px-4 py-2 font-semibold">{currency}</th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((branch, index) => (
              <tr key={branch.id} className={index % 2 ? "bg-[#f6f9fc]" : "bg-white"}>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5">{branch.name}</td>
                <td className="border-b border-[#e1e5eb] px-1 py-3.5">
                  <button aria-label="Добавить расход" onClick={() => setModal({ type: "expense", branchId: branch.id })} className="text-[#e5484d]"><MinusCircle className="h-6 w-6 fill-[#ff5d63] text-white" /></button>
                </td>
                <td className="border-b border-[#e1e5eb] px-1 py-3.5">
                  <button aria-label="Добавить" onClick={() => setModal({ type: "add", branchId: branch.id })} className="text-[#39ca79]"><PlusCircle className="h-6 w-6 fill-[#39ca79] text-white" /></button>
                </td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.usd} /></td>
                {Array.from({ length: 10 }).map((_, cellIndex) => (
                  <td key={cellIndex} className="border-b border-[#e1e5eb] px-4 py-3.5">0</td>
                ))}
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.sum} /></td>
                <td className="border-b border-[#e1e5eb] px-4 py-3.5"><AmountCell value={branch.opening.usd} /></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={17} className="border-b border-[#e1e5eb] px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
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

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Импорт с Excel</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
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
            className="font-bold uppercase tracking-wide text-[#4f70e7]"
          >
            Сохранить
          </button>
        </footer>
      </div>
    </div>
  )
}
