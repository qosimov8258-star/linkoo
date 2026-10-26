"use client"

import { RefTip } from "@/components/ref/ref-tip"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

import { BranchKpiDetailPanel } from "@/components/analytics/branch-kpi-detail"
import { BranchKpiBulkDialog, BranchKpiDuplicateDialog, BranchKpiLevelsDialog } from "@/components/analytics/branch-kpi-dialogs"
import { BRANCH_KPI_API, fetchJson, formatKpiDate, KPI_COLORS, KpiMonthYearFilter, kpiNumber, sendJson } from "@/components/analytics/branch-kpi-shared"
import { ListBTable } from "@/components/analytics/list-b-table"
import { RI, RefCard, RefHeader, RefIconButton, RefPage, RefToolbar } from "@/components/ref/list-kit"
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

const COPY_ICON = "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
const CLEAR_SELECTION_ICON = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"
const EYE_OFF_ICON = "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"
const SELECT_ALL_ICON = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zM3 17h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"

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

  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data && data.count > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const to = data ? Math.min(data.count, state.page * state.pageSize) : 0
  const sortHead = (field: "name" | "salary", label: string) => (
    <button type="button" onClick={() => toggleOrdering(field)} className="text-left font-semibold hover:opacity-80">
      {label}
      {state.ordering === field ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${field}` ? <span className="ml-1 text-[10px]">▼</span> : null}
    </button>
  )
  const checkbox = (checked: boolean, onChange: () => void, label: string) => (
    <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="block h-[18px] w-[18px] accent-[#333]" />
  )
  const selecting = selected.length > 0
  const headCols = state.showCheckboxes ? "26px 463px 227px 1fr" : undefined
  // the reference lays the rows out narrower than the header bar in checkbox mode
  const cols = state.showCheckboxes ? "26px 449.3px 217.7px 1fr" : "469.3px 230.7px 1fr"

  return (
    <RefPage>
      <RefHeader title={t("KPI план филиалов")}>
        {data?.lastDate && (
          <div className="font-semibold text-[#333]">
            {t("ДАННЫЕ ЗА")} <span>{formatKpiDate(data.lastDate, language)}</span>
          </div>
        )}
        <div className={data?.lastDate ? "mr-[23px]" : "mr-[33px]"}>
          <button
            type="button"
            onClick={() => void recalc()}
            disabled={!canEdit || recalculating}
            className="flex h-[30px] items-center whitespace-nowrap rounded-[5px] px-4 text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: KPI_COLORS.green }}
          >
            {t("Перерасчет KPI")}
          </button>
        </div>
      </RefHeader>

      <RefCard className={selecting ? "" : "bg-white"}>
        <RefToolbar
          hideFilter
          hideSearch={selecting}
          plain={selecting}
          leftSlot={
            !selecting ? (
              <KpiMonthYearFilter month={state.month} year={state.year} onChange={({ month, year }) => update({ month, year, page: 1 })} />
            ) : (
              <strong className="font-semibold text-[#333]">
                {t("Выбрано")} : {selected.length}
              </strong>
            )
          }
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(pageSize) => update({ pageSize, page: 1 })}
          from={from}
          to={to}
          total={data?.count ?? 0}
          page={state.page}
          pageCount={pageCount}
          onPage={(page) => update({ page })}
          icons={
            selecting ? (
              <>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setDialog({ kind: "bulk" })}
                  className="flex h-[30px] items-center whitespace-nowrap rounded-[5px] pl-3 text-[13px] font-semibold text-white"
                  style={{ backgroundColor: KPI_COLORS.blue }}
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d={RI.edit} /></svg>
                  <span className="pl-2 pr-4">{t("Изменить планы")}</span>
                </button>
                <span className="ml-[18px] flex">
                  <RefIconButton path={COPY_ICON} label={t("Дублировать")} color="#333" onClick={() => canEdit && setDialog({ kind: "duplicate" })} />
                  <RefIconButton tipSide="left" path={CLEAR_SELECTION_ICON} label={t("Снять выделение")} color="#333" onClick={() => setSelected([])} />
                </span>
              </>
            ) : (
              <>
                <RefIconButton
                  tipSide="left"
                  path={state.showCheckboxes ? EYE_OFF_ICON : RI.checklist}
                  label={state.showCheckboxes ? t("Спрятать флажки") : t("Выбрать из списка")}
                  color="#5d6474"
                  onClick={() => {
                    if (state.showCheckboxes) setSelected([])
                    update({ showCheckboxes: !state.showCheckboxes })
                  }}
                />
                <RefTip text={t("Выберите хотя бы один сотрудник !")} side="left" gap={12.5}>
                  <button
                    type="button"
                    disabled
                    className="flex h-[30px] items-center whitespace-nowrap rounded-[5px] pl-3 text-[13px] font-semibold text-white"
                    style={{ backgroundColor: KPI_COLORS.blue }}
                  >
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d={RI.edit} /></svg>
                    <span className="pl-2 pr-4">{t("Изменить планы")}</span>
                  </button>
                </RefTip>
                <span className="ml-[18px]">
                  <RefIconButton path={COPY_ICON} label={t("Дублировать")} color="#5d6474" onClick={() => canEdit && setDialog({ kind: "duplicate" })} />
                </span>
              </>
            )
          }
        />

        {error && (
          <div className="flex items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(error)}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f71dc] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={loading ? "opacity-60" : undefined}>
          <ListBTable
            cols={cols}
            headCols={headCols}
            minWidth={900}
            cellPad={0}
            inset={state.showCheckboxes ? 24 : 30}
            heads={[
              ...(state.showCheckboxes
                ? [
                    <button key="all" type="button" aria-label={t("Выбрать все")} onClick={() => setSelected((current) => (allChecked ? current.filter((id) => !pageIds.includes(id)) : [...new Set([...current, ...pageIds])]))} className="-ml-1 block h-6 w-6">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={SELECT_ALL_ICON} /></svg>
                    </button>,
                  ]
                : []),
              sortHead("name", t("Филиал")),
              sortHead("salary", t("Сумма бонусов")),
              "KPI",
            ]}
            rows={rows}
            rowKey={(row) => row.id}
            rowClass={(row) => (state.id === row.id ? "!bg-[#f2f5f8]" : "")}
            onRowClick={(row) => update({ id: state.id === row.id ? null : row.id })}
            empty={loading ? "" : t("Нет данных")}
            render={(row) => [
              ...(state.showCheckboxes
                ? [
                    <span key="check" onClick={(event) => event.stopPropagation()}>
                      {checkbox(selected.includes(row.id), () => setSelected((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])), row.name)}
                    </span>,
                  ]
                : []),
              <span key="name" className={`block ${state.showCheckboxes ? "pl-[13px]" : "pl-2"}`}>{row.name}</span>,
              kpiNumber(row.totalBonus),
              <div key="kpi" className="flex flex-wrap items-center">
                {row.performanceIndicators.map((item) => (
                  <div key={item.id} className="my-[4px] mr-2.5 inline-flex h-7 items-center rounded-sm bg-[#e9ecef] px-2.5 leading-none">
                    {item.name}: <span className="ml-1 font-semibold text-[#4f71dc]">{kpiNumber(item.plan)}</span>
                  </div>
                ))}
              </div>,
            ]}
            replaceRow={(row) => state.id === row.id}
            expanded={(row) =>
              state.id === row.id ? (
                <BranchKpiDetailPanel
                  branchId={row.id}
                  month={state.month}
                  year={state.year}
                  version={version}
                  onClose={() => update({ id: null })}
                  onOpenIndicator={(indicatorId) => setDialog({ kind: "levels", indicatorId })}
                />
              ) : null
            }
          />
        </div>
      </RefCard>

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
    </RefPage>
  )
}
