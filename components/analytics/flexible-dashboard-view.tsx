"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RefButton, RefHeader } from "@/components/ref/list-kit"
import { formatRangeLabel, parseISODate, rangeForPeriod, toISODate, type PeriodKey } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"

const GEAR = "M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"

// "Гибкий дашборд" (demo #/dynamic-dashboard): the dashboards created in "Настроить дашборд" are the
// green tabs in the title row, the period buttons keep beginDate / endDate / typeDate in the address.
type Dashboard = { id: number; name: string }
type DashboardWidget = { id: number; reportSlug: string; reportLabel: string; dashboard: string }

const PERIODS: { key: PeriodKey; type: string }[] = [
  { key: "СЕГОДНЯ", type: "today" },
  { key: "ВЧЕРА", type: "yesterday" },
  { key: "ПОСЛ. 7", type: "week" },
  { key: "МЕСЯЦ", type: "month" },
  { key: "СВОЯ", type: "ownDate" },
]

const RAISED = "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
const FLAT = "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12)] hover:bg-slate-50"
const buttonCls = "h-8 min-w-[70px] whitespace-nowrap rounded-[5px] px-4 pt-[1px] text-[13px] font-normal uppercase"

export function FlexibleDashboardView() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [widgets, setWidgets] = useState<DashboardWidget[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const today = useMemo(() => new Date(), [])
  const urlType = searchParams.get("typeDate")
  const urlBegin = searchParams.get("beginDate")
  const urlEnd = searchParams.get("endDate")
  const period = PERIODS.find((item) => item.type === urlType)?.key ?? "МЕСЯЦ"
  const range = useMemo(() => {
    const custom =
      urlBegin && urlEnd ? { begin: parseISODate(urlBegin), end: parseISODate(urlEnd) } : rangeForPeriod("ПОСЛ. 7", today, { begin: today, end: today })
    return rangeForPeriod(period, today, custom)
  }, [period, today, urlBegin, urlEnd])

  useEffect(() => {
    fetch("/api/custom-dashboards", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((items: Dashboard[]) => {
        setDashboards(items)
        setSelectedId((current) => current ?? items[0]?.id ?? null)
      })
      .catch(() => {})
    fetch("/api/dashboard-widgets", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((items: DashboardWidget[]) => setWidgets(items))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [menuOpen])

  function go(next: PeriodKey, begin = range.begin, end = range.end) {
    const type = PERIODS.find((item) => item.key === next)!.type
    const span = rangeForPeriod(next, today, { begin, end })
    const params = new URLSearchParams({ beginDate: toISODate(span.begin), endDate: toISODate(span.end), typeDate: type })
    router.replace(`/analytics/flexible-dashboard?${params}`)
  }

  const selected = dashboards.find((dashboard) => dashboard.id === selectedId) ?? null
  const items = selected ? widgets.filter((widget) => widget.dashboard === selected.name) : []
  const menuItem = "flex h-12 w-full items-center px-4 text-left text-[13px] text-[#333] hover:bg-[#f2f5f8]"

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] font-sans text-[13px] text-[#333]">
      <div className="pl-[28px] pr-[36px]">
        <RefHeader title={t("Гибкий дашборд")}>
          <div className="relative -top-[4px] flex items-center gap-[10px]">
            {dashboards.map((dashboard) => (
              <button
                key={dashboard.id}
                type="button"
                onClick={() => setSelectedId(dashboard.id)}
                className={`${buttonCls} normal-case ${dashboard.id === selectedId ? `bg-[#2bcd53] text-white ${RAISED}` : FLAT}`}
              >
                {dashboard.name}
              </button>
            ))}
            <div ref={menuRef} className="relative">
              <RefButton icon={GEAR} label={t("Настройки")} onClick={() => setMenuOpen((open) => !open)} />
              {menuOpen && (
                <div className={`absolute right-0 top-full z-30 w-[280px] rounded-[8px] bg-white p-1 ${RAISED}`}>
                  <button type="button" onClick={() => router.push("/analytics/dashboard-settings")} className={menuItem}>
                    {t("Настроить дашборд")}
                  </button>
                  <button type="button" onClick={() => router.push("/analytics/quick-report")} className={menuItem}>
                    {t("Конструктор отчетов")}
                  </button>
                  <button type="button" onClick={() => setMenuOpen(false)} className={menuItem}>
                    {t("Добавить/изменить виджеты")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </RefHeader>
      </div>

      <section className={`relative mx-[28px] flex h-[55px] items-center rounded-[2px] bg-white px-[15px] ${RAISED}`}>
        {PERIODS.map((item) => (
          <button
            type="button"
            key={item.key}
            onClick={() => go(item.key)}
            className={`${buttonCls} ${period === item.key ? `bg-[#4f71dc] text-white ${RAISED}` : FLAT}`}
          >
            {t(item.key)}
          </button>
        ))}
        {period === "СВОЯ" && (
          <div className="relative ml-[37px]">
            <button type="button" onClick={() => setPickerOpen((open) => !open)} className="text-[13px] font-bold text-[#4f71dc]">
              {formatRangeLabel(range.begin, range.end)}
            </button>
            {pickerOpen && (
              <DateRangePicker
                begin={toISODate(range.begin)}
                end={toISODate(range.end)}
                onClose={() => setPickerOpen(false)}
                onApply={(from, to) => {
                  go("СВОЯ", parseISODate(from), parseISODate(to))
                  setPickerOpen(false)
                }}
              />
            )}
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <section className="mx-[28px] mt-[20px] h-[300px] border border-[#e3e3e3] bg-white bg-[url('/robot-empty.png')] bg-[length:200px_auto] bg-center bg-no-repeat pt-[250px] text-center text-[13px] leading-[16.25px] text-[#666]">
          {t("По вашему запросу ничего не найдено...")}
        </section>
      ) : (
        <section className="mx-[28px] mt-[20px] grid min-h-[300px] grid-cols-3 gap-[15px] border border-[#e3e3e3] bg-white p-[15px]">
          {items.map((widget) => (
            <button
              key={widget.id}
              type="button"
              onClick={() => router.push(`/analytics/${widget.reportSlug}`)}
              className={`h-[120px] rounded-[2px] bg-white p-[20px] text-left text-[16px] font-semibold text-[#333] ${RAISED}`}
            >
              {widget.reportLabel || widget.reportSlug}
            </button>
          ))}
        </section>
      )}
    </main>
  )
}
