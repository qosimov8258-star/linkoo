"use client"

import { CheckCircle2, ChevronLeft, ChevronRight, ChevronDown, Search, Upload, XCircle, X } from "lucide-react"
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type CostRow = {
  id: number
  name: string
  warehouse: string
  date: Date
  avgCost: number
  cost: number
  passed: boolean
  supplyNumber: string
  calculatedBalance: number
  actualBalance: number
  totalRevaluation: number
  lastCheckTime: Date
}

const warehouses = ["Общий", "Бухоро склад", "11111"]
const accumulated: Record<string, number> = { "Общий": 0, "Бухоро склад": 0, "11111": 0 }
const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

function fmtDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}
function fmtDateTime(date: Date) {
  return `${fmtDate(date)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}
function fmtNum(value: number, maxFrac = 0) {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: maxFrac })
}
function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function deriveDetail(seed: number, row: Omit<CostRow, "id" | "supplyNumber" | "calculatedBalance" | "actualBalance" | "totalRevaluation" | "lastCheckTime">): Pick<CostRow, "supplyNumber" | "calculatedBalance" | "actualBalance" | "totalRevaluation" | "lastCheckTime"> {
  const calculatedBalance = Math.max(1, Math.round(row.cost / 200) + (seed % 50))
  const actualBalance = row.passed ? calculatedBalance : calculatedBalance + (((seed % 9) - 4) * 10 || 7)
  const totalRevaluation = row.passed ? 0 : Math.abs(actualBalance - calculatedBalance) * 5
  const lastCheckTime = new Date(row.date.getTime() + ((seed % 6) + 1) * 3600_000)
  return {
    supplyNumber: String(200 + (seed % 800)),
    calculatedBalance,
    actualBalance,
    totalRevaluation,
    lastCheckTime,
  }
}

type ApiCostRow = {
  id: number
  name: string
  warehouse: string
  date: string
  avgCost: number
  cost: number
  passed: boolean
  supplyNumber: string
  calculatedBalance: number
  actualBalance: number
  totalRevaluation: number
  lastCheckTime: string
}

function apiToCostRow(api: ApiCostRow): CostRow {
  return {
    id: api.id,
    name: api.name,
    warehouse: api.warehouse,
    date: new Date(api.date),
    avgCost: api.avgCost,
    cost: api.cost,
    passed: api.passed,
    supplyNumber: api.supplyNumber,
    calculatedBalance: api.calculatedBalance,
    actualBalance: api.actualBalance,
    totalRevaluation: api.totalRevaluation,
    lastCheckTime: new Date(api.lastCheckTime),
  }
}

function costRowToPayload(row: Omit<CostRow, "id">) {
  return {
    name: row.name,
    warehouse: row.warehouse,
    date: row.date.toISOString(),
    avgCost: row.avgCost,
    cost: row.cost,
    passed: row.passed,
    supplyNumber: row.supplyNumber,
    calculatedBalance: row.calculatedBalance,
    actualBalance: row.actualBalance,
    totalRevaluation: row.totalRevaluation,
    lastCheckTime: row.lastCheckTime.toISOString(),
  }
}

const namePool = ["robot moshina", "Arslan 111111", "sndwch", "seriya test", "Kotlet", "Un", "Sugar", "Sweet 101", "тесто", "Банан СУЛТАНА КУК", "видеокарта", "материнка", "g'ilof", "shkaf3", "moscow prezik", "coco cola 1.5l"]

function buildRows(): CostRow[] {
  return []
}

type ModalKind = "recalc" | "rewrite" | "regenerate" | null

export function CostOfGoodsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<CostRow[]>(buildRows)
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modal, setModal] = useState<ModalKind>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [scopeMode, setScopeMode] = useState<"all" | "common" | "selected">("all")
  const [scopeWarehouse, setScopeWarehouse] = useState(warehouses[0])
  const [dateFrom, setDateFrom] = useState(() => toInputDate(new Date(2026, 7, 1)))
  const [dateTo, setDateTo] = useState(() => toInputDate(new Date(2026, 7, 31)))
  const [recalcMode, setRecalcMode] = useState<"errors" | "filtered">("errors")
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    fetch("/api/cost-of-goods")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as ApiCostRow[]
      })
      .then((data) => {
        if (!cancelled) setRows(data.map(apiToCostRow))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const currentTotals = useMemo(() => {
    const totals: Record<string, number> = { "Общий": 0, "Бухоро склад": 0, "11111": 0 }
    for (const row of rows) totals[row.warehouse] = (totals[row.warehouse] ?? 0) + row.cost
    return totals
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.name.toLowerCase().includes(query.toLowerCase())) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      if (statusFilter === "passed" && !row.passed) return false
      if (statusFilter === "failed" && row.passed) return false
      return true
    })
  }, [rows, query, warehouseFilter, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const expanded = rows.find((row) => row.id === expandedId) ?? null

  function flash(message: string) {
    setNotice(message)
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 3500)
  }

  async function runCheck() {
    const now = new Date()
    const updated = await Promise.all(
      rows.map(async (row) => {
        const patched = { ...row, lastCheckTime: now }
        try {
          const response = await fetch(`/api/cost-of-goods/${row.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(costRowToPayload(patched)),
          })
          if (!response.ok) return row
          return apiToCostRow((await response.json()) as ApiCostRow)
        } catch {
          return row
        }
      }),
    )
    setRows(updated)
    flash("Проверка выполнена")
  }

  function inScope(row: CostRow, mode: "all" | "common" | "selected", warehouse: string, from: string, to: string) {
    const fromDate = new Date(from)
    const toDate = new Date(to)
    toDate.setHours(23, 59, 59, 999)
    if (row.date < fromDate || row.date > toDate) return false
    if (mode === "common") return row.warehouse === "Общий"
    if (mode === "selected") return row.warehouse === warehouse
    return true
  }

  async function applyRecalc(event: FormEvent) {
    event.preventDefault()
    const targets = rows.filter((row) => (recalcMode === "errors" ? !row.passed : filtered.some((item) => item.id === row.id)))
    const updates = new Map<number, CostRow>()
    await Promise.all(
      targets.map(async (row) => {
        const recalculated = { ...row, cost: Math.round(row.avgCost), passed: true }
        const next = { ...recalculated, ...deriveDetail(row.id, recalculated) }
        try {
          const response = await fetch(`/api/cost-of-goods/${row.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(costRowToPayload(next)),
          })
          if (response.ok) updates.set(row.id, apiToCostRow((await response.json()) as ApiCostRow))
        } catch {
          // ignore individual failures; row keeps its previous persisted value
        }
      }),
    )
    setRows((current) => current.map((row) => updates.get(row.id) ?? row))
    setModal(null)
    flash(`Пересчитано строк: ${updates.size}`)
  }

  async function applyRewrite(event: FormEvent) {
    event.preventDefault()
    const targets = rows.filter((row) => inScope(row, scopeMode, scopeWarehouse, dateFrom, dateTo))
    const updates = new Map<number, CostRow>()
    await Promise.all(
      targets.map(async (row) => {
        const recalculated = { ...row, passed: true, lastCheckTime: new Date() }
        const next = { ...recalculated, ...deriveDetail(row.id, recalculated) }
        try {
          const response = await fetch(`/api/cost-of-goods/${row.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(costRowToPayload(next)),
          })
          if (response.ok) updates.set(row.id, apiToCostRow((await response.json()) as ApiCostRow))
        } catch {
          // ignore individual failures; row keeps its previous persisted value
        }
      }),
    )
    setRows((current) => current.map((row) => updates.get(row.id) ?? row))
    setModal(null)
    flash(`Перезаписано строк: ${updates.size}`)
  }

  async function applyRegenerate(event: FormEvent) {
    event.preventDefault()
    const toRemove = rows.filter((row) => inScope(row, scopeMode, scopeWarehouse, dateFrom, dateTo))
    const kept = rows.filter((row) => !inScope(row, scopeMode, scopeWarehouse, dateFrom, dateTo))

    await Promise.all(
      toRemove.map((row) =>
        fetch(`/api/cost-of-goods/${row.id}`, { method: "DELETE" }).catch(() => {
          // ignore; row will simply remain if delete failed
        }),
      ),
    )

    const from = new Date(dateFrom)
    const to = new Date(dateTo)
    const spanMs = Math.max(to.getTime() - from.getTime(), 3600_000)
    const created: CostRow[] = []
    for (let i = 0; i < toRemove.length; i += 1) {
      const date = new Date(from.getTime() + ((i * 9973) % spanMs))
      const warehouse = scopeMode === "selected" ? scopeWarehouse : scopeMode === "common" ? "Общий" : warehouses[i % warehouses.length]
      const avgCost = Math.round((((i * 137 + 91) % 90000) + 50) * 1000) / 1000
      const cost = Math.round(avgCost)
      const base = { name: namePool[i % namePool.length], warehouse, date, avgCost, cost, passed: true }
      const next = { ...base, ...deriveDetail(i, base) }
      try {
        const response = await fetch("/api/cost-of-goods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(costRowToPayload(next)),
        })
        if (response.ok) created.push(apiToCostRow((await response.json()) as ApiCostRow))
      } catch {
        // ignore; row simply won't be generated
      }
    }

    setRows([...created, ...kept])
    setModal(null)
    setExpandedId(null)
    flash("Себестоимости сгенерированы заново")
  }

  function downloadList() {
    downloadExcelTable("sebestoimost", [
      ["Наименование", "Склад", "Дата", "Уср. Себестоимость", "Себестоимость", "Проверка"],
      ...filtered.map((row) => [row.name, row.warehouse, fmtDateTime(row.date), row.avgCost, row.cost, row.passed ? "Пройдено" : "Ошибка"]),
    ])
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f71dc]" />
            <span className="mx-2 text-slate-400">|</span> Себестоимость
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={runCheck} className="rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">Проверить</button>
            <button type="button" onClick={() => setModal("recalc")} className="rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">Перерасчет</button>
            <button type="button" onClick={() => setModal("rewrite")} className="rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">Перезаписать</button>
            <button type="button" onClick={() => setModal("regenerate")} className="rounded bg-[#4f71dc] px-4 py-2.5 font-semibold text-white hover:brightness-95">Сгенерировать заново</button>
          </div>
        </header>
      )}

      {notice && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{notice}</div>
      )}

      <section className="mb-5 overflow-hidden rounded bg-white shadow">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-6 py-4">Склад</th>
              <th className="px-6 py-4">Накопленная себестоимость SUM</th>
              <th className="px-6 py-4">Текущая себестоимость остатки SUM</th>
              <th className="px-6 py-4">Разница SUM</th>
            </tr>
          </thead>
          <tbody>
            {warehouses.map((warehouse) => {
              const diff = (currentTotals[warehouse] ?? 0) - (accumulated[warehouse] ?? 0)
              return (
                <tr key={warehouse} className="border-t border-slate-100">
                  <td className="px-6 py-3 font-medium">{warehouse}</td>
                  <td className="px-6 py-3">{fmtNum(accumulated[warehouse] ?? 0, 1)}</td>
                  <td className="px-6 py-3">{fmtNum(currentTotals[warehouse] ?? 0, 1)}</td>
                  <td className={`px-6 py-3 ${diff !== 0 ? "text-rose-500" : ""}`}>{fmtNum(diff, 1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f71dc] hover:underline">
            Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f71dc]">
            <Upload className="h-5 w-5 rotate-180" />
          </button>
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <label className="text-sm text-slate-600">
              Склад:{" "}
              <select value={warehouseFilter} onChange={(event) => { setWarehouseFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                {warehouses.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Проверка:{" "}
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                <option value="passed">Пройдено</option>
                <option value="failed">Ошибка</option>
              </select>
            </label>
          </div>
        )}

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">Наименование</th>
              <th className="px-5 py-5">Склад</th>
              <th className="px-5 py-5">Дата</th>
              <th className="px-5 py-5">Уср. Себестоимость</th>
              <th className="px-5 py-5">Себестоимость</th>
              <th className="px-5 py-5">Сумма переоценки</th>
              <th className="px-5 py-5">Проверка</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => setExpandedId((current) => (current === row.id ? null : row.id))} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.name}</td>
                  <td className="px-5 py-4 italic text-slate-500">{row.warehouse}</td>
                  <td className="px-5 py-4">{fmtDateTime(row.date)}</td>
                  <td className="px-5 py-4">{fmtNum(row.avgCost, 3)}</td>
                  <td className="px-5 py-4">{fmtNum(row.cost)}</td>
                  <td className="px-5 py-4 text-slate-500">Не указано</td>
                  <td className="px-5 py-4">
                    {row.passed ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-rose-500" />}
                  </td>
                </tr>
                {expandedId === row.id && expanded && (
                  <tr>
                    <td colSpan={7} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <h2 className="mb-5 text-lg font-bold text-slate-700">{expanded.name} №{expanded.id}</h2>
                        <div className="grid gap-8 lg:grid-cols-3">
                          <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Поставка №:</dt><dd className="font-medium">{expanded.supplyNumber}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Склад:</dt><dd className="font-medium">Не указано</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Дата:</dt><dd className="font-medium">{fmtDateTime(expanded.date)}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Уср. Себестоимость:</dt><dd className="font-medium">{fmtNum(expanded.avgCost, 3)}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Себестоимость:</dt><dd className="font-medium">{fmtNum(expanded.cost)}</dd></div>
                          </dl>
                          <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between gap-4"><span className="text-slate-600">Анализ баланса:</span>{expanded.passed ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <XCircle className="h-5 w-5 text-rose-500" />}</div>
                            <div className="flex items-center justify-between gap-4"><span className="text-slate-600">Анализ отрицательного баланса:</span><CheckCircle2 className="h-5 w-5 text-emerald-500" /></div>
                            <div className="flex items-center justify-between gap-4"><span className="text-slate-600">Анализ времены:</span><CheckCircle2 className="h-5 w-5 text-emerald-500" /></div>
                          </div>
                          <div className="space-y-2 text-sm">
                            <p className="mb-1 font-medium text-slate-800">Характеристика:</p>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Рассчитанный баланс:</dt><dd className="font-medium">{fmtNum(expanded.calculatedBalance)}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Фактический баланс:</dt><dd className="font-medium">{fmtNum(expanded.actualBalance)}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Сумма переоценки:</dt><dd className="font-medium">{fmtNum(expanded.actualBalance - expanded.calculatedBalance)}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Общая сумма переоценки:</dt><dd className="font-medium">{fmtNum(expanded.totalRevaluation)}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">Последнее время проверки:</dt><dd className="font-medium">{fmtDateTime(expanded.lastCheckTime)}</dd></div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {modal === "recalc" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={applyRecalc} className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Перерасчет</b>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-3 p-8">
              <label className="flex items-center gap-3">
                <input type="radio" checked={recalcMode === "errors"} onChange={() => setRecalcMode("errors")} className="h-4 w-4" />
                Пересчитать только ошибки
              </label>
              <label className="flex items-center gap-3">
                <input type="radio" checked={recalcMode === "filtered"} onChange={() => setRecalcMode("filtered")} className="h-4 w-4" />
                Пересчитать выбранные
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">Сохранить</button>
            </footer>
          </form>
        </div>
      )}

      {(modal === "rewrite" || modal === "regenerate") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={modal === "rewrite" ? applyRewrite : applyRegenerate} className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{modal === "rewrite" ? "Перезаписать" : "Сгенерировать заново"}</b>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              {modal === "regenerate" && (
                <p className="text-sm text-slate-600">
                  Себестоимости продуктов будут сгенерированы заново за указанный период. При этом старые данные будут удалены, а текущие значения себестоимостей могут измениться.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <label className="text-xs font-medium text-slate-600">
                  Дата от
                  <input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent py-2 text-sm outline-none focus:border-[#4f71dc]" />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Дата до
                  <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent py-2 text-sm outline-none focus:border-[#4f71dc]" />
                </label>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input type="radio" checked={scopeMode === "all"} onChange={() => setScopeMode("all")} className="h-4 w-4" />
                  Все
                </label>
                <label className="flex items-center gap-3">
                  <input type="radio" checked={scopeMode === "common"} onChange={() => setScopeMode("common")} className="h-4 w-4" />
                  Общие склады
                </label>
                <label className="flex items-center gap-3">
                  <input type="radio" checked={scopeMode === "selected"} onChange={() => setScopeMode("selected")} className="h-4 w-4" />
                  Выбранный склад
                </label>
                {scopeMode === "selected" && (
                  <select value={scopeWarehouse} onChange={(event) => setScopeWarehouse(event.target.value)} className="ml-7 rounded border border-slate-300 px-2 py-1 text-sm">
                    {warehouses.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
                  </select>
                )}
              </div>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95">
                {modal === "rewrite" ? "Сохранить" : "Сгенерировать"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
