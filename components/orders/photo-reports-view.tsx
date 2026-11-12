"use client"

import { Check, Download, Filter, Minus, Search, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { FilterCardOptionSelect } from "@/components/analytics/balance/filter-bar"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"
import { csvText } from "@/lib/csv"
import {
  PHOTO_REPORT_STATUSES,
  type FieldRecordFacets,
  type FieldRecordPage,
  type FieldRecordRow,
  type PhotoReportReview,
  type PhotoReportStatus,
} from "@/lib/field-activity/record-list-types"
import type { FieldPhoto } from "@/lib/field-activity/types"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Фотоотчеты" (Продажи): the photo reports the agents send from the mobile app with their
// before / after photos — the field data of Активность / Отслеживание (lib/field-activity,
// GET /api/field-activity/photo-reports). The filter card is the reference's: Дата создания, Супервайзер, Создал,
// Бренд, Категория фотоотчета, Филиалы, Категория канала, Тип клиента, Магазин, ИНН магазина, Магазин с
// оборудованием — every one applied on the server (Бренд stays disabled: a report records no products here);
// a field employee sees their own reports. Принять / Отклонить set the
// review status (PATCH …/photo-reports/[id]/status, clients.manage); clicking the shown state
// again sets it back to "Ожидает". A scoped reader's own reports (ownEmployeeId of the list) only
// show their state: an agent never reviews their own report.

const TABS = [
  ["Ожидает", "pending"],
  ["Не принят", "rejected"],
  ["Принят", "accepted"],
  ["Все", "all"],
] as const

const COLUMNS = 6
/** Reports per request ("Загрузить еще..." loads the next ones). */
const PAGE_SIZE = 60
/** Reports per request of the Excel export (it walks every page of the filter). */
const EXPORT_PAGE_SIZE = 500

const dotted = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "")

/** The current month in the business time zone (Asia/Tashkent). */
function currentMonth() {
  const today = todayIso()
  return { begin: monthStartIso(today), end: monthEndIso(today) }
}

type Period = { begin: string; end: string }
/** The card's choices: ids and names as the server takes them ("" = all). */
type CardFilters = {
  supervisorId: string
  employeeId: string
  category: string
  branch: string
  channel: string
  clientTypeId: string
  clientId: string
  inn: string
  withEquipment: "" | "true" | "false"
}
const NO_FILTERS: CardFilters = { supervisorId: "", employeeId: "", category: "", branch: "", channel: "", clientTypeId: "", clientId: "", inn: "", withEquipment: "" }

type Query = { period: Period; status: PhotoReportStatus | "all"; filters: CardFilters; search: string }

function queryParams(query: Query, before: string | null, pageSize: number): URLSearchParams {
  const params = new URLSearchParams({ pageSize: String(pageSize) })
  if (before) params.set("before", before)
  if (query.period.begin) params.set("from", query.period.begin)
  if (query.period.end) params.set("to", query.period.end)
  if (query.status !== "all") params.set("status", query.status)
  for (const [name, value] of Object.entries(query.filters)) if (value) params.set(name, value)
  if (query.search) params.set("q", query.search)
  return params
}

/** One page of the filter: the newest reports, or (`before`) the ones after the previous page's nextCursor. */
async function loadPage(query: Query, before: string | null, pageSize: number, facets: boolean, signal?: AbortSignal): Promise<FieldRecordPage> {
  const params = queryParams(query, before, pageSize)
  if (facets) params.set("facets", "true")
  const response = await fetch(`/api/field-activity/photo-reports?${params.toString()}`, { cache: "no-store", signal })
  const body = (await response.json().catch(() => null)) as (FieldRecordPage & { error?: string }) | null
  if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error || "Не удалось загрузить данные")
  return body
}

function PhotoSlot({ photo, badge, showBadge = true, t }: { photo?: FieldPhoto; badge: "до" | "после"; showBadge?: boolean; t: (key: string) => string }) {
  return (
    <div className="relative flex h-[200px] flex-1 items-center justify-center overflow-hidden rounded-[6px] border border-[#d9dde3] px-[6px] text-center text-[12px] leading-[14px] text-[#777]">
      {photo ? (
        <a href={photo.url} target="_blank" rel="noreferrer" className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={t(badge)} loading="lazy" className="h-full w-full object-cover" />
        </a>
      ) : (
        t("Изображение не найдено")
      )}
      {showBadge ? <span className="absolute left-[2px] top-[2px] rounded-full bg-[#555] px-[8px] py-[1px] text-[11px] font-semibold text-white">{t(badge)}</span> : null}
    </div>
  )
}

