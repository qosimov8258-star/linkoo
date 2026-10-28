"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { EmptyRows, ROW_ICONS, RowActions, RowIcon, SettingsToolbar, kitHead, kitRow } from "@/components/analytics/settings-list-kit"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { currencyLabel } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { PriceListDeleteDialog, PriceListFormDialog } from "./price-lists-dialogs"
import { PRICE_LISTS_API, type PriceList, type PriceListListResult } from "./price-lists-data"
import { SetPriceDialog } from "./price-lists-set-price"

// "Прайс-листы" (demo #/price-list-setting, chunk c94: grid 4914, form 4410; API sales/price_list/).
// Settings side menu + toolbar "Добавить прайс-лист" | search | paginator | "Добавить цену" (the
// set-price grid, c9 module 4389); columns Id | Наименование | Валюта | Дата создания | Связанный
// прайс лист | Метод расчета; hover actions
// "Установить цену" (→ Переоценка create dialog with this list and currency, as in the demo),
// "Изменить", "Удалить". State in the URL: ?search, ?page, ?pageSize, ?ordering,
// ?openCreateDialog=true, ?priceList=<id>&openUpdateDialog | openDeleteDialog, ?openSetPrice=true.

// Reference grid: 12 xs columns inside the 30px gutters (Id 1 | 2 | 2 | 2 | 2 | 2).
const COLUMNS = "1fr 2fr 2fr 2fr 2fr 2fr 1fr"

type ViewState = { search: string; ordering: string; page: number; pageSize: number }
type DialogState = { kind: "create" } | { kind: "update"; id: number } | { kind: "delete"; id: number; name: string } | { kind: "setPrice" } | null

const SORTABLE = new Set(["id", "name", "currency", "created_date"])

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stateFromParams(params: URLSearchParams): ViewState {
  const ordering = params.get("ordering") ?? ""
  return {
    search: params.get("search") ?? "",
    ordering: SORTABLE.has(ordering.replace(/^-/, "")) ? ordering : "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
  }
}

function dialogFromParams(params: URLSearchParams): DialogState {
  if (params.get("openCreateDialog") === "true") return { kind: "create" }
  if (params.get("openSetPrice") === "true") return { kind: "setPrice" }
  const id = positiveInt(params.get("priceList"), 0)
  if (id && params.get("openUpdateDialog") === "true") return { kind: "update", id }
  return null
}

function urlSearch(state: ViewState, dialog: DialogState): string {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  if (dialog?.kind === "create") params.set("openCreateDialog", "true")
  if (dialog?.kind === "setPrice") params.set("openSetPrice", "true")
  if (dialog?.kind === "update" || dialog?.kind === "delete") {
    params.set("priceList", String(dialog.id))
    params.set(dialog.kind === "update" ? "openUpdateDialog" : "openDeleteDialog", "true")
  }
  return params.toString()
}

