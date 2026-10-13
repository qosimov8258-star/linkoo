"use client"

import { ChevronDown, ChevronUp } from "lucide-react"
import { Fragment, useMemo, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type LineItem = { label: string; value1: number; value2: number }
type Category = { label: string; value1: number; value2: number; children: LineItem[] }
type BranchData = { id: number; name: string; categories: Category[] }

const organizations = ["Все организации", "05,08,2025", "7777", "878"]
const branchNames = ["777", "878", "agent", "Ташкент", "Samarqand", "buxoro", "Andijon"]

const money = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })

function buildBranches(): BranchData[] {
  return []
}

export function ManagementBalanceView() {
  const [organization, setOrganization] = useState(organizations[0])
  const [branchFilter, setBranchFilter] = useState("Все филиалы")
  const [dateFrom, setDateFrom] = useState(() => toInputDate(new Date(2026, 7, 1)))
  const [dateTo, setDateTo] = useState(() => toInputDate(new Date(2026, 7, 12)))
  const [appliedFrom, setAppliedFrom] = useState(dateFrom)
  const [appliedTo, setAppliedTo] = useState(dateTo)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const branches = useMemo(() => buildBranches(), [])
  const filterOptions = ["Все филиалы", ...branchNames]

  const visibleBranches = branchFilter === "Все филиалы" ? branches : branches.filter((branch) => branch.name === branchFilter)

  function toggle(branchId: number, categoryLabel: string) {
    const key = `${branchId}:${categoryLabel}`
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function apply() {
    setAppliedFrom(dateFrom)
    setAppliedTo(dateTo)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7">
      <header className="mb-5 flex items-center text-2xl font-bold text-slate-600">
        <FavoritesButton className="inline-flex items-center gap-2 text-[#4f71dc]" />
        <span className="mx-2 text-slate-400">|</span> Управленческий баланс по филиалам
      </header>

      <section className="mb-5 flex flex-wrap items-end gap-6 rounded bg-white p-5 shadow">
        <label className="block text-sm font-medium text-slate-600">
          Организация
          <select value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1 block w-48 border-b border-slate-300 bg-white py-1.5 outline-none focus:border-[#4f71dc]">
            {organizations.map((org) => <option key={org} value={org}>{org}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-600">
          Филиалы
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="mt-1 block w-48 border-b border-slate-300 bg-white py-1.5 outline-none focus:border-[#4f71dc]">
            {filterOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} className="border-b border-slate-300 py-1.5 text-sm outline-none focus:border-[#4f71dc]" />
          <span className="text-slate-400">—</span>
          <input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} className="border-b border-slate-300 py-1.5 text-sm outline-none focus:border-[#4f71dc]" />
        </div>
        <button type="button" onClick={apply} className="rounded bg-[#4f71dc] px-6 py-2.5 font-semibold text-white hover:brightness-95">
          Применить
        </button>
      </section>

      <div className="space-y-5">
        {visibleBranches.map((branch) => (
          <section key={branch.id} className="overflow-hidden rounded bg-white shadow">
            <h2 className="px-5 pt-4 text-lg font-bold text-slate-700">{branch.name}</h2>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="px-5 py-3 font-medium">Наименование</th>
                  <th className="px-5 py-3 font-medium">Баланс на {fmtLabelDate(appliedFrom)}</th>
                  <th className="px-5 py-3 font-medium">Баланс на {fmtLabelDate(appliedTo)}</th>
                  <th className="px-5 py-3 font-medium">Разница</th>
                </tr>
              </thead>
              <tbody>
                {branch.categories.map((category) => {
                  const key = `${branch.id}:${category.label}`
                  const isOpen = expanded.has(key)
                  const diff = category.value2 - category.value1
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => toggle(branch.id, category.label)} className="cursor-pointer bg-[#f4f6fb] hover:bg-[#eaeefa]">
                        <td className="px-5 py-3 font-medium text-slate-700">
                          <span className="inline-flex items-center gap-1.5">
                            {category.label}
                            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </span>
                        </td>
                        <td className="px-5 py-3">{money(category.value1)}</td>
                        <td className="px-5 py-3">{money(category.value2)}</td>
                        <td className={`px-5 py-3 ${diff !== 0 ? "text-rose-500" : ""}`}>{money(diff)}</td>
                      </tr>
                      {isOpen && category.children.map((child, index) => (
                        <tr key={`${key}-${index}`} className="border-b border-dashed border-slate-200">
                          <td className="px-9 py-2.5 text-slate-600">{child.label}</td>
                          <td className="px-5 py-2.5">{money(child.value1)}</td>
                          <td className="px-5 py-2.5">{money(child.value2)}</td>
                          <td className={`px-5 py-2.5 ${child.value2 - child.value1 !== 0 ? "text-rose-500" : ""}`}>{money(child.value2 - child.value1)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </main>
  )
}

function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

const monthGenitive = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
function fmtLabelDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getDate()} ${monthGenitive[date.getMonth()]}`
}
