"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, X } from "lucide-react"

import { DayCell, ICONS, Icon } from "@/components/analytics/attendance-cells"
import { AttendanceDayDrawer } from "@/components/analytics/attendance-day-drawer"
import {
  EditDialog,
  FilterPanel,
  ImportDialog,
  MONTH_KEYS,
  Stepper,
  WeekendDialog,
  WorkTimeDialog,
  callApi,
} from "@/components/analytics/attendance-dialogs"
import { ConfirmDialog, ErrorBlock, useCanManage } from "@/components/analytics/cash-management-shared"
import { RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage } from "@/components/ref/report-kit"
import { cameCount, cameFlag, formatLate, monthDays, type AttendanceDay, type AttendanceMonth } from "@/lib/attendance-types"
import { downloadExcelTable } from "@/lib/excel-export"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Посещаемость (/analytics/work-attendance, demo #/attendance/): one row per active employee,
// one column per day of the month (icons by day type), the "Пришел вовремя" totals, and the
// actions Добавить выходные дни / Рабочее время / Обновить с excel / Скачать / Изменить /
// Перерасчет. URL state: year, month, search, branch, date + id (the agent-day drawer).
// Data: GET /api/work-attendance (lib/attendance-repo.ts).

const WEEKDAYS_BY_UTC_DAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
const MANAGE = ["settings.manage"] as const

type Notice = { text: string; tone: "success" | "error" }

function numberParam(value: string | null, min: number, max: number): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null
  const number = Number(value)
  return number >= min && number <= max ? number : null
}

function idsParam(value: string | null): number[] {
  return [...new Set(String(value ?? "").split(",").map((part) => numberParam(part.trim(), 1, 2_147_483_647)).filter((id): id is number => id !== null))]
}

