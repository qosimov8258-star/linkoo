"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { BarChart3, Plus, Settings, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Period = "Сегодня" | "Вчера" | "Посл. 7" | "Месяц" | "Своя"
type WidgetId = "Продажи" | "Оплаты" | "АКБ" | "Визиты"
type Dashboard = { id: number; name: string; widgets: WidgetId[] }

const periods: Period[] = ["Сегодня", "Вчера", "Посл. 7", "Месяц", "Своя"]
const widgetOptions: { id: WidgetId; description: string; color: string }[] = [
  { id: "Продажи", description: "Сумма отгруженных заказов", color: "bg-blue-500" },
  { id: "Оплаты", description: "Поступившие оплаты", color: "bg-emerald-500" },
  { id: "АКБ", description: "Активная клиентская база", color: "bg-violet-500" },
  { id: "Визиты", description: "Выполнение маршрутов агентов", color: "bg-amber-500" },
]
const storageKey = "linko-flexible-dashboards"

function periodLabel(period: Period) {
  const now = new Date()
  if (period === "Сегодня") return now.toLocaleDateString("ru-RU")
  if (period === "Вчера") { const date = new Date(now); date.setDate(now.getDate() - 1); return date.toLocaleDateString("ru-RU") }
  if (period === "Посл. 7") return "последние 7 дней"
  if (period === "Месяц") return now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  return "выбранный период"
}

