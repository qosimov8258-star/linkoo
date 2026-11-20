"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, X } from "lucide-react"

import { DayCell, ICONS, Icon } from "@/components/analytics/attendance-cells"
import { EditDialog, FilterPanel, ImportDialog, MONTH_KEYS, Stepper, WeekendDialog, WorkTimeDialog, callApi } from "@/components/analytics/attendance-dialogs"
import { ErrorBlock, useCanManage } from "@/components/analytics/cash-management-shared"
import { RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { ReportEmpty, ReportPage } from "@/components/ref/report-kit"
import { AgentVisitDrawer } from "@/components/tracking/agent-visit-drawer"
import { cameCount, cameFlag, monthDays, type AttendanceDay, type AttendanceMonth } from "@/lib/attendance-types"
import { downloadExcelTable } from "@/lib/excel-export"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Посещаемость (/analytics/work-attendance, Linko #/attendance/): one row per active employee, one
// column per day of the month (icons by day type), the "Пришел вовремя" totals, and the actions
// Добавить выходные дни / Рабочее время / Обновить с excel / Скачать / Изменить / Перерасчет.
// URL state as Linko's: year, month, search, branch (ids joined by "-"), ordering (the «Агент» sort),
// select (ticked agents, "-"), date + id (the agent's day drawer). Data: GET /api/work-attendance.

const WEEKDAYS_BY_UTC_DAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
const MANAGE = ["settings.manage"] as const
const SORT_KEY = "first_name"

type Notice = { text: string; tone: "success" | "error" }

function numberParam(value: string | null, min: number, max: number): number | null {
  if (!value || !/^\d{1,4}$/.test(value)) return null
  const number = Number(value)
  return number >= min && number <= max ? number : null
}

/** Ids of a URL list: Linko joins them with "-" (older links of this page used ","). */
function idsParam(value: string | null): number[] {
  return [...new Set(String(value ?? "").split(/[-,]/).map((part) => numberParam(part.trim(), 1, 2_147_483_647)).filter((id): id is number => id !== null))]
}

function dotDate(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

const SEARCH_ICON = "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
const SORT_DOWN = "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"
const SORT_UP = "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"
const EDIT_LINE = "M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z"
const CLEAR = "M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"

/** Linko's search of the page: a 250px Material text field whose «Поиск» label floats up, the
 * magnifier button over its right end. */
function SearchField({ value, onChange, onSubmit }: { value: string; onChange: (value: string) => void; onSubmit: () => void }) {
  const { t } = useLanguage()
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <form
      role="search"
      className="relative flex w-[250px] items-center"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="relative mt-[7px] h-[45px] w-full">
        <span className={`pointer-events-none absolute left-0 text-black transition-all ${floating ? "top-[-1px] text-[10px] font-semibold leading-[15px]" : "top-[13px] text-[13px] font-semibold leading-[18px]"}`}>{t("Поиск")}</span>
        <input
          value={value}
          maxLength={100}
          aria-label={t("Поиск")}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-[45px] w-full bg-transparent pr-[40px] pt-[16px] text-[13px] font-semibold text-black outline-none"
        />
        <span className={`pointer-events-none absolute inset-x-0 top-[36px] ${focused ? "h-[2px] bg-[#5d6474]" : "h-px bg-[#e0e0e0]"}`} />
      </div>
      <button type="submit" aria-label={t("Поиск")} className="-mb-[10px] -ml-[40px] flex h-[40px] w-[40px] shrink-0 items-center justify-center">
        <Icon path={SEARCH_ICON} color="#5d6474" size={22} />
      </button>
    </form>
  )
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
  const orderingParam = searchParams.get("ordering") ?? ""
  const ordering = orderingParam === SORT_KEY || orderingParam === `-${SORT_KEY}` ? orderingParam : ""
  const selectParam = searchParams.get("select") ?? ""
  const selected = useMemo(() => idsParam(selectParam), [selectParam])
  const drawerId = numberParam(searchParams.get("id"), 1, 2_147_483_647)
  const drawerDateRaw = searchParams.get("date") ?? ""
  const drawerDate = /^\d{4}-\d{2}-\d{2}$/.test(drawerDateRaw) ? drawerDateRaw : null

  const canManage = useCanManage(MANAGE)
  const [query, setQuery] = useState(search)
  const [data, setData] = useState<{ key: string; month: AttendanceMonth | null; error: string } | null>(null)
  const [reload, setReload] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [dialog, setDialog] = useState<"weekend" | "workTime" | "import" | "edit" | null>(null)
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([])
  const [shop, setShop] = useState<number | null>(null)

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

  const requestKey = `${year}-${month}|${search}|${branchIds.join(",")}|${ordering}|${reload}`
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ year: String(year), month: String(month) })
    if (search) params.set("search", search)
    if (branchIds.length) params.set("branch", branchIds.join(","))
    if (ordering) params.set("ordering", ordering)
    void callApi<AttendanceMonth>(`/api/work-attendance?${params}`).then((result) => {
      if (cancelled) return
      setData({ key: requestKey, month: result.ok ? result.data : null, error: result.ok ? "" : result.error })
    })
    return () => {
      cancelled = true
    }
  }, [year, month, search, branchIds, ordering, requestKey])

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

  const setSelected = (ids: number[]) => setParams({ select: ids.length ? ids.join("-") : null })
  const toggleRow = (id: number) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])
  const toggleAll = () => setSelected(allSelected ? selected.filter((id) => !visibleIds.includes(id)) : [...new Set([...selected, ...visibleIds])])

  const goMonth = (offset: number) => {
    const index = year * 12 + (month - 1) + offset
    const nextYear = Math.floor(index / 12)
    if (nextYear < 2000 || nextYear > 2100) return
    setParams({ year: String(nextYear), month: String((index % 12) + 1) })
  }
  const goYear = (offset: number) => {
    const nextYear = year + offset
    if (nextYear < 2000 || nextYear > 2100) return
    setParams({ year: String(nextYear) })
  }
  // Linko's «Агент» header: none → first name A–Z → Z–A → none.
  const toggleSort = () => setParams({ ordering: ordering === SORT_KEY ? `-${SORT_KEY}` : ordering === `-${SORT_KEY}` ? null : SORT_KEY })

  const openDrawer = (id: number, day: string) => {
    setShop(null)
    setParams({ id: String(id), date: day })
  }

  // Linko's «Скачать» (its API 147 has no «Должность» column): Агент, the days (1 = came: on time or late), the totals.
  function exportRows() {
    const header = [t("Агент"), ...days.map(dotDate), t("Вовремя"), t("Опоздал"), t("Не пришел"), t("Всего")]
    const rows = users.map((user) => [
      user.name,
      ...days.map((day) => String(cameFlag(entries.get(user.id)?.get(day)?.type))),
      user.counts.on_time,
      user.counts.late,
      user.counts.not_come,
      workingDays,
    ])
    downloadExcelTable(t("Посещаемость"), [header, ...rows])
  }

  // Linko recalculates at once (no confirmation); the button reads «Загрузка ...» meanwhile.
  async function recalc() {
    if (recalcBusy) return
    setRecalcBusy(true)
    const result = await callApi<{ recalculated: number }>("/api/work-attendance/recalc", { method: "POST", body: JSON.stringify({ year, month }) })
    setRecalcBusy(false)
    if (!result.ok) return setNotice({ text: t(result.error), tone: "error" })
    setNotice({ text: t("Перерасчет выполнен"), tone: "success" })
    setReload((value) => value + 1)
  }

  const filterCount = branchIds.length ? 1 : 0
  const nothingSelected = selected.length === 0

  return (
    <ReportPage>
      <div className="px-4 sm:pl-[30px] sm:pr-[38px]">
        <RefHeader title={t("Посещаемость")}>
          <div className="flex flex-wrap items-center justify-end gap-[10px]">
            {canManage && <RefButton icon={RI.add} green label={t("Добавить выходные дни")} onClick={() => setDialog("weekend")} />}
            {canManage && <RefButton icon={RI.clock} label={t("Рабочее время")} onClick={() => setDialog("workTime")} />}
            {canManage && <RefButton icon={RI.sync} label={t("Обновить с excel")} onClick={() => setDialog("import")} />}
            <RefButton icon={RI.chart} green label={t("Скачать")} disabled={loading || !users.length} onClick={exportRows} />
          </div>
        </RefHeader>
      </div>

      <section className="relative mx-4 rounded-[10px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] sm:mx-7">
        {canManage && (
          <div className="flex h-[53px] items-center justify-end gap-[18px] border-b border-[#efefef] px-[10px] pr-[18px]">
            <RefTip text={nothingSelected ? t("Хотя бы выберете одного агента !") : ""} side="left">
              <span className={nothingSelected ? "[&_button]:cursor-default [&_button]:hover:brightness-100" : ""}>
                <RefButton icon={RI.edit} label={t("Изменить")} onClick={() => !nothingSelected && setDialog("edit")} />
              </span>
            </RefTip>
            <RefButton icon={RI.sync} label={recalcBusy ? t("Загрузка ...") : t("Перерасчет")} disabled={recalcBusy} onClick={() => void recalc()} />
          </div>
        )}
        <div className="flex min-h-[53px] flex-wrap items-center justify-between gap-y-[8px] border-b border-[#efefef] pl-[15px]">
          <div className="flex flex-wrap items-center">
            <div className="relative mr-[20px] w-[250px]">
              {filterCount > 0 && !filterOpen ? (
                <div className="relative -ml-[15px] flex h-[53px] w-[260px] items-center bg-[#efefef] px-[30px] text-[13px] text-[#666]">
                  <span>
                    {t("Фильтр")}: {filterCount} {t("элемента")}
                  </span>
                  <div className="absolute right-0 top-[3px] flex">
                    <button type="button" onClick={() => setFilterOpen(true)} aria-label={t("Изменить фильтр")} className="relative flex h-[48px] w-[48px] items-center justify-center rounded-[5px] border-l border-white">
                      <Icon path={EDIT_LINE} color="#8f8f8f" size={24} />
                      <span className="absolute bottom-[10px] h-[4px] w-[24px] bg-[#c8c8c8]" />
                    </button>
                    <button type="button" onClick={() => setParams({ branch: null })} aria-label={t("Очистить фильтр")} className="flex h-[48px] w-[48px] items-center justify-center rounded-[5px] border-l border-white">
                      <Icon path={CLEAR} color="#8f8f8f" size={24} />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setFilterOpen(true)}
                  className="flex h-[30px] items-center rounded-[5px] bg-[#1E4A9A] pl-3 pr-4 text-[13px] font-semibold text-white hover:brightness-95"
                >
                  <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden>
                    <path d={RI.filter} />
                  </svg>
                  {t("Показать фильтр")}
                </button>
              )}
              {filterOpen && (
                <FilterPanel
                  branches={branches}
                  value={branchIds}
                  onClose={() => setFilterOpen(false)}
                  onApply={(ids) => {
                    setFilterOpen(false)
                    setParams({ branch: ids.length ? ids.join("-") : null })
                  }}
                />
              )}
            </div>
            <SearchField value={query} onChange={setQuery} onSubmit={() => setParams({ search: query.trim() || null })} />
          </div>
          <div className="flex w-[500px] max-w-full flex-wrap">
            <Stepper label={year} onPrev={() => goYear(-1)} onNext={() => goYear(1)} prevLabel="Предыдущий год" nextLabel="Следующий год" prevDisabled={year <= 2000} nextDisabled={year >= 2100} />
            <Stepper label={t(MONTH_KEYS[month - 1])} onPrev={() => goMonth(-1)} onNext={() => goMonth(1)} prevLabel="Предыдущий месяц" nextLabel="Следующий месяц" />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#1E4A9A]" />
          </div>
        ) : data?.error ? (
          <ErrorBlock error={data.error} onRetry={() => setReload((value) => value + 1)} />
        ) : !users.length ? (
          <ReportEmpty text={`${t("По вашему запросу ничего не найдено")}...`} />
        ) : (
          <div className="overflow-x-auto">
            {/* Linko's auto-sized table: 17.5px cell padding, 5px around the day icons. */}
            <table data-no-sort className="w-full border-collapse text-[13px] text-[#333]">
              <thead className="bg-[rgb(240,244,249)] text-[13px] font-semibold text-[rgb(55,69,87)]">
                <tr className="h-[55px]">
                  <th className="px-[17.5px] py-[7.8px] text-left">
                    <button type="button" aria-label={t("Выбрать всех")} title={t("Выбрать всех")} onClick={toggleAll} className="flex h-[24px] w-[52px] items-center">
                      <Icon path={allSelected ? ICONS.checked : ICONS.selectAll} color="#333" size={24} />
                    </button>
                  </th>
                  <th className="px-[17.5px] py-[7.8px] text-left font-semibold">
                    <button type="button" onClick={toggleSort} className="flex h-full items-center gap-[5px] font-semibold">
                      {t("Агент")}
                      {ordering && <Icon path={ordering === SORT_KEY ? SORT_DOWN : SORT_UP} color="#374557" size={15} />}
                    </button>
                  </th>
                  {days.map((day) => {
                    const weekday = WEEKDAYS_BY_UTC_DAY[new Date(`${day}T00:00:00Z`).getUTCDay()]
                    return (
                      <th key={day} className="px-[5px] py-[7.8px] font-semibold">
                        <div className="flex flex-col items-center leading-5">
                          <div>{day.slice(8, 10)}</div>
                          <div style={{ color: holidays.has(day) ? "rgba(255,94,94,.7)" : "#0D99FF" }}>{t(weekday)}</div>
                        </div>
                      </th>
                    )
                  })}
                  <th className="whitespace-nowrap px-[17.5px] py-[7.8px] font-semibold">
                    <div className="flex items-center justify-center">
                      {t("Пришел вовремя")}
                      <RefTip text={t("Пришел вовремя / Опоздал (время опоздания) / Не пришел / Всего")} side="right">
                        <span className="-mt-[2px] ml-[3px] flex">
                          <Icon path={ICONS.info} color="rgb(79,113,220)" size={24} />
                        </span>
                      </RefTip>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const userDays = entries.get(user.id)
                  const checked = selected.includes(user.id)
                  return (
                    <tr key={user.id} className="h-[51px] border-b border-[#efefef]">
                      <td className="px-[17.5px] py-[7.8px]">
                        <button type="button" role="checkbox" aria-checked={checked} aria-label={user.name} onClick={() => toggleRow(user.id)} className="flex h-[24px] w-[52px] items-center">
                          <Icon path={checked ? ICONS.checked : ICONS.blank} color="#333" size={24} />
                        </button>
                      </td>
                      {/* Linko's name cell only lights up under the pointer; the day cells open the agent's day. */}
                      <td className="cursor-pointer px-[17.5px] py-[7.8px] hover:text-[#0D99FF]">{user.name}</td>
                      {days.map((day) => (
                        <DayCell key={day} date={day} entry={userDays?.get(day)} holiday={holidays.has(day)} onOpen={() => openDrawer(user.id, day)} />
                      ))}
                      <td className="px-[17.5px] py-[7.8px]">
                        <div className="flex flex-nowrap items-center whitespace-nowrap py-[7.8px] pl-[25px] pr-[7px]">
                          <span className="font-semibold text-[#71ce87]">{cameCount(user.counts)}</span>
                          &nbsp;/&nbsp;
                          <span className="text-[rgb(79,113,220)]">{user.counts.late}</span>
                          &nbsp;/&nbsp;
                          <span className="text-[rgb(255,94,94)]">{user.counts.not_come}</span>
                          &nbsp;/&nbsp;
                          <span>{workingDays}</span>
                        </div>
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
          initialYear={Number(today.slice(0, 4))}
          initialMonth={Number(today.slice(5, 7))}
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
          maxDate={today}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: t("Сохранено"), tone: "success" })
            setReload((value) => value + 1)
          }}
        />
      )}
      {drawerId && drawerDate && (
        <AgentVisitDrawer
          employeeId={drawerId}
          date={drawerDate}
          shop={shop}
          width={800}
          onClose={() => {
            setShop(null)
            setParams({ id: null, date: null })
          }}
          onDayChange={(day) => setParams({ date: day })}
          onOpenShop={setShop}
          onCloseShop={() => setShop(null)}
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
