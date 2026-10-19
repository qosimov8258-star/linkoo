"use client"

import { ArrowDown, ArrowUp, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import type { CategoryErrorBody } from "@/lib/categories-schema"
import type { CategoryKind } from "@/lib/category-options"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { CategoryDeleteDialog, CategoryImportDialog, CategorySnackbar, type CategoryNotice } from "./categories-dialogs"
import { categoriesApi, CategoryFormModal } from "./category-form-modal"

// Grid shared by "Категории приходов" and "Категории расходов" (demo GridList of
// modules 4711 / 4709): "+ добавить категорию …", search on the name (500 ms debounce /
// Enter), paginator (25, "1 - 25 из N"), demo columns given by the page, ✎ / 🗑 on row
// hover. Default order = name (case-insensitive, Latin before Cyrillic) from the server;
// only the headers that have an `ordering` sort (none → ascending → descending → none).
// Like the demo the state lives in the URL (?search, ?page, ?pageSize, ?ordering,
// ?openCreateDialog=true, ?category=<id>&openUpdateDialog=true | openDeleteDialog=true).

export type CategoryRow = { id: number; name: string }

export type CategoryColumn<T> = {
  key: string
  /** Russian i18n key of the header. */
  title: string
  /** Width class of the column (table-fixed). */
  width: string
  /** Ascending ordering key of a sortable header. */
  ordering?: string
  className?: string
  render: (row: T) => ReactNode
}

type ViewState = { search: string; ordering: string; page: number; pageSize: number }

type DialogState = { kind: "create" } | { kind: "update"; id: number } | { kind: "delete"; id: number; name?: string } | null

type ListResult<T> = { count: number; results: T[] }

// Demo dates "06 мар. 2025" (moment ru "DD MMM YYYY"); other UI languages use their own month names.
const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

export function formatCategoryDate(iso: string, language: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso
  if (language !== "ru") return formatStatementDate(iso, language, false)
  return `${iso.slice(8, 10)} ${RU_SHORT_MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stateFromParams(params: URLSearchParams, orderings: string[]): ViewState {
  const ordering = params.get("ordering") ?? ""
  return {
    search: params.get("search") ?? "",
    ordering: orderings.includes(ordering.replace(/^-/, "")) ? ordering : "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
  }
}

function dialogFromParams(params: URLSearchParams): DialogState {
  if (params.get("openCreateDialog") === "true") return { kind: "create" }
  const id = positiveInt(params.get("category"), 0)
  if (!id) return null
  if (params.get("openUpdateDialog") === "true") return { kind: "update", id }
  if (params.get("openDeleteDialog") === "true") return { kind: "delete", id }
  return null
}

function urlSearch(state: ViewState, dialog: DialogState): string {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  if (dialog?.kind === "create") params.set("openCreateDialog", "true")
  if (dialog && dialog.kind !== "create") {
    params.set("category", String(dialog.id))
    params.set(dialog.kind === "update" ? "openUpdateDialog" : "openDeleteDialog", "true")
  }
  return params.toString()
}

function listUrl(api: string, state: ViewState): string {
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  return `${api}?${params.toString()}`
}

/** none → field ↑ → field ↓ → none. */
function nextOrdering(current: string, field: string): string {
  if (current === field) return `-${field}`
  if (current === `-${field}`) return ""
  return field
}

function useCategoryList<T>(url: string) {
  const [data, setData] = useState<ListResult<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ListResult<T> & CategoryErrorBody
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить категории")
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

/** Writes need the manager role (POST/PUT/DELETE of the category endpoints). */
function useCanEdit(): boolean {
  const [canEdit, setCanEdit] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { role?: string }) : {}))
      .then((me) => {
        if (!cancelled) setCanEdit(me.role === "manager" || me.role === "admin")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return canEdit
}

export function CategoriesGrid<T extends CategoryRow>({
  kind,
  columns,
  addLabel,
  minWidth,
}: {
  kind: CategoryKind
  columns: CategoryColumn<T>[]
  /** "добавить категорию приходов" / "добавить категорию расходов". */
  addLabel: string
  /** Min table width class (horizontal scroll on narrow screens). */
  minWidth: string
}) {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams, columns.flatMap((column) => (column.ordering ? [column.ordering] : []))))
  const [dialog, setDialog] = useState<DialogState>(() => dialogFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<CategoryNotice | null>(null)
  const canEdit = useCanEdit()
  const { data, loading, error, reload } = useCategoryList<T>(listUrl(categoriesApi(kind), state))

  const update = useCallback((patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch })), [])
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useEffect(() => {
    const search = urlSearch(state, dialog)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state, dialog])

  // Search: 500 ms debounce like the demo GridList search (Enter submits at once).
  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => update({ search: value, page: 1 }), 500)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search, update])

  // A page past the end (stale URL, rows deleted) jumps to the last page.
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
  const colSpan = columns.length + 1

  return (
    <section className="min-w-0 flex-1 px-4 py-5 sm:px-9">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {canEdit && (
          <button type="button" onClick={() => setDialog({ kind: "create" })} className="inline-flex items-center gap-1 text-[16px] text-[#4f70e7] hover:underline">
            <Plus className="h-4 w-4" /> {t(addLabel)}
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1 text-[16px] text-[#4f70e7] hover:underline">
            <FileText className="h-4 w-4" /> {t("Импорт с Excel")}
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
        <BalancePagination
          page={state.page}
          pageSize={state.pageSize}
          count={data?.count ?? 0}
          onChange={(next) => update({ page: next.page, pageSize: next.pageSize })}
        />
      </div>

      <div className="overflow-x-auto">
        <table className={`w-full table-fixed text-left ${minWidth}`}>
          <thead className="bg-[#626b7e] text-white">
            <tr>
              {columns.map((column, index) => (
                <th key={column.key} className={`${column.width} py-4 font-semibold ${index === 0 ? "px-9" : "px-5"}`}>
                  {column.ordering ? (
                    <button
                      type="button"
                      onClick={() => update({ ordering: nextOrdering(state.ordering, column.ordering!), page: 1 })}
                      className="inline-flex items-center gap-2 text-left font-semibold"
                    >
                      {t(column.title)}
                      {state.ordering === column.ordering && <ArrowUp className="h-4 w-4 shrink-0" />}
                      {state.ordering === `-${column.ordering}` && <ArrowDown className="h-4 w-4 shrink-0" />}
                    </button>
                  ) : (
                    t(column.title)
                  )}
                </th>
              ))}
              <th className="w-[96px]" />
            </tr>
          </thead>
          <tbody className={loading && data ? "opacity-60" : undefined}>
            {loading && !data ? (
              <tr>
                <td colSpan={colSpan} className="px-9 py-10 text-center text-slate-400">
                  {t("Загрузка...")}
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={colSpan} className="px-9 py-10 text-center text-red-600">
                  {t(error)}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-9 py-10 text-center text-slate-400">
                  {t("По вашему запросу ничего не найдено")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                  {columns.map((column, index) => (
                    <td key={column.key} className={`h-[50px] py-2 align-middle ${index === 0 ? "px-9" : "px-5"} ${column.className ?? ""}`}>
                      {column.render(row)}
                    </td>
                  ))}
                  <td className="px-5 py-2">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-3 text-slate-500 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button type="button" onClick={() => setDialog({ kind: "update", id: row.id })} title={t("Изменить")} aria-label={t("Изменить")} className="hover:text-[#4f70e7]">
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: "delete", id: row.id, name: row.name })}
                          title={t("Удалить")}
                          aria-label={t("Удалить")}
                          className="hover:text-rose-600"
                        >
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

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <CategoryFormModal
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          kind={kind}
          categoryId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: t("Успешно сохранено"), tone: "success" })
            reload()
          }}
        />
      )}

      {dialog?.kind === "delete" && (
        <CategoryDeleteDialog
          key={`delete-${dialog.id}`}
          kind={kind}
          categoryId={dialog.id}
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

      {importOpen && (
        <CategoryImportDialog
          kind={kind}
          onClose={() => setImportOpen(false)}
          onImported={(result) => {
            setImportOpen(false)
            setNotice(result)
            update({ page: 1 })
            reload()
          }}
        />
      )}

      <CategorySnackbar notice={notice} onClose={closeNotice} />
    </section>
  )
}
