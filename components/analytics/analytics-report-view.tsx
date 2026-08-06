"use client"

import Link from "next/link"
import { FormEvent, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  RefreshCw,
  Star,
  Target,
  TrendingUp,
  Users,
} from "lucide-react"

import type { AnalyticsReport } from "@/lib/analytics-catalog"

type Filters = {
  from: string
  to: string
  branch: string
}

type ReportRow = {
  name: string
  primary: number
  plan: number
  completion: number
  change: number
}

const branches = ["Все филиалы", "Ташкент", "Самарканд", "Фергана"]
const periods = [7, 14, 30]
const emptyFilters: Filters = { from: "", to: "", branch: branches[0] }

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function createDefaultFilters(): Filters {
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

  return {
    from: toInputDate(monthStart),
    to: toInputDate(today),
    branch: branches[0],
  }
}

function hashText(value: string) {
  return Array.from(value).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value))
}

function formatPrimary(value: number, group: AnalyticsReport["group"]) {
  if (group === "sales") return `${formatNumber(value)} сум`
  return formatNumber(value)
}

function escapeCsv(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`
}

export function AnalyticsReportView({ report }: { report: AnalyticsReport }) {
  const [draftFilters, setDraftFilters] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [period, setPeriod] = useState(14)
  const [favorite, setFavorite] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    const defaults = createDefaultFilters()
    setDraftFilters(defaults)
    setFilters(defaults)
  }, [])

  useEffect(() => {
    setFavorite(window.localStorage.getItem(`analytics-favorite:${report.slug}`) === "true")
  }, [report.slug])

  const branchFactor = filters.branch === "Все филиалы" ? 1 : 0.38 + branches.indexOf(filters.branch) * 0.07
  const seed = hashText(`${report.slug}:${filters.from}:${filters.to}:${filters.branch}`)

  const rows = useMemo<ReportRow[]>(() => {
    const visitNames = [
      "Александр Иванов",
      "Азиз Рахимов",
      "Дилшод Каримов",
      "Мария Петрова",
      "Сардор Юсупов",
      "Нодира Алиева",
      "Руслан Ахмедов",
      "Камилла Усманова",
    ]
    const salesNames = [
      "Ташкент — Центр",
      "Ташкент — Юг",
      "Самарканд",
      "Фергана",
      "Андижан",
      "Бухара",
      "Наманган",
      "Карши",
    ]
    const toolNames = [
      "Супермаркеты",
      "Мини-маркеты",
      "Аптеки",
      "HoReCa",
      "Оптовые клиенты",
      "Розничные точки",
      "Новые клиенты",
      "Ключевые клиенты",
    ]
    const names = report.group === "visits" ? visitNames : report.group === "sales" ? salesNames : toolNames

    return names.map((name, index) => {
      const base = 72 + ((seed + index * 37) % 83)
      const plan = Math.round((base + 24 + (index % 3) * 9) * branchFactor)
      const actual = Math.max(1, Math.round(plan * (0.72 + ((seed + index * 19) % 37) / 100)))
      const primary = report.group === "sales" ? actual * (920000 + ((seed + index * 11) % 28) * 50000) : actual

      return {
        name,
        primary,
        plan,
        completion: Math.round((actual / plan) * 100),
        change: ((seed + index * 13) % 23) - 7,
      }
    })
  }, [branchFactor, report.group, seed])

  const series = useMemo(
    () =>
      Array.from({ length: period }, (_, index) => ({
        label: String(index + 1),
        value: 42 + ((seed + index * 29 + Math.floor(index / 3) * 17) % 57),
      })),
    [period, seed],
  )

  const totals = useMemo(() => {
    const primary = rows.reduce((sum, row) => sum + row.primary, 0)
    const plan = rows.reduce((sum, row) => sum + row.plan, 0)
    const completion = Math.round(rows.reduce((sum, row) => sum + row.completion, 0) / rows.length)
    const change = Math.round(rows.reduce((sum, row) => sum + row.change, 0) / rows.length)
    return { primary, plan, completion, change }
  }, [rows])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draftFilters.from > draftFilters.to) return

    setFilters(draftFilters)
    setUpdatedAt(
      new Date().toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    )
  }

  function toggleFavorite() {
    setFavorite((current) => {
      const next = !current
      window.localStorage.setItem(`analytics-favorite:${report.slug}`, String(next))
      return next
    })
  }

  function downloadCsv() {
    const header = ["Название", report.group === "sales" ? "Продажи" : "Результат", "План", "Выполнение, %", "Динамика, %"]
    const body = rows.map((row) => [row.name, row.primary, row.plan, row.completion, row.change])
    const csv = [header, ...body].map((row) => row.map(escapeCsv).join(";")).join("\n")
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${report.slug}-${filters.from}-${filters.to}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const invalidRange = Boolean(draftFilters.from && draftFilters.to && draftFilters.from > draftFilters.to)
  const filtersIncomplete = !draftFilters.from || !draftFilters.to
  const primaryLabel = report.group === "sales" ? "Объём продаж" : report.group === "visits" ? "Выполнено" : "Найдено объектов"

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue transition-colors hover:text-blue-700"
            >
              <ArrowLeft className="h-4 w-4" />
              На главную
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-800 sm:text-3xl">{report.label}</h1>
              <button
                type="button"
                onClick={toggleFavorite}
                aria-label={favorite ? "Удалить из избранного" : "Добавить в избранное"}
                aria-pressed={favorite}
                className="rounded-full p-2 text-amber-500 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-brand-blue"
              >
                <Star className={`h-5 w-5 ${favorite ? "fill-current" : ""}`} />
              </button>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{report.description}</p>
          </div>

          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-2 rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
          >
            <Download className="h-4 w-4" />
            Скачать CSV
          </button>
        </div>

        <form onSubmit={applyFilters} className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <label className="min-w-40 flex-1 text-sm font-semibold text-slate-600 sm:max-w-56">
              Дата с
              <span className="relative mt-1.5 block">
                <input
                  type="date"
                  required
                  value={draftFilters.from}
                  max={draftFilters.to}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2.5 pr-9 font-normal text-slate-700 outline-none transition-colors focus:border-brand-blue"
                />
                <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </span>
            </label>

            <label className="min-w-40 flex-1 text-sm font-semibold text-slate-600 sm:max-w-56">
              Дата по
              <span className="relative mt-1.5 block">
                <input
                  type="date"
                  required
                  value={draftFilters.to}
                  min={draftFilters.from}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))}
                  className="w-full rounded-md border border-slate-200 px-3 py-2.5 pr-9 font-normal text-slate-700 outline-none transition-colors focus:border-brand-blue"
                />
                <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </span>
            </label>

            <label className="min-w-48 flex-1 text-sm font-semibold text-slate-600 sm:max-w-64">
              Филиал
              <select
                value={draftFilters.branch}
                onChange={(event) => setDraftFilters((current) => ({ ...current, branch: event.target.value }))}
                className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-700 outline-none transition-colors focus:border-brand-blue"
              >
                {branches.map((branch) => (
                  <option key={branch}>{branch}</option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={invalidRange || filtersIncomplete}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Применить
            </button>

            {updatedAt && <span className="pb-2 text-xs text-slate-400">Обновлено в {updatedAt}</span>}
          </div>
          {invalidRange && <p className="mt-2 text-sm text-brand-red">Начальная дата не может быть позже конечной.</p>}
        </form>

        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Users} label={primaryLabel} value={formatPrimary(totals.primary, report.group)} tone="blue" />
          <MetricCard icon={Target} label="План" value={formatNumber(totals.plan)} tone="violet" />
          <MetricCard icon={CheckCircle2} label="Выполнение" value={`${totals.completion}%`} tone="green" />
          <MetricCard
            icon={TrendingUp}
            label="Динамика"
            value={`${totals.change >= 0 ? "+" : ""}${totals.change}%`}
            tone={totals.change >= 0 ? "green" : "orange"}
          />
        </section>

        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Динамика показателя</h2>
              <p className="text-sm text-slate-400">{filters.branch} · {filters.from} — {filters.to}</p>
            </div>
            <div className="flex rounded-md bg-slate-100 p-1" aria-label="Период графика">
              {periods.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setPeriod(days)}
                  aria-pressed={period === days}
                  className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                    period === days ? "bg-white text-brand-blue shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {days} дней
                </button>
              ))}
            </div>
          </div>

          <div className="flex h-56 items-end gap-1.5 border-b border-l border-slate-200 px-2 pt-4 sm:gap-2">
            {series.map((point, index) => (
              <div key={`${point.label}-${index}`} className="group relative flex h-full min-w-0 flex-1 items-end">
                <div
                  className="w-full rounded-t bg-brand-blue/75 transition-all group-hover:bg-brand-blue"
                  style={{ height: `${point.value}%` }}
                />
                <span className="pointer-events-none absolute left-1/2 top-0 hidden -translate-x-1/2 rounded bg-slate-800 px-2 py-1 text-xs text-white group-hover:block">
                  {point.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-bold text-slate-800">Детализация</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-navy text-white">
                <tr>
                  <th className="px-5 py-3.5 text-sm font-semibold">Название</th>
                  <th className="px-5 py-3.5 text-right text-sm font-semibold">{report.group === "sales" ? "Продажи" : "Результат"}</th>
                  <th className="px-5 py-3.5 text-right text-sm font-semibold">План</th>
                  <th className="px-5 py-3.5 text-right text-sm font-semibold">Выполнение</th>
                  <th className="px-5 py-3.5 text-right text-sm font-semibold">Динамика</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-700">{row.name}</td>
                    <td className="px-5 py-3.5 text-right text-slate-600">{formatPrimary(row.primary, report.group)}</td>
                    <td className="px-5 py-3.5 text-right text-slate-600">{formatNumber(row.plan)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <span className={`font-semibold ${row.completion >= 90 ? "text-brand-green" : "text-brand-orange"}`}>
                        {row.completion}%
                      </span>
                    </td>
                    <td className={`px-5 py-3.5 text-right font-semibold ${row.change >= 0 ? "text-brand-green" : "text-brand-red"}`}>
                      {row.change >= 0 ? "+" : ""}{row.change}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users
  label: string
  value: string
  tone: "blue" | "violet" | "green" | "orange"
}) {
  const tones = {
    blue: "bg-blue-50 text-brand-blue",
    violet: "bg-violet-50 text-violet-600",
    green: "bg-emerald-50 text-brand-green",
    orange: "bg-orange-50 text-brand-orange",
  }

  return (
    <article className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-slate-400">{label}</span>
        <strong className="block truncate text-xl text-slate-800" title={value}>{value}</strong>
      </span>
    </article>
  )
}
