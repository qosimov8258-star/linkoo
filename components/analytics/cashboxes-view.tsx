"use client"

import { ArrowLeftRight, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { CASHBOXES_API, CASHBOX_TYPE_LABELS, CASH_MANAGEMENT_URL, type CashboxErrorBody, type CashboxListResult } from "./cashboxes-data"
import { CashboxDeleteDialog, CashboxImportDialog } from "./cashboxes-dialogs"
import { CashboxFormModal } from "./cashboxes-form-modal"

// "Кассы" (demo #/cashbox, Settings → Финансы; API finance/cashbox/). Grid:
// "Добавить кассу", search, paginator, "Управлять кассами" (→ Управления кассой),
// Id | Наименование | Валюта | Кассир | Тип | Вэнсел | Порядковый номер | hover ✎ / 🗑,
// ordered by position ("Не указано" last) then newest first. Create / update dialog =
// cashboxes-form-modal.tsx, delete confirm + Excel import = cashboxes-dialogs.tsx.
// Like the demo the state lives in the URL (?search, ?page, ?pageSize,
// ?openCreateDialog=true, ?cashbox=<id>&openUpdateDialog=true | openDeleteDialog=true).

type ViewState = { search: string; page: number; pageSize: number }

type DialogState = { kind: "create" } | { kind: "update"; id: number } | { kind: "delete"; id: number; name?: string } | null

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stateFromParams(params: URLSearchParams): ViewState {
  return {
    search: params.get("search") ?? "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
  }
}

function dialogFromParams(params: URLSearchParams): DialogState {
  if (params.get("openCreateDialog") === "true") return { kind: "create" }
  const id = positiveInt(params.get("cashbox"), 0)
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
  if (dialog?.kind === "create") params.set("openCreateDialog", "true")
  if (dialog && dialog.kind !== "create") {
    params.set("cashbox", String(dialog.id))
    params.set(dialog.kind === "update" ? "openUpdateDialog" : "openDeleteDialog", "true")
  }
  return params.toString()
}

function listUrl(state: ViewState): string {
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  return `${CASHBOXES_API}?${params.toString()}`
}

function useCashboxList(url: string) {
  const [data, setData] = useState<CashboxListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as CashboxListResult & CashboxErrorBody
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить кассы")
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

export function CashboxesView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <CashboxesGrid />
  return (
    <CatalogPageLayout>
      <CashboxesGrid />
    </CatalogPageLayout>
  )
}

const COLUMNS = ["Id", "Наименование", "Валюта", "Кассир", "Тип", "Вэнсел", "Порядковый номер"] as const
const COLUMN_WIDTHS = ["w-[7%]", "w-[21%]", "w-[9%]", "w-[19%]", "w-[15%]", "w-[8%]", "w-[12%]"]

function CashboxesGrid() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [dialog, setDialog] = useState<DialogState>(() => dialogFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canEdit = useCanWrite()
  const { data, loading, error, reload } = useCashboxList(listUrl(state))

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

  return (
    <section className="min-w-0 flex-1 px-4 py-5 sm:px-9">
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        {canEdit && (
          <button
            type="button"
            onClick={() => setDialog({ kind: "create" })}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-[#4f71dc] px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95"
          >
            <Plus className="h-4 w-4" /> {t("Добавить кассу")}
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1 text-[15px] text-[#4f70e7] hover:underline">
            <FileText className="h-4 w-4" /> {t("Импорт с Excel")}
          </button>
        )}
        <form onSubmit={submitSearch} className="relative w-full max-w-[300px] sm:mx-auto">
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
        <Link
          href={CASH_MANAGEMENT_URL}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95"
        >
          <ArrowLeftRight className="h-4 w-4" /> {t("Управлять кассами")}
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] table-fixed text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              {COLUMNS.map((column, index) => (
                <th key={column} className={`${COLUMN_WIDTHS[index]} ${index === 0 ? "px-6" : "px-4"} py-4 font-semibold`}>
                  {t(column)}
                </th>
              ))}
              <th className="w-[9%]" />
            </tr>
          </thead>
          <tbody className={loading && data ? "opacity-60" : undefined}>
            {loading && !data ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                  {t("Загрузка...")}
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-red-600">
                  {t(error)}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-slate-400">
                  {t("По вашему запросу ничего не найдено")}
                </td>
              </tr>
            ) : (
              rows.map((cashbox) => (
                <tr key={cashbox.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-6 py-4">{cashbox.id}</td>
                  <td className="truncate px-4 py-4 font-medium" title={cashbox.name}>
                    {cashbox.name}
                  </td>
                  <td className="px-4 py-4">{cashbox.currency ? currencyLabel(normCurrency(cashbox.currency)) : t("Не указано")}</td>
                  <td className="truncate px-4 py-4" title={cashbox.cashier}>
                    {cashbox.cashier || t("Не указано")}
                  </td>
                  <td className="px-4 py-4">{t(CASHBOX_TYPE_LABELS[cashbox.type])}</td>
                  <td className="px-4 py-4">
                    <span
                      role="img"
                      aria-label={cashbox.vansell ? t("Да") : t("Нет")}
                      title={cashbox.vansell ? t("Да") : t("Нет")}
                      className={`inline-block h-4 w-4 rounded-full ${cashbox.vansell ? "bg-[rgb(129,199,132)]" : "bg-[#f44336]"}`}
                    />
                  </td>
                  <td className="px-4 py-4">{cashbox.orderNumber ?? t("Не указано")}</td>
                  <td className="px-4 py-4">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-3 text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button type="button" onClick={() => setDialog({ kind: "update", id: cashbox.id })} title={t("Изменить")} aria-label={t("Изменить")} className="hover:text-[#4f70e7]">
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: "delete", id: cashbox.id, name: cashbox.name })}
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
        <CashboxFormModal
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          cashboxId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: "Успешно сохранено", tone: "success" })
            reload()
          }}
        />
      )}

      {dialog?.kind === "delete" && (
        <CashboxDeleteDialog
          key={`delete-${dialog.id}`}
          cashboxId={dialog.id}
          name={dialog.name}
          onClose={closeDialog}
          onDeleted={() => {
            setDialog(null)
            setNotice({ text: "Успешно удалено", tone: "success" })
            reload()
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      {importOpen && (
        <CashboxImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(result) => {
            setImportOpen(false)
            setNotice(result)
            update({ page: 1 })
            reload()
          }}
        />
      )}

      <CashSnackbar message={notice} onClose={closeNotice} />
    </section>
  )
}
