"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  ORGANIZATIONS_API,
  type OrganizationErrorBody,
  type OrganizationListResult,
  type OrganizationOrdering,
} from "./organization-data"
import { EmptyState, HoverActions, ListToolbar, grayHead, listRow } from "./catalog-ui"
import {
  OrganizationDeleteDialog,
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

  const rows = data?.results ?? []
  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / state.pageSize))
  const start = (state.page - 1) * state.pageSize
  const sortIcon = state.ordering === "name" ? <ArrowDown className="h-4 w-4" /> : state.ordering === "-name" ? <ArrowUp className="h-4 w-4" /> : null
  const gridCols = "grid-cols-[514px_1fr]"

  return (
    <section className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        addLabel={t("добавить организацию")}
        hideAdd={!canEdit}
        onAdd={() => setDialog({ kind: "create" })}
        query={searchDraft}
        onQuery={setSearchDraft}
        addPad={16}
        searchPos={{ left: 335, top: 19 }}
        pageSize={state.pageSize}
        onPageSize={(pageSize) => update({ page: 1, pageSize })}
        from={count ? start + 1 : 0}
        to={Math.min(start + state.pageSize, count)}
        total={count}
        onPrev={state.page > 1 ? () => update({ page: state.page - 1 }) : undefined}
        onNext={state.page < pageCount ? () => update({ page: state.page + 1 }) : undefined}
      />
      <div className={`${grayHead} ${gridCols}`}>
        <button type="button" onClick={() => update({ ordering: nextOrdering(state.ordering), page: 1 })} className="inline-flex items-center gap-2 text-left font-bold">
          {t("Наименование")} {sortIcon}
        </button>
        <span>{t("Ограничение по долгу клиента")}</span>
      </div>
      <div className={loading && data ? "opacity-60" : undefined}>
        {error ? (
          <p className="px-[30px] py-10 text-center text-red-600">{t(error)}</p>
        ) : rows.length === 0 ? (
          loading && !data ? null : <EmptyState />
        ) : (
          rows.map((organization) => (
            <div key={organization.id} className={`${listRow} ${gridCols}`}>
              <span title={organization.name} className="truncate pr-4">{organization.name}</span>
              <span>{organization.limitByDebt ? t("С ограничением") : t("Без ограничения")}</span>
              {canEdit && (
                <HoverActions
                  onEdit={() => setDialog({ kind: "update", id: organization.id })}
                  onDelete={() => setDialog({ kind: "delete", id: organization.id, name: organization.name })}
                />
              )}
            </div>
          ))
        )}
      </div>

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

      <OrganizationSnackbar notice={notice} onClose={closeNotice} />
    </section>
  )
}
