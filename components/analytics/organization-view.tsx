"use client"

import { ArrowDown, ArrowUp, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  ORGANIZATIONS_API,
  type OrganizationErrorBody,
  type OrganizationListResult,
  type OrganizationOrdering,
} from "./organization-data"
import {
  OrganizationDeleteDialog,
  OrganizationImportDialog,
  OrganizationSnackbar,
  type OrganizationNotice,
} from "./organization-dialogs"
import { OrganizationFormModal } from "./organization-form-modal"

// "Организация" (demo #/division, Settings → Разное and Finance menu; API
// main/division/). Settings side menu + grid: "+ добавить организацию", search
// (500 ms debounce / Enter), paginator, "Наименование" (sortable) | "Ограничение по
// долгу клиента" ("С ограничением" / "Без ограничения") | hover ✎ / 🗑. Create /
// update dialog = organization-form-modal.tsx, delete confirm = organization-dialogs.tsx.
// Like the demo the state lives in the URL (?search, ?page, ?pageSize, ?ordering,
// ?openCreateDialog=true, ?division=<id>&openUpdateDialog=true | openDeleteDialog=true).

type ViewState = { search: string; ordering: OrganizationOrdering; page: number; pageSize: number }

type DialogState = { kind: "create" } | { kind: "update"; id: number } | { kind: "delete"; id: number; name?: string } | null

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function orderingFrom(value: string | null): OrganizationOrdering {
  return value === "name" || value === "-name" ? value : ""
}

function stateFromParams(params: URLSearchParams): ViewState {
  return {
    search: params.get("search") ?? "",
    ordering: orderingFrom(params.get("ordering")),
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
  }
}

function dialogFromParams(params: URLSearchParams): DialogState {
  if (params.get("openCreateDialog") === "true") return { kind: "create" }
  const id = positiveInt(params.get("division"), 0)
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
    params.set("division", String(dialog.id))
    params.set(dialog.kind === "update" ? "openUpdateDialog" : "openDeleteDialog", "true")
  }
  return params.toString()
}

function listUrl(state: ViewState): string {
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  return `${ORGANIZATIONS_API}?${params.toString()}`
}

/** Demo header sorting: none → name ↑ → name ↓ → none. */
function nextOrdering(current: OrganizationOrdering): OrganizationOrdering {
  if (current === "name") return "-name"
  if (current === "-name") return ""
  return "name"
}

function useOrganizationList(url: string) {
  const [data, setData] = useState<OrganizationListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as OrganizationListResult & OrganizationErrorBody
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить организации")
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

export function OrganizationView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <OrganizationGrid />
  return (
    <CatalogPageLayout>
      <OrganizationGrid />
    </CatalogPageLayout>
  )
}

function OrganizationGrid() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [dialog, setDialog] = useState<DialogState>(() => dialogFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<OrganizationNotice | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const { data, loading, error, reload } = useOrganizationList(listUrl(state))

  const update = useCallback((patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch })), [])
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  // The demo keeps the grid and dialog state in the URL query.
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

  // Writes need the manager role (POST/PUT/DELETE /api/organizations).
  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) => (response.ok ? ((await response.json()) as { role?: string }) : {}))
      .then((me) => setCanEdit(me.role === "manager" || me.role === "admin"))
      .catch(() => setCanEdit(false))
  }, [])

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
  const sortIcon = state.ordering === "name" ? <ArrowUp className="h-4 w-4" /> : state.ordering === "-name" ? <ArrowDown className="h-4 w-4" /> : null

  return (
    <section className="min-w-0 flex-1 px-9 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {canEdit && (
          <button type="button" onClick={() => setDialog({ kind: "create" })} className="inline-flex items-center gap-1 text-[16px] text-[#4f70e7] hover:underline">
            <Plus className="h-4 w-4" /> {t("добавить организацию")}
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

      <table className="w-full table-fixed text-left">
        <thead className="bg-[#626b7e] text-white">
          <tr>
            <th className="w-5/12 px-9 py-4">
              <button type="button" onClick={() => update({ ordering: nextOrdering(state.ordering), page: 1 })} className="inline-flex items-center gap-2 font-semibold">
                {t("Наименование")} {sortIcon}
              </button>
            </th>
            <th className="w-5/12 px-5 py-4 font-semibold">{t("Ограничение по долгу клиента")}</th>
            <th className="w-2/12" />
          </tr>
        </thead>
        <tbody className={loading && data ? "opacity-60" : undefined}>
          {loading && !data ? (
            <tr>
              <td colSpan={3} className="px-9 py-10 text-center text-slate-400">
                {t("Загрузка...")}
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={3} className="px-9 py-10 text-center text-red-600">
                {t(error)}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-9 py-10 text-center text-slate-400">
                {t("По вашему запросу ничего не найдено")}
              </td>
            </tr>
          ) : (
            rows.map((organization) => (
              <tr key={organization.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="truncate px-9 py-4 font-medium" title={organization.name}>
                  {organization.name}
                </td>
                <td className="px-5 py-4">{organization.limitByDebt ? t("С ограничением") : t("Без ограничения")}</td>
                <td className="px-5 py-4">
                  {canEdit && (
                    <div className="flex items-center justify-end gap-3 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" onClick={() => setDialog({ kind: "update", id: organization.id })} title={t("Изменить")} aria-label={t("Изменить")} className="hover:text-[#4f70e7]">
                        <Pencil className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: "delete", id: organization.id, name: organization.name })}
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

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <OrganizationFormModal
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          organizationId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: t("Успешно сохранено"), tone: "success" })
            reload()
          }}
        />
      )}

      {dialog?.kind === "delete" && (
        <OrganizationDeleteDialog
          key={`delete-${dialog.id}`}
          organizationId={dialog.id}
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
        <OrganizationImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(result) => {
            setImportOpen(false)
            setNotice(result)
            update({ page: 1 })
            reload()
          }}
        />
      )}

      <OrganizationSnackbar notice={notice} onClose={closeNotice} />
    </section>
  )
}
