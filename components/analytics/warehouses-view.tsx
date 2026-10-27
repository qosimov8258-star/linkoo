"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { AddLink, EmptyRows, RowActions, SettingsToolbar, kitHead, kitRow } from "@/components/analytics/settings-list-kit"
import { useCanWrite } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { WarehouseFormModal } from "./warehouse-form-modal"
import { WarehouseDeleteDialog, WarehouseSnackbar, type WarehouseNotice } from "./warehouses-dialogs"
import {
  WAREHOUSES_API,
  WAREHOUSE_ORDERINGS,
    type WarehouseDetail,
  type WarehouseErrorBody,
  type WarehouseListResult,
  type WarehouseOrdering,
  type WarehouseOrderingField,
} from "./warehouses-data"

// "Склады" (demo #/stock, Settings → Склад and Склад → Работа со складами; API
// stock/stock/). Settings side menu + tabs "Активные" / "Не активные" + grid:
// "+ добавить склад", search (500 ms debounce / Enter), paginator, sortable columns
// Id | Наименование | Адрес | Филиал | Зав. склад | Дата создания |
// Вэнсел (green / red dot), hover ✎ / 🗑. Create / update dialog = warehouse-form-modal.tsx, delete
// confirm = warehouses-dialogs.tsx. Like the demo the state lives in the URL (?isActive,
// ?search, ?page, ?pageSize, ?ordering, ?openCreateDialog=true,
// ?stock=<id>&openUpdateDialog=true | openDeleteDialog=true).

type ActiveTab = "true" | "false"
type ViewState = { isActive: ActiveTab; search: string; ordering: WarehouseOrdering; page: number; pageSize: number }
// Reference grid: 12 xs columns inside the 30px gutters (Id 1 | 2 | 2 | 2 | 2 | Дата 1 | Вэнсел 3).
// Measured on the reference (1500px): text starts at x = 255 / 364 / 567 / 769 / 972 / 1174 / 1315.
const COLUMNS = "109px 203px 202px 203px 202px 141px minmax(0,1fr)"

type DialogState = { kind: "create" } | { kind: "update"; id: number } | { kind: "delete"; id: number; name?: string } | null

const ORDERINGS = new Set<string>(WAREHOUSE_ORDERINGS.flatMap((field) => [field, `-${field}`]))

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stateFromParams(params: URLSearchParams): ViewState {
  const ordering = params.get("ordering") ?? ""
  return {
    isActive: params.get("isActive") === "false" ? "false" : "true",
    search: params.get("search") ?? "",
    ordering: ORDERINGS.has(ordering) ? (ordering as WarehouseOrdering) : "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
  }
}

function dialogFromParams(params: URLSearchParams): DialogState {
  if (params.get("openCreateDialog") === "true") return { kind: "create" }
  const id = positiveInt(params.get("stock"), 0)
  if (!id) return null
  if (params.get("openUpdateDialog") === "true") return { kind: "update", id }
  if (params.get("openDeleteDialog") === "true") return { kind: "delete", id }
  return null
}

function urlSearch(state: ViewState, dialog: DialogState): string {
  const params = new URLSearchParams()
  if (state.isActive === "false") params.set("isActive", "false")
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  if (dialog?.kind === "create") params.set("openCreateDialog", "true")
  if (dialog && dialog.kind !== "create") {
    params.set("stock", String(dialog.id))
    params.set(dialog.kind === "update" ? "openUpdateDialog" : "openDeleteDialog", "true")
  }
  return params.toString()
}

function listUrl(state: ViewState): string {
  const params = new URLSearchParams({ paged: "1", isActive: state.isActive, page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  return `${WAREHOUSES_API}?${params.toString()}`
}

/** Demo header sorting: none → ↑ → ↓ → none. */
function nextOrdering(current: WarehouseOrdering, field: WarehouseOrderingField): WarehouseOrdering {
  if (current === field) return `-${field}`
  if (current === `-${field}`) return ""
  return field
}

function useWarehouseList(url: string) {
  const [data, setData] = useState<WarehouseListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as WarehouseListResult & WarehouseErrorBody
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить склады с сервера")
        setData(body)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading, error, reload }
}

export function WarehousesView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <WarehousesGrid />
  return (
    <CatalogPageLayout>
      <WarehousesGrid />
    </CatalogPageLayout>
  )
}

