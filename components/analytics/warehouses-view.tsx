"use client"

import { ArrowDown, ArrowUp, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCanWrite } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { WarehouseFormModal } from "./warehouse-form-modal"
import { WarehouseDeleteDialog, WarehouseSnackbar, type WarehouseNotice } from "./warehouses-dialogs"
import {
  WAREHOUSES_API,
  WAREHOUSE_ORDERINGS,
  warehouseStockTypeLabel,
  type WarehouseDetail,
  type WarehouseErrorBody,
  type WarehouseListResult,
  type WarehouseOrdering,
  type WarehouseOrderingField,
} from "./warehouses-data"

// "Склады" (demo #/stock, Settings → Склад and Склад → Работа со складами; API
// stock/stock/). Settings side menu + tabs "Активные" / "Не активные" + grid:
// "+ добавить склад", search (500 ms debounce / Enter), paginator, sortable columns
// Наименование | Адрес | Зав. склад | Филиал | Тип склада | Вэнсел (green / red dot) |
// Дата создания, hover ✎ / 🗑. Create / update dialog = warehouse-form-modal.tsx, delete
// confirm = warehouses-dialogs.tsx. Like the demo the state lives in the URL (?isActive,
// ?search, ?page, ?pageSize, ?ordering, ?openCreateDialog=true,
// ?stock=<id>&openUpdateDialog=true | openDeleteDialog=true).

type ActiveTab = "true" | "false"
type ViewState = { isActive: ActiveTab; search: string; ordering: WarehouseOrdering; page: number; pageSize: number }
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

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    update({ search: searchDraft.trim(), page: 1 })
  }

  const rows = data?.results ?? []
  const notSet = t("Не указано")
  // Demo "DD MMM YYYY" (ru Intl appends " г.", the demo does not).
  const created = (row: WarehouseDetail) => (row.createdAt ? formatStatementDate(row.createdAt, language, false).replace(/\s*г\.$/, "") : row.createdDate)
  const header = (field: WarehouseOrderingField, label: string, className = "") => (
    <th className={`px-4 py-4 font-semibold ${className}`}>
      <SortButton label={t(label)} field={field} ordering={state.ordering} onSort={(next) => update({ ordering: next, page: 1 })} />
    </th>
  )

  return (
    <section className="min-w-0 flex-1 pb-6">
      <div className="flex border-b border-[#efefef] text-center" role="tablist">
        {(["true", "false"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={state.isActive === value}
            onClick={() => update({ isActive: value, page: 1 })}
            className={`h-10 flex-1 border-b-[3px] text-[14px] ${state.isActive === value ? "border-[#4f71dc] font-medium text-[#333]" : "border-transparent text-slate-500 hover:text-[#333]"}`}
          >
            {value === "true" ? t("Активные") : t("Не активные")}
          </button>
        ))}
      </div>

      <div className="px-6 pt-4 lg:px-9">
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          {canEdit && (
            <button type="button" onClick={() => setDialog({ kind: "create" })} className="inline-flex items-center gap-1 text-[16px] text-[#4f71dc] hover:underline">
              <Plus className="h-4 w-4" /> {t("добавить склад")}
            </button>
          )}
          <form onSubmit={submitSearch} className="relative mx-auto w-full max-w-[300px]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]"
            />
            <button type="submit" aria-label={t("Поиск")} className="absolute right-1 top-1.5 text-slate-300 hover:text-[#4f70e7]">
              <Search className="h-5 w-5" />
            </button>
          </form>
          <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={(next) => update({ page: next.page, pageSize: next.pageSize })} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[14px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                {header("name", "Наименование", "pl-6")}
                {header("address", "Адрес")}
                {header("manager", "Зав. склад")}
                {header("branch", "Филиал")}
                {header("stock_type", "Тип склада")}
                {header("is_van_sell", "Вэнсел", "text-center")}
                {header("created_date", "Дата создания")}
                <th className="w-24" />
              </tr>
            </thead>
            <tbody className={loading && data ? "opacity-60" : undefined}>
              {loading && !data ? (
                <MessageRow>{t("Загрузка...")}</MessageRow>
              ) : error ? (
                <MessageRow tone="error">{t(error)}</MessageRow>
              ) : rows.length === 0 ? (
                <MessageRow>{t("По вашему запросу ничего не найдено")}</MessageRow>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                    <td className="max-w-[260px] truncate py-4 pl-6 pr-4 font-medium" title={row.fullName ? `${row.name} — ${row.fullName}` : row.name}>
                      {row.name}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-4" title={row.address}>
                      {row.address || notSet}
                    </td>
                    <td className="px-4 py-4">{row.manager || notSet}</td>
                    <td className="px-4 py-4">{row.branch || notSet}</td>
                    <td className="px-4 py-4">{t(warehouseStockTypeLabel(row.stockType))}</td>
                    <td className="px-4 py-4 text-center">
                      <span
                        className="inline-block h-4 w-4 rounded-full align-middle"
                        style={{ background: row.online ? "rgb(129, 199, 132)" : "#f44336" }}
                        title={row.online ? t("Да") : t("Нет")}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">{created(row)}</td>
                    <td className="px-4 py-4">
                      {canEdit && (
                        <div className="flex items-center justify-end gap-3 text-slate-500 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <button type="button" onClick={() => setDialog({ kind: "update", id: row.id })} title={t("Изменить")} aria-label={t("Изменить")} className="hover:text-[#4f70e7]">
                            <Pencil className="h-5 w-5" />
                          </button>
                          <button type="button" onClick={() => setDialog({ kind: "delete", id: row.id, name: row.name })} title={t("Удалить")} aria-label={t("Удалить")} className="hover:text-rose-600">
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
    <button type="button" onClick={() => onSort(nextOrdering(ordering, field))} className="inline-flex items-center gap-1 font-semibold">
      {label} {icon}
    </button>
  )
}

function MessageRow({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <tr>
      <td colSpan={8} className={`px-9 py-10 text-center ${tone === "error" ? "text-red-600" : "text-slate-400"}`}>
        {children}
      </td>
    </tr>
  )
}
