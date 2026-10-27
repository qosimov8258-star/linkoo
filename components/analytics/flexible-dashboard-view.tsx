"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BarChart3, X } from "lucide-react"
import { RefButton, RefHeader } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"
import { formatAmounts } from "@/components/dashboard/stat-cards"

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

const pad = (value: number) => String(value).padStart(2, "0")
const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const shownDay = (iso: string) => iso.split("-").reverse().join(".")

/** The local days (inclusive) a period covers; "Своя" uses the dates the user picked. */
function periodRange(period: Period, custom: { from: string; to: string }): { begin: string; end: string } {
  const now = new Date()
  const today = isoDay(now)
  if (period === "Сегодня") return { begin: today, end: today }
  if (period === "Вчера") { const date = new Date(now); date.setDate(now.getDate() - 1); return { begin: isoDay(date), end: isoDay(date) } }
  if (period === "Посл. 7") { const date = new Date(now); date.setDate(now.getDate() - 6); return { begin: isoDay(date), end: today } }
  if (period === "Месяц") return { begin: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  return custom.from <= custom.to ? { begin: custom.from, end: custom.to } : { begin: custom.to, end: custom.from }
}

function periodLabel(range: { begin: string; end: string }) {
  return range.begin === range.end ? shownDay(range.begin) : `${shownDay(range.begin)} - ${shownDay(range.end)}`
}

export function FlexibleDashboardView() {
  const { t } = useLanguage()
  const router = useRouter()
  const [period, setPeriod] = useState<Period>("Месяц")
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [widgetOpen, setWidgetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [selectedWidgets, setSelectedWidgets] = useState<WidgetId[]>([])
  const [custom, setCustom] = useState(() => { const range = periodRange("Месяц", { from: "", to: "" }); return { from: range.begin, to: range.end } })
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [summaryState, setSummaryState] = useState<"idle" | "loading" | "error">("idle")

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]") as Dashboard[]
      if (Array.isArray(saved)) { setDashboards(saved); setSelectedId(saved[0]?.id ?? null) }
    } catch { localStorage.removeItem(storageKey) }
  }, [])

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(dashboards)) }, [dashboards])

  const selectedDashboard = useMemo(() => dashboards.find((dashboard) => dashboard.id === selectedId) ?? null, [dashboards, selectedId])
  const widgets = selectedDashboard?.widgets ?? []
  const range = useMemo(() => periodRange(period, custom), [period, custom])
  const needsSummary = widgets.some((widget) => widget !== "Визиты")

  // Real figures of the period (the same totals as the main dashboard's cards).
  useEffect(() => {
    if (!needsSummary || !/^\d{4}-\d{2}-\d{2}$/.test(range.begin) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) return
    let cancelled = false
    setSummaryState("loading")
    fetch(`/api/dashboard-summary?begin=${range.begin}&end=${range.end}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return (await response.json()) as DashboardSummary
      })
      .then((data) => { if (!cancelled) { setSummary(data); setSummaryState("idle") } })
      .catch(() => { if (!cancelled) { setSummary(null); setSummaryState("error") } })
    return () => { cancelled = true }
  }, [needsSummary, range.begin, range.end])

  function widgetValue(widget: WidgetId): string[] {
    // No visit tracking data is stored yet: say so instead of inventing a percentage.
    if (widget === "Визиты") return [t("Нет данных")]
    if (summaryState === "loading" && !summary) return [t("Загрузка...")]
    if (summaryState === "error" || !summary) return [t("Нет данных")]
    if (widget === "Продажи") return formatAmounts(summary.sales)
    if (widget === "Оплаты") return formatAmounts(summary.payments)
    return [String(summary.akb)]
  }

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
        <RefHeader title={t("Гибкий дашборд")}>
          {dashboards.map((dashboard) => (
            <button key={dashboard.id} type="button" onClick={() => setSelectedId(dashboard.id)} className={`h-[30px] min-w-[70px] rounded-[3px] px-4 text-[13px] font-semibold text-white hover:brightness-95 ${dashboard.id === selectedId ? "bg-[#2bcd53]" : "bg-[#9ad9ab]"}`}>{dashboard.name}</button>
          ))}
          <div className="relative">
            <RefButton icon={GEAR} label={t("Настройки")} onClick={() => setSettingsOpen((value) => !value)} />
            {settingsOpen && (
              <div className="absolute right-0 top-[34px] z-30 w-72 bg-white py-2 shadow-xl">
                <button type="button" onClick={() => { setSettingsOpen(false); setCreateOpen(true) }} className={menuItem}>{t("Добавить дашборд")}</button>
                <button type="button" onClick={openWidgets} disabled={!selectedDashboard} className={menuItem}>{t("Добавить/изменить виджеты")}</button>
                <button type="button" onClick={openWidgets} disabled={!selectedDashboard} className={menuItem}>{t("Настроить дашборд")}</button>
                <button type="button" onClick={() => router.push("/analytics/report-builder")} className={menuItem}>{t("Конструктор отчетов")}</button>
                {selectedDashboard && <button type="button" onClick={deleteDashboard} className="block w-full px-6 py-3 text-left text-[13px] text-red-500 hover:bg-red-50">{t("Удалить дашборд")}</button>}
                {!selectedDashboard && <p className="px-6 py-3 text-[12px] text-red-400">{t("Сначала добавьте дашборд")}</p>}
              </div>
            )}
          </div>
        </RefHeader>
      </div>

      <section className={`mx-7 flex gap-0 p-[14px] ${CARD}`}>
        {periods.map((item, index) => (
          <button type="button" key={item} onClick={() => setPeriod(item)} className={`h-[32px] border px-[16px] text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${index === periods.length - 1 ? "rounded-r-[3px]" : ""} ${period === item ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e8e8e8] bg-white text-black hover:bg-[#f2f5f8]"}`}>{t(item).toUpperCase()}</button>
        ))}
        {period === "Своя" && (
          <div className="ml-6 flex items-center gap-3 text-[13px]">
            <label className="flex items-center gap-2">{t("От")}<input type="date" value={custom.from} max={custom.to || undefined} onChange={(event) => event.target.value && setCustom((value) => ({ ...value, from: event.target.value }))} className="h-[32px] border-b border-[#e0e0e0] outline-none" /></label>
            <label className="flex items-center gap-2">{t("До")}<input type="date" value={custom.to} min={custom.from || undefined} onChange={(event) => event.target.value && setCustom((value) => ({ ...value, to: event.target.value }))} className="h-[32px] border-b border-[#e0e0e0] outline-none" /></label>
          </div>
        )}
      </section>

      <section className="mx-7 mt-[20px] min-h-[300px] border border-[#e8e8e8] bg-white">
        {!selectedDashboard || widgets.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center">
            <ReportEmpty className="pb-0 pt-[10px]" />
            {selectedDashboard && <button type="button" onClick={openWidgets} className="mt-5 h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white">{t("Добавить виджеты")}</button>}
          </div>
        ) : (
          <div className="grid gap-5 p-6 sm:grid-cols-2 xl:grid-cols-4">
            {widgets.map((widget) => {
              const option = widgetOptions.find((item) => item.id === widget)
              if (!option) return null
              return (
                <article key={widget} className="rounded-lg border border-[#e8e8e8] bg-white p-5 shadow-sm">
                  <div className={`mb-4 inline-flex rounded-lg p-2 text-white ${option.color}`}><BarChart3 className="h-5 w-5" /></div>
                  <p className="text-[13px] font-semibold text-[#333]">{t(option.id)}</p>
                  <p className="text-[13px] text-[#555]">{t(option.description)}</p>
                  {widgetValue(widget).map((line) => <p key={line} className="mt-2 text-[24px] font-bold">{line}</p>)}
                  <p className="mt-3 text-[12px] text-[#999]">{t("Период:")} {periodLabel(range)}</p>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {createOpen &&<Modal title={t("Создать дашборд")} onClose={() => setCreateOpen(false)}><label className="block border-b border-slate-300 pb-2 text-sm font-medium">{t("Наименование")} <span className="text-red-500">*</span><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && createDashboard()} className="mt-2 block w-full bg-transparent text-base outline-none" /></label><div className="mt-20 flex justify-end"><button type="button" disabled={!newName.trim()} onClick={createDashboard} className="rounded-md bg-[#71ce87] px-5 py-3 font-bold text-white disabled:opacity-50">{t("СОХРАНИТЬ")}</button></div></Modal>}
      {widgetOpen && <Modal title={t("Настроить дашборд")} onClose={() => setWidgetOpen(false)}><p className="mb-4 text-sm text-slate-500">{t("Выберите виджеты для дашборда")} «{selectedDashboard?.name}».</p><div className="space-y-3">{widgetOptions.map((option) => <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-4 hover:bg-slate-50"><input type="checkbox" checked={selectedWidgets.includes(option.id)} onChange={() => setSelectedWidgets((current) => current.includes(option.id) ? current.filter((item) => item !== option.id) : [...current, option.id])} className="h-4 w-4 accent-[#4f71dc]" /><span><strong className="block">{t(option.id)}</strong><small className="text-slate-500">{t(option.description)}</small></span></label>)}</div><div className="mt-6 flex justify-end"><button type="button" onClick={saveWidgets} className="rounded-md bg-[#71ce87] px-5 py-3 font-bold text-white">{t("СОХРАНИТЬ")}</button></div></Modal>}
    </ReportPage>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const { t } = useLanguage()
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}><section role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} className="w-[625px] max-w-[92vw] rounded-sm bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-9 py-6"><h2 className="text-lg font-bold uppercase">{title}</h2><button type="button" aria-label={t("Закрыть")} onClick={onClose}><X className="h-7 w-7 text-slate-500" /></button></header><div className="p-9">{children}</div></section></div>
}