function dotDate(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

export function AttendanceView() {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const today = todayIso()
  const year = numberParam(searchParams.get("year"), 2000, 2100) ?? Number(today.slice(0, 4))
  const month = numberParam(searchParams.get("month"), 1, 12) ?? Number(today.slice(5, 7))
  const search = (searchParams.get("search") ?? "").slice(0, 100)
  const branchParam = searchParams.get("branch") ?? ""
  const branchIds = useMemo(() => idsParam(branchParam), [branchParam])
  const drawerId = numberParam(searchParams.get("id"), 1, 2_147_483_647)
  const drawerDateRaw = searchParams.get("date") ?? ""
  const drawerDate = /^\d{4}-\d{2}-\d{2}$/.test(drawerDateRaw) ? drawerDateRaw : null

  const canManage = useCanManage(MANAGE)
  const [query, setQuery] = useState(search)
  const [data, setData] = useState<{ key: string; month: AttendanceMonth | null; error: string } | null>(null)
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialog, setDialog] = useState<"weekend" | "workTime" | "import" | "edit" | "recalc" | null>(null)
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [recalcError, setRecalcError] = useState("")
  const [notice, setNotice] = useState<Notice | null>(null)
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key)
        else next.set(key, value)
      }
      const text = next.toString()
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  useEffect(() => setQuery(search), [search])

  const requestKey = `${year}-${month}|${search}|${branchIds.join(",")}|${reload}`
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ year: String(year), month: String(month) })
    if (search) params.set("search", search)
    if (branchIds.length) params.set("branch", branchIds.join(","))
    void callApi<AttendanceMonth>(`/api/work-attendance?${params}`).then((result) => {
      if (cancelled) return
      setData({ key: requestKey, month: result.ok ? result.data : null, error: result.ok ? "" : result.error })
    })
    return () => {
      cancelled = true
    }
  }, [year, month, search, branchIds, requestKey])

  useEffect(() => {
    let cancelled = false
    void callApi<{ id: number; name: string }[]>("/api/branches").then((result) => {
      if (!cancelled && result.ok && Array.isArray(result.data)) setBranches(result.data.map((branch) => ({ id: Number(branch.id), name: String(branch.name ?? "") })))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const loading = !data || data.key !== requestKey
  const current = loading ? null : data.month
  const days = useMemo(() => monthDays(year, month), [year, month])
  const holidays = useMemo(() => new Set(current?.holidays ?? []), [current])
  const users = useMemo(() => current?.users ?? [], [current])
  const entries = useMemo(() => new Map(users.map((user) => [user.id, new Map<string, AttendanceDay>(user.dates.map((day) => [day.date, day]))])), [users])
  const visibleIds = users.map((user) => user.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))
  const workingDays = current?.workingDays ?? days.length - holidays.size

  const goMonth = (offset: number) => {
    const index = year * 12 + (month - 1) + offset
    const nextYear = Math.floor(index / 12)
    if (nextYear < 2000 || nextYear > 2100) return
    setSelected([])
    setParams({ year: String(nextYear), month: String((index % 12) + 1) })
  }
  const goYear = (offset: number) => {
    const nextYear = year + offset
    if (nextYear < 2000 || nextYear > 2100) return
    setSelected([])
    setParams({ year: String(nextYear) })
  }

  const openDrawer = (id: number, day: string) => setParams({ id: String(id), date: day })
  const defaultDay = () => {
    const last = days[days.length - 1]
    if (today >= days[0] && today <= last) return today
    return today > last ? last : days[0]
  }

  function exportRows() {
    const header = [t("Агент"), t("Должность"), ...days.map(dotDate), t("Вовремя"), t("Опоздал"), t("Не пришел"), t("Всего")]
    const rows = users.map((user) => [
      user.name,
      user.position,
      ...days.map((day) => cameFlag(entries.get(user.id)?.get(day)?.type)),
      user.counts.on_time,
      user.counts.late,
      user.counts.not_come,
      workingDays,
    ])
    downloadExcelTable(t("Посещаемость"), [header, ...rows])
  }

  async function recalc() {
    setRecalcBusy(true)
    setRecalcError("")
    const result = await callApi<{ recalculated: number }>("/api/work-attendance/recalc", { method: "POST", body: JSON.stringify({ year, month }) })
    setRecalcBusy(false)
    if (!result.ok) return setRecalcError(result.error)
    setDialog(null)
    setNotice({ text: t("Перерасчет выполнен"), tone: "success" })
    setReload((value) => value + 1)
  }

  const toggleRow = (id: number) => setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]))

  return (
    <ReportPage>
      <div className="px-4 sm:pl-[30px] sm:pr-[38px]">
        <RefHeader title={t("Посещаемость")}>
          <div className="flex flex-wrap items-center justify-end gap-[10px]">
            {canManage && <RefButton icon={RI.add} green label={t("Добавить выходные дни")} onClick={() => setDialog("weekend")} />}
            {canManage && <RefButton icon={RI.clock} label={t("Рабочее время")} disabled={loading} onClick={() => setDialog("workTime")} />}
            {canManage && <RefButton icon={RI.sync} label={t("Обновить с excel")} onClick={() => setDialog("import")} />}
            <RefButton icon={RI.chart} green label={t("Скачать")} disabled={loading || !users.length} onClick={exportRows} />
          </div>
        </RefHeader>
      </div>

      <section className="relative mx-4 rounded-[10px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] sm:mx-7">
        {canManage && (
          <div className="flex h-[52px] items-center justify-end gap-[19px] border-b border-[#efefef] px-[30px]">
            <RefButton
              icon={RI.edit}
              label={t("Изменить")}
              onClick={() => {
                if (!selected.length) setNotice({ text: t("Хотя бы выберете одного агента !"), tone: "error" })
                else setDialog("edit")
              }}
            />
            <RefButton icon={RI.sync} label={t("Перерасчет")} disabled={loading} onClick={() => setDialog("recalc")} />
          </div>
        )}
        <div className="relative flex min-h-[53px] flex-wrap items-center gap-x-[20px] gap-y-[8px] border-b border-[#efefef] px-[15px] py-[8px]">
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 pr-4 text-[13px] font-semibold text-white hover:brightness-95"
          >
            <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden>
              <path d={RI.filter} />
            </svg>
            {t("Показать фильтр")}
            {branchIds.length > 0 && <span className="ml-2 rounded-full bg-white/25 px-[6px] text-[11px]">{branchIds.length}</span>}
          </button>
          <form
            className="flex w-full items-center gap-[8px] sm:w-[25%] sm:min-w-[260px]"
            onSubmit={(event) => {
              event.preventDefault()
              setSelected([])
              setParams({ search: query.trim() || null })
            }}
          >
            <label className="shrink-0 text-[13px] font-semibold text-black" htmlFor="attendance-search">
              {t("Поиск")}
            </label>
            <div className="flex h-[30px] min-w-0 flex-1 items-center border border-dashed border-[#c9ced6] pl-[8px]">
              <input id="attendance-search" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
              {query && (
                <button
                  type="button"
                  aria-label={t("Очистить")}
                  onClick={() => {
                    setQuery("")
                    if (search) setParams({ search: null })
                  }}
                  className="px-[4px] text-[#999] hover:text-black"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <button type="submit" aria-label={t("Поиск")} className="flex h-full w-[30px] items-center justify-center hover:bg-[#f2f5f8]">
                <Icon path={ICONS.search} color="#444" size={20} />
              </button>
            </div>
          </form>
          <div className="ml-auto flex flex-wrap items-center gap-[16px]">
            <Stepper label={year} onPrev={() => goYear(-1)} onNext={() => goYear(1)} prevLabel="Предыдущий год" nextLabel="Следующий год" width={48} prevDisabled={year <= 2000} nextDisabled={year >= 2100} />
            <Stepper label={t(MONTH_KEYS[month - 1])} onPrev={() => goMonth(-1)} onNext={() => goMonth(1)} prevLabel="Предыдущий месяц" nextLabel="Следующий месяц" />
          </div>
          {filterOpen && (
            <FilterPanel
              branches={branches}
              value={branchIds}
              onClose={() => setFilterOpen(false)}
              onApply={(ids) => {
                setFilterOpen(false)
                setSelected([])
                setParams({ branch: ids.length ? ids.join(",") : null })
              }}
            />
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#4f71dc]" />
          </div>
        ) : data?.error ? (
          <ErrorBlock error={data.error} onRetry={() => setReload((value) => value + 1)} />
        ) : !users.length ? (
          <ReportEmpty text="По вашему запросу ничего не найдено" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-[13px] text-[#333]">
              <colgroup>
                <col className="w-[50px]" />
                <col className="w-[208px]" />
                {days.map((day) => (
                  <col key={day} className="w-[27px]" />
                ))}
                <col className="w-[170px]" />
              </colgroup>
              <thead className="bg-[rgb(240,244,249)] text-[rgb(55,69,87)]">
                <tr className="h-[55px]">
                  <th className="text-center">
                    <button
                      type="button"
                      aria-label={t("Выбрать всех")}
                      title={t("Выбрать всех")}
                      onClick={() => setSelected(allSelected ? [] : visibleIds)}
                      className="mx-auto flex items-center justify-center"
                    >
                      <Icon path={allSelected ? ICONS.checked : ICONS.selectAll} color="#444" size={22} />
                    </button>
                  </th>
                  <th className="px-[6px] text-left font-semibold">{t("Агент")}</th>
                  {days.map((day) => {
                    const weekday = WEEKDAYS_BY_UTC_DAY[new Date(`${day}T00:00:00Z`).getUTCDay()]
                    return (
                      <th key={day} className="text-center text-[12px] font-bold leading-4">
                        {day.slice(8, 10)}
                        <small className="block text-[11px] font-semibold lowercase" style={{ color: holidays.has(day) ? "rgba(255,94,94,.7)" : "#0D99FF" }}>
                          {t(weekday)}
                        </small>
                      </th>
                    )
                  })}
                  <th className="whitespace-nowrap pl-[25px] pr-[12px] text-right font-semibold">
                    <span className="inline-flex items-center gap-[4px]" title={t("Пришел вовремя / Опоздал (время опоздания) / Не пришел / Всего")}>
                      {t("Пришел вовремя")}
                      <Icon path={ICONS.info} color="#4f71dc" size={18} />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const userDays = entries.get(user.id)
                  return (
                    <tr key={user.id} className="h-[51px] border-b border-[#efefef] hover:bg-[#f9fbfd]">
                      <td className="text-center">
                        <input
                          type="checkbox"
                          checked={selected.includes(user.id)}
                          onChange={() => toggleRow(user.id)}
                          aria-label={user.name}
                          className="h-[18px] w-[18px] cursor-pointer accent-[#444]"
                        />
                      </td>
                      <td className="max-w-[208px] px-[6px]">
                        <button type="button" onClick={() => openDrawer(user.id, defaultDay())} title={user.position || user.name} className="block max-w-full truncate text-left text-[13px] hover:text-[#0D99FF]">
                          {user.name}
                        </button>
                      </td>
                      {days.map((day) => (
                        <DayCell key={day} date={day} entry={userDays?.get(day)} holiday={holidays.has(day)} onOpen={() => openDrawer(user.id, day)} />
                      ))}
                      <td className="whitespace-nowrap pl-[25px] pr-[12px] text-right">
                        <b className="text-[#71ce87]">{cameCount(user.counts)}</b>
                        {" / "}
                        <span className="text-[rgb(79,113,220)]">
                          {user.counts.late}
                          {user.totalLateMinutes > 0 ? ` (${formatLate(user.totalLateMinutes)})` : ""}
                        </span>
                        {" / "}
                        <span className="text-[rgb(255,94,94)]">{user.counts.not_come}</span>
                        {" / "}
                        <span className="text-[#333]">{workingDays}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog === "weekend" && (
        <WeekendDialog
          initialYear={year}
          initialMonth={month}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: t("Сохранено"), tone: "success" })
            setReload((value) => value + 1)
          }}
        />
      )}
      {dialog === "workTime" && (
        <WorkTimeDialog
          initial={current?.lateAfter ?? null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: t("Сохранено"), tone: "success" })
            setReload((value) => value + 1)
          }}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          year={year}
          month={month}
          onTemplate={exportRows}
          onClose={() => setDialog(null)}
          onImported={(result) => {
            setDialog(null)
            setSelected([])
            setNotice({ text: `${t("Импорт выполнен")}. ${t("Изменено дней")}: ${result.updated}`, tone: "success" })
            setReload((value) => value + 1)
          }}
        />
      )}
      {dialog === "edit" && (
        <EditDialog
          employeeIds={selected}
          lateAfter={current?.lateAfter ?? "09:00"}
          maxDate={today}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setSelected([])
            setNotice({ text: t("Сохранено"), tone: "success" })
            setReload((value) => value + 1)
          }}
        />
      )}
      {dialog === "recalc" && (
        <ConfirmDialog
          title={t("Перерасчет")}
          text={`${t("Пересчитать посещаемость за")} ${t(MONTH_KEYS[month - 1])} ${year}? ${t("Изменения, внесенные вручную, сохранятся.")}`}
          confirmLabel="Перерасчет"
          tone="blue"
          busy={recalcBusy}
          error={recalcError ? t(recalcError) : ""}
          onConfirm={() => void recalc()}
          onClose={() => {
            setDialog(null)
            setRecalcError("")
          }}
        />
      )}
      {drawerId && drawerDate && (
        <AttendanceDayDrawer
          employeeId={drawerId}
          date={drawerDate}
          onDate={(day) => setParams({ date: day })}
          onClose={() => setParams({ id: null, date: null })}
        />
      )}
      {notice && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-[1200] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-md px-5 py-3 text-[14px] font-medium text-white shadow-lg ${notice.tone === "success" ? "bg-[#323232]" : "bg-[#c94b4b]"}`}
        >
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} aria-label={t("Закрыть")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </ReportPage>
  )
}