function WarehousesGrid() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [dialog, setDialog] = useState<DialogState>(() => dialogFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [notice, setNotice] = useState<WarehouseNotice | null>(null)
  const canEdit = useCanWrite()
  const { data, loading, error, reload } = useWarehouseList(listUrl(state))

  const update = useCallback((patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch })), [])
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    const search = urlSearch(state, dialog)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state, dialog])

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => update({ search: value, page: 1 }), 500)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search, update])

  // A page past the end (stale URL, rows deleted / moved to the other tab) jumps to the last page.
  useEffect(() => {
    if (!data || loading || data.results.length || state.page <= 1) return
    const lastPage = Math.max(1, Math.ceil(data.count / state.pageSize))
    if (state.page > lastPage) update({ page: lastPage })
  }, [data, loading, state.page, state.pageSize, update])

  const rows = data?.results ?? []
  const notSet = t("Не указано")
  // Demo "DD MMM YYYY" (ru Intl appends " г.", the demo does not).
  const created = (row: WarehouseDetail) => (row.createdAt && language !== "ru" ? formatStatementDate(row.createdAt, language, false).replace(/\s*г\.$/, "") : row.createdDate)
  const header = (field: WarehouseOrderingField, label: string, className = "") => (
    <span className={`pr-4 ${className}`}>
      <SortButton label={t(label)} field={field} ordering={state.ordering} onSort={(next) => update({ ordering: next, page: 1 })} />
    </span>
  )
  const from = data && data.count > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const to = data ? Math.min(data.count, state.page * state.pageSize) : 0
  const lastPage = Math.max(1, Math.ceil((data?.count ?? 0) / state.pageSize))

  return (
    <section className="min-w-0 flex-1 bg-white pb-6 text-[13px] text-[#333]">
      <div className="mt-[10px] flex border-b border-[#efefef] text-center" role="tablist">
        {(["true", "false"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={state.isActive === value}
            onClick={() => update({ isActive: value, page: 1 })}
            className={`h-10 flex-1 border-b-[3px] text-[13px] font-medium text-black ${state.isActive === value ? "border-[#4f71dc]" : "border-transparent"}`}
          >
            {value === "true" ? t("Активные") : t("Не активные")}
          </button>
        ))}
      </div>

      <SettingsToolbar
        className="h-[52px]"
        searchClassName="left-[335px] top-[12px]"
        left={canEdit ? <AddLink onClick={() => setDialog({ kind: "create" })}>{t("добавить склад")}</AddLink> : undefined}
        query={searchDraft}
        onQuery={setSearchDraft}
        pager={{
          pageSize: state.pageSize,
          onPageSize: (size) => update({ pageSize: size, page: 1 }),
          from,
          to,
          total: data?.count ?? 0,
          onPrev: state.page > 1 ? () => update({ page: state.page - 1 }) : undefined,
          onNext: state.page < lastPage ? () => update({ page: state.page + 1 }) : undefined,
        }}
      />

      <div className={`${kitHead} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
        {header("id", "Id", "")}
        {header("name", "Наименование")}
        {header("address", "Адрес")}
        {header("branch", "Филиал")}
        {header("manager", "Зав. склад")}
        {header("created_date", "Дата создания", "pr-[56px]")}
        {header("is_van_sell", "Вэнсел", "")}
      </div>
      <div className={loading && data ? "opacity-60" : undefined}>
        {loading && !data ? (
          <div className="px-[30px] py-10 text-center text-slate-400">{t("Загрузка...")}</div>
        ) : error ? (
          <div className="px-[30px] py-10 text-center text-red-600">{t(error)}</div>
        ) : rows.length === 0 ? (
          <EmptyRows />
        ) : (
          rows.map((row) => (
            <div key={row.id} className={`${kitRow} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
              <span className="pr-4">{row.id}</span>
              <span className="min-w-0 break-words pr-4" title={row.fullName ? `${row.name} — ${row.fullName}` : row.name}>
                {row.name}
              </span>
              <span className="min-w-0 break-words pr-4" title={row.address}>
                {row.address || notSet}
              </span>
              <span className="min-w-0 break-words pr-4">{row.branch || notSet}</span>
              <span className="min-w-0 break-words pr-4">{row.manager || notSet}</span>
              <span className="pr-[55.6px]">{created(row)}</span>
              <span className="pl-[30px]">
                <span
                  className="inline-block h-4 w-4 rounded-full align-middle"
                  style={{ background: row.online ? "rgb(129, 199, 132)" : "#f44336" }}
                  title={row.online ? t("Да") : t("Нет")}
                />
              </span>
              {canEdit && (
                <RowActions
                  onEdit={() => setDialog({ kind: "update", id: row.id })}
                  onDelete={() => setDialog({ kind: "delete", id: row.id, name: row.name })}
                />
              )}
            </div>
          ))
        )}
      </div>

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <WarehouseFormModal
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          warehouseId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: t("Успешно сохранено"), tone: "success" })
            reload()
          }}
        />
      )}

      {dialog?.kind === "delete" && (
        <WarehouseDeleteDialog
          key={`delete-${dialog.id}`}
          warehouseId={dialog.id}
          name={dialog.name}
          onClose={closeDialog}
          onDeleted={() => {
            setDialog(null)
            setNotice({ text: t("Успешно удалено"), tone: "success" })
            reload()
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      <WarehouseSnackbar notice={notice} onClose={closeNotice} />
    </section>
  )
}

function SortButton({ label, field, ordering, onSort }: { label: string; field: WarehouseOrderingField; ordering: WarehouseOrdering; onSort: (next: WarehouseOrdering) => void }) {
  const icon = ordering === field ? <ArrowUp className="h-4 w-4" /> : ordering === `-${field}` ? <ArrowDown className="h-4 w-4" /> : null
  return (
    <button type="button" onClick={() => onSort(nextOrdering(ordering, field))} className="inline-flex items-center gap-[10px] font-semibold">
      {label} {icon}
    </button>
  )
}
