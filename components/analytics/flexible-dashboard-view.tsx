"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BarChart3, X } from "lucide-react"
import { RefButton, RefHeader } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage } from "@/components/ref/report-kit"

const GEAR = "M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"

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

  const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
  const menuItem = "block w-full px-6 py-3 text-left text-[13px] text-[#555] hover:bg-[#f2f5f8] disabled:cursor-not-allowed disabled:text-[#c4c4c4]"

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title="Гибкий дашборд">
          {dashboards.map((dashboard) => (
            <button key={dashboard.id} type="button" onClick={() => setSelectedId(dashboard.id)} className={`h-[30px] min-w-[70px] rounded-[3px] px-4 text-[13px] font-semibold text-white hover:brightness-95 ${dashboard.id === selectedId ? "bg-[#2bcd53]" : "bg-[#9ad9ab]"}`}>{dashboard.name}</button>
          ))}
          <div className="relative">
            <RefButton icon={GEAR} label="Настройки" onClick={() => setSettingsOpen((value) => !value)} />
            {settingsOpen && (
              <div className="absolute right-0 top-[34px] z-30 w-72 bg-white py-2 shadow-xl">
                <button type="button" onClick={() => { setSettingsOpen(false); setCreateOpen(true) }} className={menuItem}>Добавить дашборд</button>
                <button type="button" onClick={openWidgets} disabled={!selectedDashboard} className={menuItem}>Добавить/изменить виджеты</button>
                <button type="button" onClick={openWidgets} disabled={!selectedDashboard} className={menuItem}>Настроить дашборд</button>
                <button type="button" onClick={() => router.push("/analytics/report-builder")} className={menuItem}>Конструктор отчетов</button>
                {selectedDashboard && <button type="button" onClick={deleteDashboard} className="block w-full px-6 py-3 text-left text-[13px] text-red-500 hover:bg-red-50">Удалить дашборд</button>}
                {!selectedDashboard && <p className="px-6 py-3 text-[12px] text-red-400">Сначала добавьте дашборд</p>}
              </div>
            )}
          </div>
        </RefHeader>
      </div>

      <section className={`mx-7 flex gap-0 p-[14px] ${CARD}`}>
        {periods.map((item, index) => (
          <button type="button" key={item} onClick={() => setPeriod(item)} className={`h-[32px] border px-[16px] text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${index === periods.length - 1 ? "rounded-r-[3px]" : ""} ${period === item ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e8e8e8] bg-white text-black hover:bg-[#f2f5f8]"}`}>{item.toUpperCase()}</button>
        ))}
      </section>

      <section className="mx-7 mt-[20px] min-h-[300px] border border-[#e8e8e8] bg-white">
        {!selectedDashboard || widgets.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center">
            <ReportEmpty className="pb-0 pt-[10px]" />
            {selectedDashboard && <button type="button" onClick={openWidgets} className="mt-5 h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white">Добавить виджеты</button>}
          </div>
        ) : (
          <div className="grid gap-5 p-6 sm:grid-cols-2 xl:grid-cols-4">
            {widgets.map((widget, index) => {
              const option = widgetOptions.find((item) => item.id === widget)!
              const multiplier = period === "Сегодня" ? 1 : period === "Вчера" ? 0.82 : period === "Посл. 7" ? 5.7 : 24
              const value = widget === "Продажи" ? `${Math.round(3.2 * multiplier).toLocaleString("ru-RU")} млн` : widget === "Оплаты" ? `${Math.round(2.1 * multiplier).toLocaleString("ru-RU")} млн` : widget === "АКБ" ? String(Math.round(17 * multiplier)) : `${Math.min(100, 76 + index * 7)}%`
              return (
                <article key={widget} className="rounded-lg border border-[#e8e8e8] bg-white p-5 shadow-sm">
                  <div className={`mb-4 inline-flex rounded-lg p-2 text-white ${option.color}`}><BarChart3 className="h-5 w-5" /></div>
                  <p className="text-[13px] text-[#555]">{option.description}</p>
                  <p className="mt-2 text-[28px] font-bold">{value}</p>
                  <p className="mt-3 text-[12px] text-[#999]">Период: {periodLabel(period)}</p>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {createOpen &&<Modal title="Создать дашборд" onClose={() => setCreateOpen(false)}><label className="block border-b border-slate-300 pb-2 text-sm font-medium">Наименование <span className="text-red-500">*</span><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createDashboard()} className="mt-2 block w-full bg-transparent text-base outline-none" /></label><div className="mt-20 flex justify-end"><button type="button" disabled={!newName.trim()} onClick={createDashboard} className="rounded-md bg-[#71ce87] px-5 py-3 font-bold text-white disabled:opacity-50">СОХРАНИТЬ</button></div></Modal>}
      {widgetOpen && <Modal title="Настроить дашборд" onClose={() => setWidgetOpen(false)}><p className="mb-4 text-sm text-slate-500">Выберите виджеты для «{selectedDashboard?.name}».</p><div className="space-y-3">{widgetOptions.map((option) => <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-4 hover:bg-slate-50"><input type="checkbox" checked={selectedWidgets.includes(option.id)} onChange={() => setSelectedWidgets((current) => current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id])} className="h-4 w-4 accent-[#4f71dc]" /><span><strong className="block">{option.id}</strong><small className="text-slate-500">{option.description}</small></span></label>)}</div><div className="mt-6 flex justify-end"><button type="button" onClick={saveWidgets} className="rounded-md bg-[#71ce87] px-5 py-3 font-bold text-white">СОХРАНИТЬ</button></div></Modal>}
    </ReportPage>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}><section role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} className="w-[625px] max-w-[92vw] rounded-sm bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-9 py-6"><h2 className="text-lg font-bold uppercase">{title}</h2><button type="button" aria-label="Закрыть" onClick={onClose}><X className="h-7 w-7 text-slate-500" /></button></header><div className="p-9">{children}</div></section></div>
}