const isStatus = (value: unknown): value is PhotoReportStatus => (PHOTO_REPORT_STATUSES as readonly unknown[]).includes(value)

function Card({
  report,
  canReview,
  busy,
  onSet,
  t,
}: {
  report: FieldRecordRow
  /** False for a user without clients.manage, or for a scoped reader's own report: the buttons only show the state. */
  canReview: boolean
  busy: boolean
  onSet: (status: PhotoReportStatus) => void
  t: (key: string) => string
}) {
  const { language } = useLanguage()
  const before = report.photos.filter((photo) => photo.slot === "before")
  const after = report.photos.filter((photo) => photo.slot === "after")
  // Named photo groups (Polka, DMP, … of an imported report): the reference lists the group names in order and puts
  // the i-th before / after pair under the i-th name; names left over follow the last pair.
  const groups = report.photoTypes ?? []
  const groupBefore = groups.reduce((sum, group) => sum + group.before, 0)
  const groupAfter = groups.reduce((sum, group) => sum + group.after, 0)
  const pairs = Math.max(1, before.length, after.length, groupBefore, groupAfter)
  const rows = Math.max(pairs, groups.length)
  const locked = !canReview || busy
  return (
    <section className="mb-[20px] rounded-[2px] bg-white px-[10px] pb-[14px] pt-[12px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <h3 className="mb-[10px] text-center text-[15px] font-medium text-[#333]">{report.clientName || `#${report.clientId}`}</h3>
      <div className="flex items-start gap-[8px]">
        <button type="button" disabled={locked} aria-label={t("Принять")} aria-pressed={report.status === "accepted"} onClick={() => onSet("accepted")} className={`flex h-[32px] w-[32px] items-center justify-center rounded-[4px] ${report.status === "accepted" ? "bg-[#48a34b]" : "bg-[#7d7d7d]"} text-white ${canReview ? "disabled:opacity-60" : "cursor-default"}`}><Check className="h-[18px] w-[18px]" /></button>
        <div className="min-w-0 flex-1 text-center text-[12px] leading-[19px] text-[#777]">
          <div className="text-[14px] text-[#888]">{report.employeeName || `#${report.employeeId}`}</div>
          <div>{formatDateText(report.at, language, { withTime: true })}</div>
          {report.comment ? <div className="text-[#222]">{report.comment}</div> : null}
        </div>
        <button type="button" disabled={locked} aria-label={t("Отклонить")} aria-pressed={report.status === "rejected"} onClick={() => onSet("rejected")} className={`flex h-[32px] w-[32px] items-center justify-center rounded-[4px] ${report.status === "rejected" ? "bg-[#e57373]" : "bg-[#7d7d7d]"} text-white ${canReview ? "disabled:opacity-60" : "cursor-default"}`}><Minus className="h-[18px] w-[18px]" /></button>
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="mt-[6px]">
          {groups[index] ? <div className="text-center text-[12px] leading-[19px] text-[#777]">{groups[index].name}</div> : null}
          {index < pairs ? (
            <div className="mt-[8px] flex gap-[11px]">
              <PhotoSlot photo={before[index]} badge="до" showBadge={!groups.length || index === 0} t={t} />
              <PhotoSlot photo={after[index]} badge="после" showBadge={!groups.length || index === 0} t={t} />
            </div>
          ) : null}
        </div>
      ))}
    </section>
  )
}

