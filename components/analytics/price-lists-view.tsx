"use client"

import { ArrowDown, ArrowUp, DollarSign, Pencil, Plus, Search, Trash2 } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
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
// прайс лист | Метод расчета (+ Порядок, Активный, По умолчанию для заказа); hover actions
// "Установить цену" (→ Переоценка create dialog with this list and currency, as in the demo),
// "Изменить", "Удалить". State in the URL: ?search, ?page, ?pageSize, ?ordering,
// ?openCreateDialog=true, ?priceList=<id>&openUpdateDialog | openDeleteDialog, ?openSetPrice=true.

type ViewState = { search: string; ordering: string; page: number; pageSize: number }
type DialogState = { kind: "create" } | { kind: "update"; id: number } | { kind: "delete"; id: number; name: string } | { kind: "setPrice" } | null

const SORTABLE = new Set(["id", "name", "currency", "created_date", "position"])

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

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    update({ search: searchDraft.trim(), page: 1 })
  }

  const notSet = t("Не указано")
  const created = (row: PriceList) => (row.createdAt ? formatStatementDate(row.createdAt, language, false).replace(/\s*г\.$/, "") : row.createdDate)
  const sortHeader = (field: string, label: string) => (
    <button
      type="button"
      onClick={() => update({ ordering: state.ordering === field ? `-${field}` : state.ordering === `-${field}` ? "" : field, page: 1 })}
      className="inline-flex items-center gap-1 font-semibold"
    >
      {t(label)}
      {state.ordering === field ? <ArrowUp className="h-4 w-4" /> : state.ordering === `-${field}` ? <ArrowDown className="h-4 w-4" /> : null}
    </button>
  )
  const th = "px-3 py-4 text-left font-semibold"
  const td = "px-3 py-4"

  return (
    <section className="min-w-0 flex-1 px-6 pb-6 pt-4 lg:px-9">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {canEdit && (
          <button type="button" onClick={() => setDialog({ kind: "create" })} className="inline-flex h-[30px] items-center gap-1.5 rounded-sm bg-[#4f71dc] px-3 text-[14px] font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> {t("Добавить прайс-лист")}
          </button>
        )}
        <form onSubmit={submitSearch} className="relative mx-auto w-full max-w-[300px]">
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
          <button type="submit" aria-label={t("Поиск")} className="absolute right-1 top-1.5 text-slate-300 hover:text-[#4f70e7]">
            <Search className="h-5 w-5" />
          </button>
        </form>
        <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={(next) => update({ page: next.page, pageSize: next.pageSize })} />
        {canEdit && (
          <button type="button" onClick={() => setDialog({ kind: "setPrice" })} className="inline-flex h-[30px] items-center gap-1.5 rounded-sm bg-[#71ce87] px-3 text-[14px] font-semibold text-white hover:brightness-95">
            <DollarSign className="h-4 w-4" /> {t("Добавить цену")}
          </button>
        )}
      </div>

      {list.error && <p className="py-3 text-[#e57373]">{t("Не удалось загрузить данные")}: {t(list.error)}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className={`${th} w-[70px] pl-6`}>{sortHeader("id", "Id")}</th>
              <th className={th}>{sortHeader("name", "Наименование")}</th>
              <th className={th}>{sortHeader("currency", "Валюта")}</th>
              <th className={th}>{sortHeader("created_date", "Дата создания")}</th>
              <th className={th}>{t("Связанный прайс лист")}</th>
              <th className={th}>{t("Метод расчета")}</th>
              <th className={`${th} text-center`}>{sortHeader("position", "Порядок")}</th>
              <th className={`${th} text-center`}>{t("Активный")}</th>
              <th className={`${th} text-center`}>{t("По умолчанию для заказа")}</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody className={list.loading && data ? "opacity-60" : undefined}>
            {!rows.length ? (
              <MessageRow>{list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}</MessageRow>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className={`${td} pl-6`}>{row.id}</td>
                  <td className={`${td} max-w-[260px] truncate font-medium`} title={row.name}>
                    {row.name}
                  </td>
                  <td className={td}>{row.currency ? currencyLabel(row.currency) : notSet}</td>
                  <td className={`${td} whitespace-nowrap`}>{created(row)}</td>
                  <td className={td}>{row.connectedPriceList?.name ?? (row.linkedList !== "Не указано" ? row.linkedList : notSet)}</td>
                  <td className={td}>{t(row.calcMethod)}</td>
                  <td className={`${td} text-center`}>{row.position}</td>
                  <td className={`${td} text-center`}>
                    <Dot on={row.isActive} title={row.isActive ? t("Да") : t("Нет")} />
                  </td>
                  <td className={`${td} text-center`}>{row.isDefaultForOrder ? <Dot on title={t("Да")} /> : <span className="text-slate-300">—</span>}</td>
                  <td className={td}>
                    {canEdit && (
                      <div className="flex items-center justify-end gap-3 text-[#666] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <Link
                          href={`/analytics/repricing?openCreateDialog=true&priceListId=${row.id}&currency=${encodeURIComponent(row.currency)}`}
                          title={t("Установить цену")}
                          aria-label={t("Установить цену")}
                          className="hover:text-[#4f70e7]"
                        >
                          <DollarSign className="h-5 w-5" />
                        </Link>
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

function Dot({ on, title }: { on: boolean; title: string }) {
  return <span className="inline-block h-3.5 w-3.5 rounded-full align-middle" style={{ background: on ? "rgb(129, 199, 132)" : "#f44336" }} title={title} />
}

function MessageRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={10} className="px-9 py-10 text-center text-slate-400">
        {children}
      </td>
    </tr>
  )
}