export function FlexibleDashboardView() {
  const router = useRouter()
  const [period, setPeriod] = useState<Period>("Месяц")
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [widgetOpen, setWidgetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [selectedWidgets, setSelectedWidgets] = useState<WidgetId[]>([])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]") as Dashboard[]
      if (Array.isArray(saved)) { setDashboards(saved); setSelectedId(saved[0]?.id ?? null) }
    } catch { localStorage.removeItem(storageKey) }
  }, [])

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(dashboards)) }, [dashboards])

  const selectedDashboard = useMemo(() => dashboards.find((dashboard) => dashboard.id === selectedId) ?? null, [dashboards, selectedId])
  const widgets = selectedDashboard?.widgets ?? []

  function createDashboard() {
    const name = newName.trim()
    if (!name) return
    const dashboard = { id: Date.now(), name, widgets: [] as WidgetId[] }
    setDashboards((current) => [...current, dashboard])
    setSelectedId(dashboard.id)
    setNewName("")
    setCreateOpen(false)
  }

  function openWidgets() {
    if (!selectedDashboard) return
    setSelectedWidgets(selectedDashboard.widgets)
    setSettingsOpen(false)
    setWidgetOpen(true)
  }

  function saveWidgets() {
    if (!selectedDashboard) return
    setDashboards((current) => current.map((dashboard) => dashboard.id === selectedDashboard.id ? { ...dashboard, widgets: selectedWidgets } : dashboard))
    setWidgetOpen(false)
  }

  function deleteDashboard() {
    if (!selectedDashboard) return
    const remaining = dashboards.filter((dashboard) => dashboard.id !== selectedDashboard.id)
    setDashboards(remaining)
    setSelectedId(remaining[0]?.id ?? null)
    setSettingsOpen(false)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] text-[#17233b]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] px-6 py-4 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-xl font-bold text-[#4f71dc]" /><span className="text-2xl font-light text-[#586174]">|</span>
          <span className="text-xl font-bold text-[#586174]">Гибкий дашборд</span>
        </div>
        <div className="flex items-center gap-3">
          {dashboards.length > 0 && <select aria-label="Выберите дашборд" value={selectedId ?? ""} onChange={(event) => setSelectedId(Number(event.target.value))} className="h-10 max-w-48 rounded-md border border-[#d8dee7] bg-white px-3 text-sm font-medium"><option value="" disabled>Выберите дашборд</option>{dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}</select>}
          <button type="button" onClick={() => setCreateOpen(true)} className="flex h-10 items-center gap-2 rounded-md bg-[#4f71dc] px-4 font-semibold text-white hover:bg-[#405fdb]"><Plus className="h-4 w-4" /> Добавить дашборд</button>
          <div className="relative"><button type="button" onClick={() => setSettingsOpen((value) => !value)} className="flex h-10 items-center gap-2 rounded-md bg-[#4f71dc] px-4 font-semibold text-white hover:bg-[#405fdb]"><Settings className="h-4 w-4" /> Настройки</button>
            {settingsOpen && <div className="absolute right-0 top-12 z-30 w-72 rounded-md bg-white py-2 shadow-xl"><button type="button" onClick={openWidgets} disabled={!selectedDashboard} className="block w-full px-6 py-3 text-left text-[#586174] hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">Добавить/изменить виджеты</button><button type="button" onClick={openWidgets} disabled={!selectedDashboard} className="block w-full px-6 py-3 text-left text-[#586174] hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">Настроить дашборд</button><button type="button" onClick={() => router.push("/analytics/report-builder")} className="block w-full px-6 py-3 text-left text-[#586174] hover:bg-slate-50">Конструктор отчетов</button>{selectedDashboard && <button type="button" onClick={deleteDashboard} className="block w-full px-6 py-3 text-left text-red-500 hover:bg-red-50">Удалить дашборд</button>}{!selectedDashboard && <p className="px-6 py-3 text-sm text-red-400">Сначала добавьте дашборд</p>}</div>}
          </div>
        </div>
      </header>

      <section className="mx-6 mt-4 flex flex-wrap gap-0 rounded-md border border-[#d8dee7] bg-white p-3 shadow-sm md:mx-9">{periods.map((item) => <button type="button" key={item} onClick={() => setPeriod(item)} className={`rounded-md border px-5 py-2 text-sm font-medium ${period === item ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e1e5eb] bg-white hover:bg-slate-50"}`}>{item.toUpperCase()}</button>)}</section>

      <section className="mx-6 mt-6 min-h-[370px] border border-[#d8dee7] bg-white md:mx-9">
        {!selectedDashboard || widgets.length === 0 ? <div className="flex min-h-[370px] flex-col items-center justify-center"><Image src="/robot-mascot.png" alt="Робот-помощник" width={170} height={170} className="h-44 w-44 object-contain" /><p className="mt-4 text-[#657089]">По вашему запросу ничего не найдено...</p>{selectedDashboard && <button type="button" onClick={openWidgets} className="mt-5 rounded-md bg-[#4f71dc] px-4 py-2 text-sm font-semibold text-white">Добавить виджеты</button>}</div> : <div className="grid gap-5 p-6 sm:grid-cols-2 xl:grid-cols-4">{widgets.map((widget, index) => { const option = widgetOptions.find((item) => item.id === widget)!; const multiplier = period === "Сегодня" ? 1 : period === "Вчера" ? 0.82 : period === "Посл. 7" ? 5.7 : 24; const value = widget === "Продажи" ? `${Math.round(3.2 * multiplier).toLocaleString("ru-RU")} млн` : widget === "Оплаты" ? `${Math.round(2.1 * multiplier).toLocaleString("ru-RU")} млн` : widget === "АКБ" ? String(Math.round(17 * multiplier)) : `${Math.min(100, 76 + index * 7)}%`; return <article key={widget} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className={`mb-4 inline-flex rounded-lg p-2 text-white ${option.color}`}><BarChart3 className="h-5 w-5" /></div><p className="text-sm text-slate-500">{option.description}</p><p className="mt-2 text-3xl font-bold text-slate-800">{value}</p><p className="mt-3 text-xs text-slate-400">Период: {periodLabel(period)}</p></article> })}</div>}
      </section>

      {createOpen &&<Modal title="Создать дашборд" onClose={() => setCreateOpen(false)}><label className="block border-b border-slate-300 pb-2 text-sm font-medium">Наименование <span className="text-red-500">*</span><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createDashboard()} className="mt-2 block w-full bg-transparent text-base outline-none" /></label><div className="mt-20 flex justify-end"><button type="button" disabled={!newName.trim()} onClick={createDashboard} className="rounded-md bg-[#71ce87] px-5 py-3 font-bold text-white disabled:opacity-50">СОХРАНИТЬ</button></div></Modal>}
      {widgetOpen && <Modal title="Настроить дашборд" onClose={() => setWidgetOpen(false)}><p className="mb-4 text-sm text-slate-500">Выберите виджеты для «{selectedDashboard?.name}».</p><div className="space-y-3">{widgetOptions.map((option) => <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-4 hover:bg-slate-50"><input type="checkbox" checked={selectedWidgets.includes(option.id)} onChange={() => setSelectedWidgets((current) => current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id])} className="h-4 w-4 accent-[#4f71dc]" /><span><strong className="block">{option.id}</strong><small className="text-slate-500">{option.description}</small></span></label>)}</div><div className="mt-6 flex justify-end"><button type="button" onClick={saveWidgets} className="rounded-md bg-[#71ce87] px-5 py-3 font-bold text-white">СОХРАНИТЬ</button></div></Modal>}
    </main>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}><section role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} className="w-[625px] max-w-[92vw] rounded-sm bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-9 py-6"><h2 className="text-lg font-bold uppercase">{title}</h2><button type="button" aria-label="Закрыть" onClick={onClose}><X className="h-7 w-7 text-slate-500" /></button></header><div className="p-9">{children}</div></section></div>
}
