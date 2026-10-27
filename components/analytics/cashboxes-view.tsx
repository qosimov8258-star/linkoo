"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { EmptyRows, RowActions, SettingsToolbar, kitHead, kitRow } from "@/components/analytics/settings-list-kit"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { CASHBOXES_API, CASHBOX_TYPE_LABELS, CASH_MANAGEMENT_URL, type CashboxErrorBody, type CashboxListResult } from "./cashboxes-data"
import { CashboxDeleteDialog } from "./cashboxes-dialogs"
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

const COLUMNS = "139fr 203fr 202fr 203fr 202fr 101fr 101fr 124fr"

function CashboxesGrid() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [dialog, setDialog] = useState<DialogState>(() => dialogFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
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

  const rows = data?.results ?? []
  const total = data?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(total / state.pageSize))
  const from = total ? (state.page - 1) * state.pageSize + 1 : 0

  return (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={
          canEdit ? (
            <button type="button" onClick={() => setDialog({ kind: "create" })} className="ml-[5px] flex h-[30px] items-center gap-[8px] rounded-[3px] bg-[#4f71dc] px-[12px] text-[13px] font-bold text-white hover:brightness-95">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
              {t("Добавить кассу")}
            </button>
          ) : undefined
        }
        query={searchDraft}
        onQuery={setSearchDraft}
        pager={{
          pageSize: state.pageSize,
          onPageSize: (pageSize) => update({ pageSize, page: 1 }),
          from,
          to: Math.min(state.page * state.pageSize, total),
          total,
          onPrev: state.page > 1 ? () => update({ page: state.page - 1 }) : undefined,
          onNext: state.page < lastPage ? () => update({ page: state.page + 1 }) : undefined,
        }}
        right={
          <Link href={CASH_MANAGEMENT_URL} className="ml-[16px] mr-[8px] flex h-[30px] items-center gap-[8px] rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" /></svg>
            {t("Управлять кассами")}
          </Link>
        }
      />

      <div className={`${kitHead} min-h-[50px]`} style={{ gridTemplateColumns: COLUMNS }}>
        <span className="pl-[30px]">Id</span>
        <span>{t("Наименование")}</span>
        <span>{t("Валюта")}</span>
        <span>{t("Кассир")}</span>
        <span>{t("Тип")}</span>
        <span>{t("Вэнсел")}</span>
        <span className="pr-[10px]">{t("Порядковый номер")}</span>
        <span />
      </div>
      <div className={loading && data ? "opacity-60" : undefined}>
        {loading && !data ? (
          <p className="py-10 text-center text-slate-400">{t("Загрузка...")}</p>
        ) : error ? (
          <p className="py-10 text-center text-red-600">{t(error)}</p>
        ) : rows.length === 0 ? (
          <EmptyRows />
        ) : (
          rows.map((cashbox) => (
            <div key={cashbox.id} className={kitRow} style={{ gridTemplateColumns: COLUMNS }}>
              <span className="pl-[30px]">{cashbox.id}</span>
              <span className="py-[10px] pr-[16px]">{cashbox.name}</span>
              <span>{cashbox.currency ? currencyLabel(normCurrency(cashbox.currency)) : t("Не указано")}</span>
              <span className="py-[10px] pr-[16px]">{cashbox.cashier || t("Не указано")}</span>
              <span>{t(CASHBOX_TYPE_LABELS[cashbox.type])}</span>
              <span>
                <span
                  role="img"
                  aria-label={cashbox.vansell ? t("Да") : t("Нет")}
                  title={cashbox.vansell ? t("Да") : t("Нет")}
                  className={`inline-block h-4 w-4 rounded-full align-middle ${cashbox.vansell ? "bg-[rgb(129,199,132)]" : "bg-[#f00]"}`}
                />
              </span>
              <span>{cashbox.orderNumber ?? t("Не указано")}</span>
              {canEdit && <RowActions right={33} onEdit={() => setDialog({ kind: "update", id: cashbox.id })} onDelete={() => setDialog({ kind: "delete", id: cashbox.id, name: cashbox.name })} />}
            </div>
          ))
        )}
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

      <CashSnackbar message={notice} onClose={closeNotice} />
    </section>
  )
}
