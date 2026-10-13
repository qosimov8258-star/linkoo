"use client"

import { ChevronLeft, ChevronRight, ChevronsUpDown, Copy, Download, ListChecks, Pencil, RefreshCw, Search, X } from "lucide-react"
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react"
import { branchNames } from "./branches-view"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type BranchKpiPlan = { branchId: number; branchName: string; period: string; planSales: number; bonusPercent: number }

const kpiColumns = ["KPI", "Уровень", "План", "Продажи", "Возврат", "Факт", "%", "Дневной план", "Прогноз", "%", "Бонус"]
const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

type Branch = { id: number; name: string; bonus: number; kpi: number }

const seedBranches: Branch[] = branchNames.map((name, index) => ({ id: index + 1, name, bonus: 0, kpi: 0 }))

export function BranchKpiPlansView() {
  const today = new Date()
  const [branches, setBranches] = useState(seedBranches)
  const [month, setMonth] = useState(today.getMonth())
  const [year, setYear] = useState(today.getFullYear())
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [plansOpen, setPlansOpen] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [planDraft, setPlanDraft] = useState({ planSales: "", bonusPercent: "" })
  const [savingPlans, setSavingPlans] = useState(false)
  const pageSize = 25

  const period = `${year}-${String(month + 1).padStart(2, "0")}`

  useEffect(() => {
    let cancelled = false
    fetch(`/api/branch-kpi-plans?period=${period}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить планы")
        return (await response.json()) as BranchKpiPlan[]
      })
      .then((plans) => {
        if (cancelled) return
        setBranches((current) =>
          current.map((branch) => {
            const plan = plans.find((item) => item.branchId === branch.id)
            return plan ? { ...branch, bonus: plan.bonusPercent, kpi: plan.planSales } : branch
          }),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const filtered = useMemo(() => branches.filter((branch) => branch.name.toLowerCase().includes(query.toLowerCase())), [branches, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openPlans() {
    setPlanDraft({ planSales: "", bonusPercent: "" })
    setPlansOpen(true)
  }

  async function savePlans(event: FormEvent) {
    event.preventDefault()
    if (!checkedIds.length) {
      setPlansOpen(false)
      return
    }
    const planSales = Number(planDraft.planSales) || 0
    const bonusPercent = Number(planDraft.bonusPercent) || 0
    setSavingPlans(true)
    try {
      const results = await Promise.all(
        checkedIds.map(async (branchId) => {
          const branch = branches.find((item) => item.id === branchId)
          if (!branch) return null
          const response = await fetch("/api/branch-kpi-plans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ branchId: branch.id, branchName: branch.name, period, planSales, bonusPercent }),
          })
          if (!response.ok) return null
          return (await response.json()) as BranchKpiPlan
        }),
      )
      setBranches((current) =>
        current.map((branch) => {
          const saved = results.find((item) => item && item.branchId === branch.id)
          return saved ? { ...branch, bonus: saved.bonusPercent, kpi: saved.planSales } : branch
        }),
      )
      setPlansOpen(false)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSavingPlans(false)
    }
  }

  function toggleChecked(id: number) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function duplicateSelected() {
    if (!checkedIds.length) return
    setBranches((current) => {
      const toCopy = current.filter((branch) => checkedIds.includes(branch.id))
      const nextId = Math.max(0, ...current.map((branch) => branch.id)) + 1
      const copies = toCopy.map((branch, index) => ({ ...branch, id: nextId + index, name: `${branch.name} (копия)` }))
      return [...current, ...copies]
    })
    setCheckedIds([])
  }

  function downloadBranch(branch: Branch) {
    const csv = [["Филиал", "Фикс. зарплата", "Бонусы", "Итог зарплата"].join(";"), [branch.name, "0 SUM", "0 SUM", "0 SUM"].join(";")].join("\n")
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${branch.name}-kpi.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 py-4 sm:px-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[#5470e8]">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#5470e8]" /> <span className="text-slate-500">|</span> <span className="text-slate-600">KPI план филиалов</span>
        </h1>
        <button
          type="button"
          onClick={() => {
            setRecalculating(true)
            window.setTimeout(() => setRecalculating(false), 600)
          }}
          className="rounded-md bg-[#71ce87] px-6 py-2.5 font-bold text-white"
        >
          <RefreshCw className={`mr-2 inline h-5 w-5 ${recalculating ? "animate-spin" : ""}`} />
          Перерасчет KPI
        </button>
      </header>

      <section className="bg-white shadow">
        <div className="flex flex-wrap items-end gap-5 px-2 py-3">
          <label className="text-xs font-medium text-slate-500">
            Месяц
            <div className="mt-1 flex items-center gap-2 border-b py-1 pr-1">
              <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="bg-white text-base font-semibold text-slate-800 outline-none">
                {months.map((item, index) => (
                  <option key={item} value={index}>
                    {item}
                  </option>
                ))}
              </select>
              <button type="button" aria-label="Очистить месяц" onClick={() => setMonth(today.getMonth())} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Год
            <select value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 block border-0 border-b py-2 text-base font-semibold text-slate-800">
              {[2024, 2025, 2026, 2027].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#5470e8]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="rounded-full border-2 p-1 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="rounded-full border-2 p-1 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setSelectMode((value) => !value)} aria-pressed={selectMode} aria-label="Выбрать филиалы" className={`rounded p-1 ${selectMode ? "bg-[#5470e8] text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            <ListChecks className="h-5 w-5" />
          </button>
          <button type="button" onClick={openPlans} className="rounded-md bg-[#5470e8] px-5 py-2.5 font-bold text-white">
            <Pencil className="mr-2 inline h-4 w-4" />
            Изменить планы
          </button>
          <button type="button" onClick={duplicateSelected} aria-label="Дублировать выбранные" className="text-slate-500 hover:text-[#5470e8]">
            <Copy className="h-5 w-5" />
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              {selectMode && <th className="w-10 px-5 py-5" />}
              <th className="px-9 py-5">Филиал</th>
              <th className="px-5 py-5">Сумма бонусов</th>
              <th className="px-5 py-5">KPI</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((branch) => (
              <Fragment key={branch.id}>
                <tr className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50" onClick={() => setSelectedId((current) => (current === branch.id ? null : branch.id))}>
                  {selectMode && (
                    <td className="px-5 py-4" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={checkedIds.includes(branch.id)} onChange={() => toggleChecked(branch.id)} />
                    </td>
                  )}
                  <td className="px-9 py-4 font-semibold text-slate-800">{branch.name}</td>
                  <td className="px-5 py-4">{branch.bonus}</td>
                  <td className="px-5 py-4">{branch.kpi || ""}</td>
                </tr>
                {selectedId === branch.id && (
                  <tr>
                    <td colSpan={selectMode ? 4 : 3} className="border-b bg-white p-0">
                      <div className="p-6">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-2xl font-semibold text-slate-800">{branch.name}</h2>
                          <button type="button" onClick={() => downloadBranch(branch)} aria-label="Скачать" className="text-slate-500 hover:text-[#5470e8]">
                            <Download className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="mb-5 grid gap-6 sm:grid-cols-3">
                          <div>
                            <p className="text-slate-500">Фикс. зарплата</p>
                            <p className="text-lg font-semibold">0 SUM</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Бонусы</p>
                            <p className="text-lg font-semibold">0 SUM</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Итог зарплата</p>
                            <p className="text-lg font-semibold">0 SUM</p>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[1000px] text-left text-sm">
                            <thead className="bg-[#4f71dc] text-white">
                              <tr>
                                {kpiColumns.map((column) => (
                                  <th key={column} className="px-4 py-3 font-semibold">
                                    <span className="inline-flex items-center gap-1">
                                      {column} <ChevronsUpDown className="h-3.5 w-3.5" />
                                    </span>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td colSpan={kpiColumns.length} className="px-4 py-8 text-center text-slate-400">
                                  Нет данных
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={selectMode ? 4 : 3} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {plansOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4">
          <form onSubmit={savePlans} className="w-full max-w-lg bg-white">
            <header className="flex justify-between border-b px-7 py-5">
              <h2 className="font-bold">ИЗМЕНИТЬ ПЛАНЫ</h2>
              <button type="button" onClick={() => setPlansOpen(false)} aria-label="Закрыть">
                <X />
              </button>
            </header>
            <div className="space-y-5 p-7">
              <p className="text-sm text-slate-500">
                {checkedIds.length ? `Выбрано филиалов: ${checkedIds.length}` : "Выберите филиалы в таблице, чтобы изменить их планы"}
              </p>
              <input
                type="number"
                min="0"
                placeholder="План продаж"
                value={planDraft.planSales}
                onChange={(event) => setPlanDraft((value) => ({ ...value, planSales: event.target.value }))}
                className="w-full border-b py-3"
              />
              <input
                type="number"
                min="0"
                placeholder="Бонус, %"
                value={planDraft.bonusPercent}
                onChange={(event) => setPlanDraft((value) => ({ ...value, bonusPercent: event.target.value }))}
                className="w-full border-b py-3"
              />
            </div>
            <footer className="flex justify-end border-t px-7 py-5">
              <button type="submit" disabled={savingPlans || !checkedIds.length} className="font-bold uppercase text-sky-500 disabled:opacity-40">
                {savingPlans ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