export function PhotoReportsView() {
  const { t, language } = useLanguage()
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("Все")
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [period, setPeriod] = useState<Period>(currentMonth)
  const [draft, setDraft] = useState<Period>(period)
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS)
  const [draftFilters, setDraftFilters] = useState<CardFilters>(NO_FILTERS)
  const setDraftField = (name: keyof CardFilters) => (value: string) => setDraftFilters((current) => ({ ...current, [name]: value }))
  const [rows, setRows] = useState<FieldRecordRow[]>([])
  const [count, setCount] = useState(0)
  // Keyset paging: "Загрузить еще..." asks for the reports after the previous page's nextCursor
  // (of that same filter), so reports that arrive meanwhile cannot shift the pages.
  const [more, setMore] = useState<{ query: Query; cursor: string } | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [facets, setFacets] = useState<FieldRecordFacets | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const canReview = useCanManage(["clients.manage"])
  // The reader's own employee for a narrow field scope (its reports are not reviewable), else null.
  const [ownEmployeeId, setOwnEmployeeId] = useState<number | null>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set())
  const busyRef = useRef(new Set<number>())

  // The search goes to the server (it spans every page), a moment after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const status = TABS.find(([label]) => label === tab)?.[1] ?? "all"
  const current = useMemo<Query>(() => ({ period, status, filters, search }), [period, status, filters, search])
  // A new filter (or search) starts again from its newest reports.
  const cursor = more && more.query === current ? more.cursor : null
  // The filter options come with the first answer only (a later filter change does not ask again).
  const facetsLoaded = useRef(false)

  // A new filter starts again from its first page; "Загрузить еще..." appends the next one.
  useEffect(() => {
    const controller = new AbortController()
    const needFacets = !facetsLoaded.current
    setLoading(true)
    loadPage(current, cursor, PAGE_SIZE, needFacets, controller.signal)
      .then((body) => {
        setRows((previous) => {
          if (!cursor) return body.rows
          const known = new Set(previous.map((row) => row.id))
          return [...previous, ...body.rows.filter((row) => !known.has(row.id))]
        })
        setCount(body.count)
        setNextCursor(body.hasMore ? body.nextCursor : null)
        setOwnEmployeeId(typeof body.ownEmployeeId === "number" ? body.ownEmployeeId : null)
        if (body.facets) {
          facetsLoaded.current = true
          setFacets(body.facets)
        }
        setLoading(false)
      })
      .catch((cause: Error) => {
        if (cause.name === "AbortError") return
        if (!cursor) {
          setRows([])
          setCount(0)
          setNextCursor(null)
        }
        if (needFacets) setFacets((value) => value ?? { employees: [], clients: [], refusalTypes: [] })
        setLoading(false)
        notify(t(cause.message || "Не удалось загрузить данные"))
      })
    return () => controller.abort()
    // `t` only translates the error text; a language switch must not reload the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, cursor])

  const columns = useMemo(() => {
    const result: FieldRecordRow[][] = Array.from({ length: COLUMNS }, () => [])
    rows.forEach((row, index) => result[index % COLUMNS].push(row))
    return result
  }, [rows])
  const activeFilters = 1 + Object.values(filters).filter(Boolean).length

  const changeFilter = useCallback((apply: () => void) => {
    apply()
    setMore(null)
  }, [])

  // The list a review answer lands in: the filter (or the loaded cards) may change while it is saved.
  const shown = useRef({ query: current, rows })
  useEffect(() => {
    shown.current = { query: current, rows }
  }, [current, rows])

  /** The report's new status: patched in place, or dropped from a tab it no longer belongs to
   * (as the tabs filter by status). Nothing when another filter's list has been loaded since. */
  function showStatus(id: number, next: PhotoReportStatus, asked: Query) {
    if (shown.current.query !== asked || !shown.current.rows.some((row) => row.id === id)) return
    if (asked.status !== "all" && next !== asked.status) {
      setRows((previous) => previous.filter((row) => row.id !== id))
      setCount((value) => Math.max(0, value - 1))
    } else {
      setRows((previous) => previous.map((row) => (row.id === id ? { ...row, status: next } : row)))
    }
  }

  /** Принять / Отклонить; the shown state clicked again goes back to "Ожидает" (pending). */
  async function review(report: FieldRecordRow, pressed: PhotoReportStatus) {
    if (!canReview || report.employeeId === ownEmployeeId || busyRef.current.has(report.id)) return
    busyRef.current.add(report.id)
    setBusyIds(new Set(busyRef.current))
    const target: PhotoReportStatus = report.status === pressed ? "pending" : pressed
    const asked = current
    try {
      const response = await fetch(`/api/field-activity/photo-reports/${report.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, ...(isStatus(report.status) ? { from: report.status } : {}) }),
      })
      const body = (await response.json().catch(() => null)) as (Partial<PhotoReportReview> & { error?: string; status?: unknown }) | null
      if (response.status === 409 && isStatus(body?.status)) {
        // Someone else reviewed it meanwhile: show their status instead of overriding it.
        notify(t(body?.error || "Статус фотоотчета уже изменен"))
        showStatus(report.id, body.status, asked)
        return
      }
      if (!response.ok || !isStatus(body?.status)) throw new Error(body?.error || "Не удалось сохранить")
      showStatus(report.id, body.status, asked)
    } catch (cause) {
      notify(t((cause as Error).message || "Не удалось сохранить"))
    } finally {
      busyRef.current.delete(report.id)
      setBusyIds(new Set(busyRef.current))
    }
  }

  function applyFilter() {
    if (draft.begin && draft.end && draft.begin > draft.end) {
      notify(t("Дата начала позже даты окончания"))
      return
    }
    changeFilter(() => {
      setPeriod(draft)
      setFilters(draftFilters)
    })
    setFilterOpen(false)
  }

  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      // Every report of the filter, not only the loaded cards.
      const all: FieldRecordRow[] = []
      for (let before: string | null = null; ; ) {
        const body = await loadPage(current, before, EXPORT_PAGE_SIZE, false)
        all.push(...body.rows)
        if (!body.hasMore || !body.nextCursor || !body.rows.length) break
        before = body.nextCursor
      }
      const statusLabel = (value: string) => t(TABS.find(([, code]) => code === value)?.[0] ?? value)
      const csv = csvText([
        [t("Магазин"), t("Создал"), t("Дата"), t("Комментарий"), t("Статус")],
        ...all.map((row) => [row.clientName, row.employeeName, formatDateText(row.at, language, { withTime: true }), row.comment, statusLabel(row.status)]),
      ])
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
      const link = document.createElement("a")
      link.href = url
      link.download = "fotootchety.csv"
      link.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      notify(t((cause as Error).message || "Не удалось загрузить данные"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <RefPage>
      <RefHeader title={t("Фотоотчеты")}>
        <button onClick={() => void exportCsv()} disabled={exporting} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60"><Download className="h-4 w-4" />{t("Скачать Excel")}</button>
      </RefHeader>
      <section className="overflow-hidden bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <RefTabs labels={TABS.map(([label]) => label)} value={tab} onChange={(value) => changeFilter(() => setTab(value as typeof tab))} />
        <div className="flex h-[50px] items-center gap-5 px-[10px]">
          <button onClick={() => { setDraft(period); setDraftFilters(filters); setFilterOpen(true) }} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Filter className="h-4 w-4" />{t("Фильтр")} / {activeFilters}</button>
          <span className="text-[12px] font-bold text-[#1E4A9A]">{dotted(period.begin)} - {dotted(period.end)}</span>
          <div className="relative mx-auto w-[260px]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-[#d0d0d0] py-1 text-[13px] font-semibold outline-none placeholder:text-black" /><Search className="absolute right-1 top-1 hidden h-4 w-4 text-slate-400" /></div>
          <span className="text-[13px]">{t("Фотоотчеты")}: <b className="text-[16px] font-medium">{count} {t("шт")}</b></span>
        </div>
      </section>
      <div className="mt-[10px] grid gap-[22px]" style={{ gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))` }}>
        {columns.map((column, index) => (
          <div key={index}>
            {column.map((report) => (
              <Card key={report.id} report={report} canReview={canReview && report.employeeId !== ownEmployeeId} busy={busyIds.has(report.id)} onSet={(pressed) => void review(report, pressed)} t={t} />
            ))}
          </div>
        ))}
      </div>
      {!loading && rows.length === 0 && <div className="py-16 text-center text-[13px] text-[#666]">{t("Ничего не найдено")}</div>}
      {loading && <div className="py-6 text-center text-[13px] text-[#666]">{t("Загрузка...")}</div>}
      {!loading && nextCursor && (
        <button type="button" onClick={() => setMore({ query: current, cursor: nextCursor })} className="mx-auto mb-6 block h-[30px] rounded-[5px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white hover:brightness-95">
          {t("Загрузить еще...")}
        </button>
      )}
      {filterOpen && (
        // The reference's card: four columns, the label inside each select, a full-width green «Применить».
        <div className="fixed inset-x-0 bottom-0 top-[50px] z-[100] overflow-y-auto bg-black/10" onClick={() => setFilterOpen(false)}>
          <section className="mx-[30px] mt-[117px] bg-white p-[30px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="text-[13px] font-semibold text-[#333]">{t("Фильтр")}</h2>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label={t("Закрыть")} className="text-[#333]"><X className="h-6 w-6" /></button>
            </div>
            <div className="mt-[22px] grid grid-cols-1 gap-x-[22px] gap-y-[18px] px-[20px] md:grid-cols-4">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-black">{t("Дата создания")}</span>
                <div className="flex h-[26px] items-center gap-1 border-b border-[#d5dae1] text-[13px]">
                  <input type="date" min="2000-01-01" max="2100-12-31" value={draft.begin} onChange={(event) => setDraft((value) => ({ ...value, begin: event.target.value }))} className="min-w-0 flex-1 bg-transparent outline-none" />
                  <span>-</span>
                  <input type="date" min="2000-01-01" max="2100-12-31" value={draft.end} onChange={(event) => setDraft((value) => ({ ...value, end: event.target.value }))} className="min-w-0 flex-1 bg-transparent outline-none" />
                </div>
              </div>
              <FilterCardOptionSelect label={t("Супервайзер")} value={draftFilters.supervisorId} onChange={setDraftField("supervisorId")} options={(facets?.supervisors ?? []).map((item) => ({ value: String(item.id), label: item.name }))} />
              <FilterCardOptionSelect label={t("Создал")} value={draftFilters.employeeId} onChange={setDraftField("employeeId")} options={(facets?.employees ?? []).map((item) => ({ value: String(item.id), label: item.name }))} />
              {/* A photo report records no products here, so there is no brand to filter by. */}
              <FilterCardOptionSelect label={t("Бренд")} value="" onChange={() => undefined} options={(facets?.brands ?? []).map((name) => ({ value: name, label: name }))} disabled />
              <FilterCardOptionSelect label={t("Категория фотоотчета")} value={draftFilters.category} onChange={setDraftField("category")} options={(facets?.categories ?? []).map((name) => ({ value: name, label: name }))} />
              <FilterCardOptionSelect label={t("Филиалы")} value={draftFilters.branch} onChange={setDraftField("branch")} options={(facets?.branches ?? []).map((name) => ({ value: name, label: name }))} />
              <FilterCardOptionSelect label={t("Категория канала")} value={draftFilters.channel} onChange={setDraftField("channel")} options={(facets?.channels ?? []).map((name) => ({ value: name, label: name }))} />
              <FilterCardOptionSelect label={t("Тип клиента")} value={draftFilters.clientTypeId} onChange={setDraftField("clientTypeId")} options={(facets?.clientTypes ?? []).map((item) => ({ value: String(item.id), label: item.name }))} />
              <FilterCardOptionSelect label={t("Магазин")} value={draftFilters.clientId} onChange={setDraftField("clientId")} options={(facets?.clients ?? []).map((item) => ({ value: String(item.id), label: item.name }))} />
              <FilterCardOptionSelect label={t("ИНН магазина")} value={draftFilters.inn} onChange={setDraftField("inn")} options={(facets?.inns ?? []).map((inn) => ({ value: inn, label: inn }))} />
              <FilterCardOptionSelect
                label={t("Магазин с оборудованием")}
                value={draftFilters.withEquipment}
                onChange={(value) => setDraftFilters((current) => ({ ...current, withEquipment: value === "true" || value === "false" ? value : "" }))}
                options={[
                  { value: "true", label: t("Да") },
                  { value: "false", label: t("Нет") },
                ]}
              />
            </div>
            <button type="button" onClick={applyFilter} className="mt-[22px] h-9 w-full rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white">{t("Применить")}</button>
          </section>
        </div>
      )}
    </RefPage>
  )
}
