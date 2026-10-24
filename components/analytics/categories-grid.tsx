"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import { AddLink, EmptyRows, RowActions, SettingsToolbar, kitHead, kitRow } from "@/components/analytics/settings-list-kit"
import type { CategoryErrorBody } from "@/lib/categories-schema"
import type { CategoryKind } from "@/lib/category-options"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { CategoryDeleteDialog, CategorySnackbar, type CategoryNotice } from "./categories-dialogs"
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
  /** Share of the 12-part reference grid, e.g. "3fr" (the rest of the 12 parts stays empty). */
  width: string
  /** Ascending ordering key of a sortable header. */
  ordering?: string
  /** The reference header text of these columns sits 8px to the right of the row text. */
  indent?: boolean
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
}: {
  kind: CategoryKind
  columns: CategoryColumn<T>[]
  /** "добавить категорию приходов" / "добавить категорию расходов". */
  addLabel: string
  /** Kept for the pages' call sites; the kit grid does not scroll horizontally. */
  minWidth?: string
}) {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams, columns.flatMap((column) => (column.ordering ? [column.ordering] : []))))
  const [dialog, setDialog] = useState<DialogState>(() => dialogFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
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

  const rows = data?.results ?? []
  // Reference grid: 12 xs columns starting 30px inside the sidebar; the page gives each column its `fr` share, the rest is empty.
  const shares = columns.map((column) => Number.parseFloat(column.width) || 1)
  const template = `${shares.map((share) => `${share}fr`).join(" ")} ${Math.max(0, 12 - shares.reduce((sum, share) => sum + share, 0))}fr`
  const from = data && data.count > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const to = data ? Math.min(data.count, from + rows.length - (rows.length ? 1 : 0)) : 0
  const lastPage = Math.max(1, Math.ceil((data?.count ?? 0) / state.pageSize))

  return (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={canEdit ? <AddLink onClick={() => setDialog({ kind: "create" })}>{t(addLabel)}</AddLink> : undefined}
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

      <div className={`${kitHead} px-[30px]`} style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <span key={column.key} className={`pr-4 ${column.indent ? "pl-[8px]" : ""}`}>
            {column.ordering ? (
              <button
                type="button"
                onClick={() => update({ ordering: nextOrdering(state.ordering, column.ordering!), page: 1 })}
                className="inline-flex items-center gap-[10px] text-left font-semibold"
              >
                {t(column.title)}
                {state.ordering === column.ordering && <ArrowUp className="h-[14px] w-[14px] shrink-0" />}
                {state.ordering === `-${column.ordering}` && <ArrowDown className="h-[14px] w-[14px] shrink-0" />}
              </button>
            ) : (
              t(column.title)
            )}
          </span>
        ))}
        <span />
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
            <div key={row.id} className={`${kitRow} px-[30px]`} style={{ gridTemplateColumns: template }}>
              {columns.map((column) => (
                <span key={column.key} className={`min-w-0 pr-4 ${column.className ?? ""}`}>
                  {column.render(row)}
                </span>
              ))}
              <span />
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

      <CategorySnackbar notice={notice} onClose={closeNotice} />
    </section>
  )
}