function listUrl(state: ViewState): string {
  const params = new URLSearchParams({ paged: "1", page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  return `${PRICE_LISTS_API}?${params.toString()}`
}

export function PriceListsView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <PriceListsGrid />
  return (
    <CatalogPageLayout>
      <PriceListsGrid />
    </CatalogPageLayout>
  )
}

function PriceListsGrid() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const router = useRouter()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [dialog, setDialog] = useState<DialogState>(() => dialogFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const list = useCashJson<PriceListListResult>(listUrl(state))
  const data = list.data
  const rows = data?.results ?? []

  const update = useCallback((patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch })), [])
  const closeDialog = useCallback(() => setDialog(null), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])

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

  useEffect(() => {
    if (!data || list.loading || data.results.length || state.page <= 1) return
    const last = Math.max(1, Math.ceil(data.count / state.pageSize))
    if (state.page > last) update({ page: last })
  }, [data, list.loading, state.page, state.pageSize, update])

  // A delete link (?priceList=&openDeleteDialog=true) needs the name: read it once.
  useEffect(() => {
    const id = positiveInt(searchParams.get("priceList"), 0)
    if (!id || searchParams.get("openDeleteDialog") !== "true") return
    fetch(`${PRICE_LISTS_API}/${id}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<PriceList>) : null))
      .then((row) => row && setDialog({ kind: "delete", id: row.id, name: row.name }))
      .catch(() => {})
  }, [searchParams])

  const notSet = t("Не указано")
  const created = (row: PriceList) => (row.createdAt && language !== "ru" ? formatStatementDate(row.createdAt, language, false).replace(/\s*г\.$/, "") : row.createdDate)
  const sortHeader = (field: string, label: string) => (
    <button
      type="button"
      onClick={() => update({ ordering: state.ordering === field ? `-${field}` : state.ordering === `-${field}` ? "" : field, page: 1 })}
      className="inline-flex items-center gap-[10px] font-semibold"
    >
      {t(label)}
      {state.ordering === field ? <ArrowUp className="h-[14px] w-[14px]" /> : state.ordering === `-${field}` ? <ArrowDown className="h-[14px] w-[14px]" /> : null}
    </button>
  )
  const total = data?.count ?? 0
  const from = total > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const to = Math.min(total, state.page * state.pageSize)
  const lastPage = Math.max(1, Math.ceil(total / state.pageSize))
  const buttonClass = "inline-flex h-[30px] items-center gap-[8px] rounded-[5px] pl-[11px] text-[13px] font-semibold text-white hover:brightness-95"

  return (
    <section className="min-w-0 flex-1 bg-white pb-6 text-[13px] text-[#333]">
      <SettingsToolbar
        searchClassName="left-[335px] top-[20px]"
        left={
          canEdit ? (
            <button type="button" onClick={() => setDialog({ kind: "create" })} className={`ml-[5px] bg-[#4f71dc] pr-[15px] ${buttonClass}`}>
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
              {t("Добавить прайс-лист")}
            </button>
          ) : undefined
        }
        query={searchDraft}
        onQuery={setSearchDraft}
        pager={{
          pageSize: state.pageSize,
          onPageSize: (size) => update({ pageSize: size, page: 1 }),
          from,
          to,
          total,
          onPrev: state.page > 1 ? () => update({ page: state.page - 1 }) : undefined,
          onNext: state.page < lastPage ? () => update({ page: state.page + 1 }) : undefined,
        }}
        right={
          canEdit ? (
            <button type="button" onClick={() => setDialog({ kind: "setPrice" })} className={`ml-[19px] mr-[9px] bg-[#71ce87] pr-[15px] ${buttonClass}`}>
              <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-white"><path d={ROW_ICONS.dollar} /></svg>
              {t("Добавить цену")}
            </button>
          ) : undefined
        }
      />

      {list.error && <p className="px-[30px] py-3 text-[#e57373]">{t("Не удалось загрузить данные")}: {t(list.error)}</p>}

      <div className={`${kitHead} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
        <span>{sortHeader("id", "Id")}</span>
        <span>{sortHeader("name", "Наименование")}</span>
        <span>{sortHeader("currency", "Валюта")}</span>
        <span>{sortHeader("created_date", "Дата создания")}</span>
        <span>{t("Связанный прайс лист")}</span>
        <span>{t("Метод расчета")}</span>
        <span />
      </div>
      <div className={list.loading && data ? "opacity-60" : undefined}>
        {!rows.length ? (
          list.loading ? <div className="px-[30px] py-10 text-center text-slate-400">{t("Загрузка...")}</div> : list.error ? null : <EmptyRows />
        ) : (
          rows.map((row) => (
            <div key={row.id} className={`${kitRow} px-[30px]`} style={{ gridTemplateColumns: COLUMNS }}>
              <span className="pr-4">{row.id}</span>
              <span className="min-w-0 break-words pr-4">{row.name}</span>
              <span className="pr-4">{row.currency ? currencyLabel(row.currency) : notSet}</span>
              <span className="whitespace-nowrap pr-4">{created(row)}</span>
              <span className="min-w-0 break-words pr-4">{row.connectedPriceList?.name ?? (row.linkedList !== "Не указано" ? row.linkedList : notSet)}</span>
              <span className="pr-4">{t(row.calcMethod)}</span>
              <span />
              {canEdit && (
                <RowActions
                  right={36}
                  extra={
                    <RowIcon
                      path={ROW_ICONS.dollar}
                      label="Установить цену"
                      raw
                      onClick={() => router.push(`/analytics/repricing?openCreateDialog=true&priceListId=${row.id}&currency=${encodeURIComponent(row.currency)}`)}
                    />
                  }
                  onEdit={() => setDialog({ kind: "update", id: row.id })}
                  onDelete={() => setDialog({ kind: "delete", id: row.id, name: row.name })}
                />
              )}
            </div>
          ))
        )}
      </div>

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <PriceListFormDialog
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          priceListId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setMessage({ text: "Успешно сохранено", tone: "success" })
            list.reload()
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <PriceListDeleteDialog
          key={`delete-${dialog.id}`}
          priceList={dialog}
          onClose={closeDialog}
          onDeleted={() => {
            setDialog(null)
            setMessage({ text: "Успешно удалено", tone: "success" })
            list.reload()
          }}
          onFailed={(text) => setMessage({ text, tone: "error" })}
        />
      )}
      {dialog?.kind === "setPrice" && (
        <SetPriceDialog
          onClose={closeDialog}
          onSaved={(text) => {
            setDialog(null)
            setMessage({ text, tone: "success" })
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </section>
  )
}
