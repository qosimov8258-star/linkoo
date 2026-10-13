"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, ChevronsUpDown, ChevronUp, Copy, ListChecks, ListX, Pencil, RefreshCw, Search, X } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { BranchKpiDetailPanel } from "@/components/analytics/branch-kpi-detail"
import { BranchKpiBulkDialog, BranchKpiDuplicateDialog, BranchKpiLevelsDialog } from "@/components/analytics/branch-kpi-dialogs"
import { BRANCH_KPI_API, fetchJson, formatKpiDate, KPI_COLORS, KpiMonthYearFilter, kpiNumber, sendJson } from "@/components/analytics/branch-kpi-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import type { BranchKpiListResult, BranchKpiRecalcResult } from "@/lib/branch-kpi-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "KPI план филиалов" (demo #/staff-branch/?month&year, chunk 126): every branch
// with its KPI plans of the month ("name: plan" chips) and the month's bonus
// total; row → detail (plan / fact / level / bonus per KPI, Excel);
// "Изменить планы" (selected branches × KPI grid), "Дублировать" (copy plans to
// another month), "Перерасчет KPI" (recalculate the month, "ДАННЫЕ ЗА <date>").
// The list state lives in the URL query like the demo.

type Ordering = "" | "name" | "-name" | "salary" | "-salary"

type ViewState = {
  month: number
  year: number
  search: string
  ordering: Ordering
  page: number
  pageSize: number
  showCheckboxes: boolean
  /** Branch whose detail is open (demo /staff-branch/:id/). */
  id: number | null
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stateFromParams(params: URLSearchParams): ViewState {
  const now = new Date()
  const month = positiveInt(params.get("month"), now.getMonth() + 1)
  const year = positiveInt(params.get("year"), now.getFullYear())
  const ordering = params.get("ordering") ?? ""
  return {
    month: month <= 12 ? month : now.getMonth() + 1,
    year: year >= 2000 && year <= 2100 ? year : now.getFullYear(),
    search: params.get("search") ?? "",
    ordering: (["name", "-name", "salary", "-salary"].includes(ordering) ? ordering : "") as Ordering,
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
    showCheckboxes: params.get("showCheckboxes") === "true",
    id: positiveInt(params.get("id"), 0) || null,
  }
}

function stateToSearch(state: ViewState): string {
  const params = new URLSearchParams()
  params.set("month", String(state.month))
  params.set("pageSize", String(state.pageSize))
  params.set("year", String(state.year))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.showCheckboxes) params.set("showCheckboxes", "true")
  if (state.id) params.set("id", String(state.id))
  return params.toString()
}

function listQuery(state: ViewState): string {
  const params = new URLSearchParams({ month: String(state.month), year: String(state.year), page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  return params.toString()
}

type Dialog = { kind: "bulk" } | { kind: "duplicate" } | { kind: "levels"; indicatorId: number } | null

export function BranchKpiPlansView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [data, setData] = useState<BranchKpiListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)

  const query = useMemo(() => listQuery(state), [state])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetchJson<BranchKpiListResult>(`${BRANCH_KPI_API}?${query}`, { signal: controller.signal })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [query, version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])

  // The demo keeps the list state in the URL query.
  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    // Writes need manager (or admin), like the POST routes.
    fetchJson<{ role?: string }>("/api/auth/me")
      .then((me) => setCanEdit(me.role === "manager" || me.role === "admin"))
      .catch(() => setCanEdit(false))
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const rows = useMemo(() => data?.results ?? [], [data])
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.id)), [rows, selected])
  const pageIds = rows.map((row) => row.id)
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.includes(id))

  const recalc = async () => {
    setRecalculating(true)
    try {
      const result = await sendJson<BranchKpiRecalcResult>(`${BRANCH_KPI_API}/recalc`, "POST", { month: state.month, year: state.year })
      setNotice({ text: `${t("KPI пересчитан")}: ${result.branches}`, error: false })
      reload()
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? t(reason.message) : String(reason), error: true })
    } finally {
      setRecalculating(false)
    }
  }

  const toggleOrdering = (field: "name" | "salary") => {
    const next: Ordering = state.ordering === field ? `-${field}` : state.ordering === `-${field}` ? "" : field
    update({ ordering: next, page: 1 })
  }
  const orderingIcon = (field: "name" | "salary") => {
    if (state.ordering === field) return <ChevronUp className="h-4 w-4" />
    if (state.ordering === `-${field}`) return <ChevronDown className="h-4 w-4" />
    return <ChevronsUpDown className="h-4 w-4 opacity-50" />
  }

  const actionButtons = (
    <div className="flex items-center gap-2.5">
      <span title={selected.length ? undefined : t("Выберите хотя бы один сотрудник !")}>
        <button
          type="button"
          disabled={!selected.length || !canEdit}
          onClick={() => setDialog({ kind: "bulk" })}
          className="flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded px-3 text-[13px] font-semibold text-white"
          style={{ backgroundColor: selected.length && canEdit ? KPI_COLORS.blue : KPI_COLORS.disabled }}
        >
          <Pencil className="h-4 w-4" /> {t("Изменить планы")}
        </button>
      </span>
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setDialog({ kind: "duplicate" })}
        title={t("Дублировать")}
        aria-label={t("Дублировать")}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:opacity-40"
      >
        <Copy className="h-5 w-5" />
      </button>
    </div>
  )

  const pagination = (
    <BalancePagination
      page={state.page}
      pageSize={state.pageSize}
      count={data?.count ?? 0}
      onChange={({ page, pageSize }) => update({ page, pageSize })}
    />
  )

  const head = "border-b border-[#efefef] px-5 py-3 text-left font-semibold text-[#333]"
  const colSpan = state.showCheckboxes ? 4 : 3
  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("KPI план филиалов")}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {data?.lastDate && (
            <div className="font-semibold text-[#586174]">
              {t("ДАННЫЕ ЗА")} <span className="font-normal">{formatKpiDate(data.lastDate, language)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void recalc()}
            disabled={!canEdit || recalculating}
            className="flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded px-3 text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: KPI_COLORS.green }}
          >
            <RefreshCw className={`h-4 w-4 ${recalculating ? "animate-spin" : ""}`} />
            {t("Перерасчет KPI")}
          </button>
        </div>
      </header>

      {selected.length === 0 ? (
        <section className="flex min-h-[64px] flex-wrap items-end gap-x-6 gap-y-3 px-6 py-2 md:px-9">
          <KpiMonthYearFilter month={state.month} year={state.year} onChange={({ month, year }) => update({ month, year, page: 1 })} />
          <form
            className="flex min-w-[200px] flex-1 items-center justify-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              update({ search: searchDraft.trim(), page: 1 })
            }}
          >
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-10 w-full max-w-[260px] border-b border-[#dbe0e8] bg-transparent px-1 text-[15px] outline-none focus:border-[#4f70e7]"
            />
            <button type="submit" aria-label={t("Поиск")} className="p-1.5 text-[#ccc]">
              <Search className="h-5 w-5" />
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-3">
            {pagination}
            <button
              type="button"
              onClick={() => {
                if (state.showCheckboxes) setSelected([])
                update({ showCheckboxes: !state.showCheckboxes })
              }}
              title={state.showCheckboxes ? t("Спрятать флажки") : t("Выбрать из списка")}
              aria-label={state.showCheckboxes ? t("Спрятать флажки") : t("Выбрать из списка")}
              aria-pressed={state.showCheckboxes}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#5d6474] hover:bg-[#f2f5f8]"
            >
              {state.showCheckboxes ? <ListX className="h-5 w-5" /> : <ListChecks className="h-5 w-5" />}
            </button>
            {actionButtons}
          </div>
        </section>
      ) : (
        <section className="flex min-h-[64px] flex-wrap items-center gap-4 bg-[#f2f5f8] px-6 py-2 md:px-9">
          <strong className="text-[#333]">
            {t("Выбрано")}: {selected.length}
          </strong>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {pagination}
            {actionButtons}
            <button
              type="button"
              onClick={() => setSelected([])}
              title={t("Снять выделение")}
              aria-label={t("Снять выделение")}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </section>
      )}

      {error && (
        <div className="flex items-center gap-3 px-6 py-3 text-[#e57373] md:px-9">
          <span>
            {t("Не удалось загрузить данные")}: {t(error)}
          </span>
          <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <div className={`overflow-x-auto pb-10 ${loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[760px] border-collapse text-[14px] text-[#666]">
          <thead>
            <tr>
              {state.showCheckboxes && (
                <th className={`${head} w-12`}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setSelected((current) => (allChecked ? current.filter((id) => !pageIds.includes(id)) : [...new Set([...current, ...pageIds])]))}
                    aria-label={t("Выбрать все")}
                    className="h-4 w-4 accent-[#4f71dc]"
                  />
                </th>
              )}
              <th className={`${head} w-1/3`}>
                <button type="button" onClick={() => toggleOrdering("name")} className="inline-flex items-center gap-1">
                  {t("Филиал")} {orderingIcon("name")}
                </button>
              </th>
              <th className={`${head} w-1/6`}>
                <button type="button" onClick={() => toggleOrdering("salary")} className="inline-flex items-center gap-1">
                  {t("Сумма бонусов")} {orderingIcon("salary")}
                </button>
              </th>
              <th className={head}>KPI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const open = state.id === row.id
              return (
                <Fragment key={row.id}>
                  <tr
                    className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#f2f5f8]" : "hover:bg-[#f9fafc]"}`}
                    onClick={() => update({ id: open ? null : row.id })}
                  >
                    {state.showCheckboxes && (
                      <td className="px-5" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.includes(row.id)}
                          onChange={() => setSelected((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))}
                          aria-label={row.name}
                          className="h-4 w-4 accent-[#4f71dc]"
                        />
                      </td>
                    )}
                    <td className="px-5 py-2 font-semibold text-[#333]">{row.name}</td>
                    <td className="px-5 py-2">{kpiNumber(row.totalBonus)}</td>
                    <td className="px-5 py-1">
                      <div className="flex min-h-[50px] flex-wrap items-center">
                        {row.performanceIndicators.map((item) => (
                          <div key={item.id} className="my-[5px] mr-2.5 inline-flex h-7 items-center rounded-sm bg-[#e9ecef] px-2.5 leading-none">
                            {item.name}: <span className="ml-1 font-semibold text-[#4f71dc]">{kpiNumber(item.plan)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={colSpan} className="border-b-2 border-[#dbe0e8] p-0">
                        <BranchKpiDetailPanel
                          branchId={row.id}
                          month={state.month}
                          year={state.year}
                          version={version}
                          onClose={() => update({ id: null })}
                          onOpenIndicator={(indicatorId) => setDialog({ kind: "levels", indicatorId })}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={colSpan} className="px-5 py-10 text-center text-[#999]">
                  {t("Нет данных")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialog?.kind === "bulk" && (
        <BranchKpiBulkDialog
          month={state.month}
          year={state.year}
          branches={selectedRows}
          onPeriodChange={({ month, year }) => update({ month, year })}
          onClose={() => setDialog(null)}
          onSaved={(text) => {
            setDialog(null)
            setNotice({ text, error: false })
            reload()
          }}
        />
      )}
      {dialog?.kind === "duplicate" && (
        <BranchKpiDuplicateDialog
          month={state.month}
          year={state.year}
          selected={selected}
          onClose={() => setDialog(null)}
          onSaved={(text) => {
            setDialog(null)
            setNotice({ text, error: false })
            reload()
          }}
        />
      )}
      {dialog?.kind === "levels" && (
        <BranchKpiLevelsDialog
          indicatorId={dialog.indicatorId}
          month={state.month}
          year={state.year}
          canEdit={canEdit}
          onClose={() => setDialog(null)}
          onSaved={(text) => {
            setDialog(null)
            setNotice({ text, error: false })
            reload()
          }}
        />
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-[120] max-w-[90vw] -translate-x-1/2 rounded-md px-5 py-3 font-semibold text-white shadow-lg ${notice.error ? "bg-[#e57373]" : "bg-[#48a34b]"}`}
        >
          {notice.text}
        </div>
      )}
    </main>
  )
}
