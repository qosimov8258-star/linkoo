"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { ArrowDown, ArrowLeftRight, ArrowUp, Banknote, Clock, CreditCard, FileSpreadsheet, Filter, HandCoins, Loader2, Pencil, Search, X } from "lucide-react"

import { BALANCE_PAGE_SIZES, BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, cashMutate, useCashboxes, useCashOperations, useCashTotals, useUnverifiedCount } from "@/components/analytics/cash/use-cash"
import { CashAcceptDialog } from "@/components/analytics/cash-management-accept-dialog"
import { CashAcceptanceEditDialog, CashAcceptanceInfoDialog } from "@/components/analytics/cash-management-acceptance-dialog"
import { OperationDetails, OperationPopupDialog, type DetailsPopup } from "@/components/analytics/cash-management-details"
import { CashFilterPanel, EMPTY_FILTERS, countFilters, filtersToQuery, filtersToUrl, readFilters, type CashFilters } from "@/components/analytics/cash-management-filter"
import { CashGroupIncomeDialog } from "@/components/analytics/cash-management-group-income-dialog"
import { CashOperationDialog, type OperationDialogState } from "@/components/analytics/cash-management-operation-dialog"
import { CashReceiptPrint } from "@/components/analytics/cash-management-receipt"
import { CashRequestsDialog } from "@/components/analytics/cash-management-requests-dialog"
import { CashRowMenu } from "@/components/analytics/cash-management-row-menu"
import {
  CASH_GREEN,
  CASH_RED,
  CashAmount,
  CashSnackbar,
  ConfirmDialog,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  cashCommentText,
  excelDay,
  excelTime,
  formatCash,
  mutationError,
  useCanWrite,
  type SnackbarMessage,
} from "@/components/analytics/cash-management-shared"
import { CashTransferDialog } from "@/components/analytics/cash-management-transfer-dialog"
import { CashUnverifiedDialog } from "@/components/analytics/cash-management-unverified-dialog"
import { docDate } from "@/components/analytics/internal-transfers-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import type { CashboxWithBalance, CashListResult, CashOperation, MoneyRequest } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Управления кассой" (demo #/transaction, "Kassani boshqarish"): cashboxes
// with their ledger balances on the left (= "Баланс кассы"), the operations of
// the selected cashbox ("Общий объем" = all) on the right — server-side list
// with filters, search, sorting, paging and per-currency totals — and every
// cash dialog: Принять деньги, Групповой приход, Приход, Расход, Перевод,
// Запрос средств, unverified transactions (clock badge, polled every 5 s), the
// row menu (Изменить / Дублировать / Печать / Удалить) and the receipt.
// Everything goes through the cash core (/api/cash/**, components/analytics/cash/use-cash.ts).
// URL state as in the demo: ?cashboxId&currency, filter keys, search, ordering, page, pageSize.

type UrlValue = string | number | string[] | null | undefined

const PAGE_SIZES = BALANCE_PAGE_SIZES.filter((size) => size <= 500)
const DEFAULT_PAGE_SIZE = 25
const SORTABLE = ["id", "date", "amount"] as const

/** URL query state (demo hashHistory.push); pushState keeps useSearchParams in sync without a server round trip. */
function useUrlState() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const update = useCallback(
    (changes: Record<string, UrlValue>, replaceAll = false) => {
      const params = replaceAll ? new URLSearchParams() : new URLSearchParams(window.location.search)
      for (const [name, value] of Object.entries(changes)) {
        params.delete(name)
        if (Array.isArray(value)) value.filter(Boolean).forEach((item) => params.append(name, item))
        else if (value !== null && value !== undefined && value !== "") params.set(name, String(value))
      }
      const query = params.toString()
      window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [pathname],
  )
  return { searchParams, update }
}

type TopDialog =
  | { kind: "operation"; state: OperationDialogState }
  | { kind: "transfer" }
  | { kind: "group" }
  | { kind: "acceptanceInfo"; id: number }
  | { kind: "acceptanceEdit"; id: number }
type Panel = "accept" | "requests" | "unverified"

export function CashManagementView() {
  return (
    <Suspense fallback={null}>
      <CashManagementContent />
    </Suspense>
  )
}

function CashManagementContent() {
  const { t, language } = useLanguage()
  const { searchParams, update } = useUrlState()
  const urlState = searchParams.toString()
  const params = useMemo(() => new URLSearchParams(urlState), [urlState])
  const get = (name: string) => params.get(name) ?? ""

  // --- URL state ------------------------------------------------------------------
  const selectedId = Math.max(0, Math.floor(Number(get("cashboxId"))) || 0)
  const filters = useMemo(() => readFilters(params), [params])
  const filterCount = countFilters(filters)
  const search = get("search").trim()
  const page = Math.max(1, Math.floor(Number(get("page"))) || 1)
  const pageSize = (PAGE_SIZES as readonly number[]).includes(Number(get("pageSize"))) ? Number(get("pageSize")) : DEFAULT_PAGE_SIZE
  const orderingParam = get("ordering")
  const ordering = SORTABLE.some((field) => orderingParam === field || orderingParam === `-${field}`) ? orderingParam : "-id"

  // --- data -----------------------------------------------------------------------
  const canWrite = useCanWrite()
  const cashboxesState = useCashboxes()
  const cashboxes = useMemo(() => cashboxesState.data?.cashboxes ?? [], [cashboxesState.data])
  const selected = cashboxes.find((box) => box.id === selectedId) ?? null
  const baseQuery = useMemo(() => ({ ...filtersToQuery(filters), cashbox: selectedId ? [selectedId] : filters.cashbox, search: search || filters.transaction }), [filters, selectedId, search])
  const list = useCashOperations({ ...baseQuery, ordering, page, pageSize })
  const totals = useCashTotals(baseQuery, filterCount > 0)
  const unverified = useUnverifiedCount()
  const rows = list.data?.rows ?? []

  // --- local UI state ---------------------------------------------------------------
  const [filterOpen, setFilterOpen] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [dialog, setDialog] = useState<TopDialog | null>(null)
  const [popup, setPopup] = useState<DetailsPopup | null>(null)
  const [printing, setPrinting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<CashOperation | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const [snack, setSnack] = useState<SnackbarMessage | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [exporting, setExporting] = useState(false)

  // Search box: local draft, pushed to the URL after a short pause.
  const [searchDraft, setSearchDraft] = useState(search)
  const [lastSearch, setLastSearch] = useState(search)
  if (search !== lastSearch) {
    setLastSearch(search)
    setSearchDraft(search)
  }
  useEffect(() => {
    if (searchDraft.trim() === search) return
    const timer = window.setTimeout(() => update({ search: searchDraft.trim() || null, page: null }), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, search, update])

  const closeSnack = useCallback(() => setSnack(null), [])
  const notify = (text: string, tone: SnackbarMessage["tone"] = "success") => setSnack({ text, tone })

  /** Demo: after every save the list and the cashbox balances are refetched. */
  const reloadAll = () => {
    list.reload()
    cashboxesState.reload()
    totals.reload()
    unverified.reload()
    setRefreshToken((value) => value + 1)
  }

  // --- actions ---------------------------------------------------------------------
  const selectCashbox = (box: CashboxWithBalance | null) => {
    // Demo handleClickCashbox: the URL becomes ?cashboxId&currency, every other param is dropped.
    setFilterOpen(false)
    if (box) update({ cashboxId: box.id, currency: box.currency }, true)
    else update({}, true)
  }

  const applyFilters = (next: CashFilters) => {
    update({ ...filtersToUrl(next), page: null })
    setFilterOpen(false)
  }

  const sortBy = (field: (typeof SORTABLE)[number]) => update({ ordering: ordering === `-${field}` ? field : `-${field}`, page: null })

  const openOperation = (state: OperationDialogState) => setDialog({ kind: "operation", state })

  const editOperation = (operation: CashOperation) => {
    if (operation.type === 8) return setDialog({ kind: "acceptanceEdit", id: operation.id })
    openOperation({ kind: operation.amount < 0 ? "expense" : "income", mode: "edit", operationKey: operation.key })
  }

  const duplicateOperation = (operation: CashOperation) => openOperation({ kind: operation.amount < 0 ? "expense" : "income", mode: "duplicate", operationKey: operation.key })

  const payRequest = (request: MoneyRequest) => openOperation({ kind: "expense", mode: "pay", request })

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    const result = await cashMutate("DELETE", `/api/cash/operations/${encodeURIComponent(deleting.key)}`)
    setDeleteBusy(false)
    if (!result.ok) {
      setDeleteError(result.status === 409 ? `${t("Удаление невозможно из-за связи с другими данными")}: ${mutationError(result, t)}` : mutationError(result, t))
      return
    }
    setDeleting(null)
    reloadAll()
    notify("Успешно удалено")
  }

  const exportExcel = async () => {
    setExporting(true)
    try {
      const response = await fetch(`/api/cash/operations?${buildCashQuery({ ...baseQuery, ordering, page: 1, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as CashListResult | null
      if (!response.ok || !body) throw new Error((body as { error?: string } | null)?.error || `HTTP ${response.status}`)
      const header = ["№", "Кассир", "Описание", "Филиал", "Организация", "Детали", "Указанная дата", "Время", "Дата создания", "Время", "Сумма", "Валюта", "Категория прихода", "Категория расхода", "Клиент", "Поставщик"].map((label) => t(label))
      const lines = body.rows.map((row) => {
        const categoryKind = row.category?.kind || (row.amount < 0 ? "expense" : "income")
        return [
          row.docNo,
          row.cashbox.name,
          excelDescription(row, t),
          row.branch,
          row.organization,
          cashCommentText(row.comment, t),
          excelDay(row.date),
          excelTime(row.date),
          excelDay(row.createdAt),
          excelTime(row.createdAt),
          row.amount,
          currencyLabel(row.currency),
          categoryKind === "income" ? (row.category?.name ?? "") : "",
          categoryKind === "expense" ? (row.category?.name ?? "") : "",
          row.client?.name ?? "",
          row.supplier?.name ?? "",
        ]
      })
      downloadExcelTable(t("Транзакции"), [header, ...lines])
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason), "error")
    } finally {
      setExporting(false)
    }
  }

  const title = selected ? selected.name : selectedId && !cashboxesState.data ? "" : t("Общий объем")
  const showCashbox = !selectedId

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[60px] flex-wrap items-center gap-3 pl-[28px] pr-[37px]">
        <div className="flex min-w-0 items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <h1 className="truncate text-[18px] font-bold text-[#5d6474]">{t("Управления кассой")}</h1>
        </div>
        {canWrite && (
          <div className="ml-auto flex flex-wrap items-center gap-[19px]">
            <HeaderButton tone="green" icon={Banknote} label={t("Принять деньги")} onClick={() => setPanel("accept")} />
            <HeaderButton tone="blue" icon={CreditCard} label={t("Групповой приход")} onClick={() => setDialog({ kind: "group" })} />
            {/* The cashbox selected on the left is preselected in the dialog (with its branch). */}
            <HeaderButton tone="blue" icon={CreditCard} label={t("Приход")} onClick={() => openOperation({ kind: "income", mode: "create", cashboxId: selectedId || undefined })} />
            <HeaderButton tone="red" icon={CreditCard} label={t("Расход")} onClick={() => openOperation({ kind: "expense", mode: "create", cashboxId: selectedId || undefined })} />
          </div>
        )}
      </header>

      <div className="flex flex-col gap-5 pb-5 pr-[30px] pt-[7px] md:flex-row md:gap-[28px]">
        {/* --- left: cashboxes --- */}
        <aside className="w-full md:w-[250px] md:shrink-0">
          <h2 className="mb-[11px] h-[22px] pl-[30px] text-[13px] font-bold leading-[22px] text-[#333]">{t("Кассы")}</h2>
          <div className="max-h-[280px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] md:max-h-none">
            <button type="button" onClick={() => selectCashbox(null)} className={`block h-[61px] w-full border-b border-[#eef1f5] px-[30px] py-[13px] text-left hover:bg-[#f2f5f8] ${!selectedId ? "bg-[#f4f8fa]" : ""}`}>
              <span className="block text-[13px] font-semibold text-[#333]">{t("Общий объем")}</span>
              <span className="block text-[10px] text-[#9aa3b6]">{t("во всех кассах")}</span>
            </button>
            {cashboxesState.loading && !cashboxesState.data && <LoadingBlock className="py-6" />}
            {cashboxesState.error && <ErrorBlock error={cashboxesState.error} onRetry={cashboxesState.reload} className="py-4" />}
            {cashboxes.map((box) => (
              <button
                key={box.id}
                type="button"
                onClick={() => selectCashbox(box)}
                className={`block h-[63px] w-full border-b border-[#eef1f5] px-[30px] pb-[11px] pt-[15px] text-left hover:bg-[#f2f5f8] ${box.id === selectedId ? "bg-[#f4f8fa]" : ""}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span data-no-translate className="max-w-[186px] break-words text-[13px] font-semibold leading-[16px] text-[#333]" title={box.name}>
                    {box.name}
                  </span>
                  {box.type === "bank" ? (
                    <span title={t("банковский счет")} aria-label={t("банковский счет")}>
                      <CreditCard className="h-[18px] w-[18px] shrink-0 text-[#6261b0]" />
                    </span>
                  ) : (
                    <span title={t("наличные")} aria-label={t("наличные")}>
                      <Banknote className="h-[18px] w-[18px] shrink-0 text-[#4f71dc]" />
                    </span>
                  )}
                </span>
                <span className="block text-[13px] leading-[16px]" style={{ color: box.balance < 0 ? CASH_RED : CASH_GREEN }}>
                  {formatCash(box.balance, box.currency)}
                </span>
              </button>
            ))}
            {cashboxesState.data && !cashboxes.length && <p className="px-4 py-4 text-[13px] text-[#9aa3b6]">{t("Кассы не найдены")}</p>}
          </div>
        </aside>

        {/* --- right: operations --- */}
        <section className="min-w-0 flex-1">
          <div className="mb-[10px] flex flex-wrap items-center gap-3">
            <h2 className="mr-auto min-w-0 truncate text-[13px] font-bold leading-[22px] text-[#333]">{title}</h2>
            {canWrite && (
              <button type="button" disabled={cashboxes.length < 2} onClick={() => setDialog({ kind: "transfer" })} className="inline-flex h-[24px] items-center gap-1.5 border border-[#4f71dc] px-[11px] text-[13px] text-[#4f71dc] hover:bg-[#f2f5f8] disabled:opacity-40">
                {t("Перевод")}
              </button>
            )}
            <button type="button" onClick={() => setPanel("requests")} className="inline-flex h-[24px] items-center gap-1.5 border border-[#8acb8d] px-[11px] text-[13px] text-[#8acb8d] hover:bg-[#f2f5f8]">
              {t("Запрос средств")}
            </button>
            <button type="button" onClick={() => setPanel("unverified")} title={t("Неподтвержденные транзакции")} aria-label={t("Неподтвержденные транзакции")} className="relative flex h-6 w-6 items-center justify-center text-[#586174]">
              <Clock className="h-6 w-6" strokeWidth={1.6} />
              {(unverified.data?.count ?? 0) > 0 && (
                <span className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-[#e57373] px-1.5 text-center text-[11px] font-bold leading-5 text-white">{unverified.data?.count}</span>
              )}
            </button>
          </div>

          <section className="relative rounded-[2px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {filterCount > 0 && totals.data && totals.data.totals.length > 0 && (
              <div className="flex flex-col gap-1 rounded-t-md bg-[#5869f0] px-4 py-2.5 text-[13px] text-white md:px-5">
                {totals.data.totals.map((row) => (
                  <div key={row.currency} className="flex flex-wrap gap-x-6 gap-y-0.5">
                    <span>
                      {t("Общая сумма")}: <b>{formatCash(row.total, row.currency)}</b>
                    </span>
                    <span>
                      {t("Приход")}: <b>{formatCash(row.income, row.currency)}</b>
                    </span>
                    <span>
                      {t("Расход")}: <b>{formatCash(row.outcome, row.currency)}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex h-[50px] flex-wrap items-center gap-3 px-[5px]">
              {filterCount ? (
                <span className="inline-flex h-9 items-center gap-3 rounded-md bg-[#eef1f5] px-3 text-[14px] font-semibold text-[#586174]">
                  {t("Фильтр")}: {filterCount} {t("элемента")}
                  <button type="button" onClick={() => setFilterOpen((value) => !value)} aria-label={t("Изменить")} className="text-[#4f70e7]">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterOpen(false)
                      update({ ...filtersToUrl(EMPTY_FILTERS), page: null })
                    }}
                    aria-label={t("Очистить")}
                    className="text-[#e57373]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex w-[310px] shrink-0 items-center gap-1 text-[13px] text-[#4f71dc] hover:underline">
                  {t("Показать фильтр")}
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#4f71dc]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
                </button>
              )}
              <label className="relative ml-[2px] w-full sm:w-[272px]">
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder={t("Поиск")}
                  className="h-9 w-full border-b border-[#dbe0e8] bg-transparent pr-8 text-[13px] outline-none focus:border-[#4f70e7]"
                />
                <Search className="pointer-events-none absolute right-1 top-2 h-5 w-5 text-[#c4cbd6]" />
              </label>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <BalancePagination page={page} pageSize={pageSize} count={list.data?.count ?? 0} sizes={PAGE_SIZES} onChange={(next) => update({ page: next.page > 1 ? next.page : null, pageSize: next.pageSize !== DEFAULT_PAGE_SIZE ? next.pageSize : null })} />
                <button type="button" onClick={exportExcel} disabled={exporting || !list.data?.count} aria-label={t("Скачать Excel")} title={t("Скачать Excel")} className="text-[#333] hover:opacity-80 disabled:opacity-40">
                  {exporting ? <Loader2 className="h-6 w-6 animate-spin" /> : <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>}
                </button>
              </div>
            </div>

            {filterOpen && <CashFilterPanel value={filters} cashboxes={cashboxes} onApply={applyFilters} onClose={() => setFilterOpen(false)} />}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] table-fixed text-left text-[13px]">
                <thead>
                  <tr className="h-[50px] bg-[#5d6474] text-white">
                    <SortHeader label="№" field="id" ordering={ordering} onSort={sortBy} className="w-[135px] pl-[38px]" />
                    <th className="w-[594px] px-3 py-3 text-[13px] font-bold">{t("Детали")}</th>
                    <SortHeader label={t("Указанная дата")} field="date" ordering={ordering} onSort={sortBy} className="w-[200px]" />
                    <SortHeader label={t("Сумма")} field="amount" ordering={ordering} onSort={sortBy} className="w-[195px]" align="right" />
                    <th className="w-[70px] px-2 py-3" />
                  </tr>
                </thead>
                <tbody className={list.loading && list.data ? "opacity-60" : ""}>
                  {rows.map((operation) => (
                    <tr
                      key={operation.key}
                      className={`h-[50px] border-b border-dashed border-[#d8dee7] align-middle ${operation.isDeleted ? "bg-[#fffafa]" : "hover:bg-[#f2f5f8]"}`}
                      style={operation.isDeleted ? { boxShadow: `inset 3px 0 0 ${CASH_RED}` } : undefined}
                    >
                      <td className={`py-[4.5px] pl-[38px] pr-3 font-semibold ${operation.isDeleted ? "opacity-60" : ""}`}>{operation.docNo}</td>
                      <td className={`px-3 py-[4.5px] ${operation.isDeleted ? "opacity-60" : ""}`}>
                        <OperationDetails operation={operation} showCashbox={showCashbox} onOpenAcceptance={(row) => setDialog({ kind: "acceptanceInfo", id: row.id })} onPopup={setPopup} />
                      </td>
                      <td className={`px-3 py-[4.5px] whitespace-nowrap text-[13px] ${operation.isDeleted ? "opacity-60" : ""}`}>{docDate(operation.date, language, true)}</td>
                      <td className={`px-3 py-[4.5px] ${operation.isDeleted ? "opacity-60" : ""}`}>
                        <CashAmount operation={operation} />
                      </td>
                      <td className="px-2 py-0 text-right">
                        {!operation.isDeleted && (
                          <CashRowMenu
                            operation={operation}
                            canWrite={canWrite}
                            onEdit={() => editOperation(operation)}
                            onDuplicate={() => duplicateOperation(operation)}
                            onPrint={() => setPrinting(operation.key)}
                            onDelete={() => {
                              setDeleteError("")
                              setDeleting(operation)
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.loading && !list.data && <LoadingBlock />}
            {list.error && <ErrorBlock error={list.error} onRetry={list.reload} />}
            {list.data && !rows.length && !list.error && <EmptyBlock text={list.loading ? "Загрузка..." : "По вашему запросу ничего не найдено"} />}
          </section>
        </section>
      </div>

      {/* --- panels (can open a dialog on top) --- */}
      {panel === "accept" && <CashAcceptDialog cashboxes={cashboxes} canWrite={canWrite} onClose={() => setPanel(null)} onSaved={(message) => {
            reloadAll()
            notify(message)
          }} />}
      {panel === "requests" && <CashRequestsDialog canWrite={canWrite} refreshToken={refreshToken} onClose={() => setPanel(null)} onPay={payRequest} onChanged={(message) => {
            reloadAll()
            notify(message)
          }} />}
      {panel === "unverified" && (
        <CashUnverifiedDialog
          canWrite={canWrite}
          refreshToken={refreshToken}
          onClose={() => setPanel(null)}
          onEdit={editOperation}
          onDelete={(operation) => {
            setDeleteError("")
            setDeleting(operation)
          }}
          onVerified={() => {
            reloadAll()
            notify("Транзакция успешно подтверждено")
          }}
          onPopup={setPopup}
        />
      )}

      {/* --- dialogs --- */}
      {dialog?.kind === "operation" && (
        <CashOperationDialog
          key={`${dialog.state.mode}-${dialog.state.kind}-${dialog.state.operationKey ?? dialog.state.request?.id ?? ""}`}
          state={dialog.state}
          cashboxes={cashboxes}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reloadAll()
            notify("Успешно сохранено")
          }}
        />
      )}
      {dialog?.kind === "transfer" && (
        <CashTransferDialog
          fromCashbox={selected}
          cashboxes={cashboxes}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reloadAll()
            notify("Успешно сохранено")
          }}
        />
      )}
      {dialog?.kind === "group" && (
        <CashGroupIncomeDialog
          cashboxes={cashboxes}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reloadAll()
            notify("Успешно сохранено")
          }}
        />
      )}
      {dialog?.kind === "acceptanceInfo" && <CashAcceptanceInfoDialog id={dialog.id} canWrite={canWrite} onClose={() => setDialog(null)} onChanged={(message) => {
            reloadAll()
            notify(message)
          }} />}
      {dialog?.kind === "acceptanceEdit" && (
        <CashAcceptanceEditDialog
          id={dialog.id}
          cashboxes={cashboxes}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reloadAll()
            notify("Успешно сохранено")
          }}
        />
      )}
      {popup && <OperationPopupDialog popup={popup} onClose={() => setPopup(null)} />}
      {deleting && (
        <ConfirmDialog title={`${t("Транзакция")} №${deleting.docNo}`} text={t("Удалить транзакцию?")} busy={deleteBusy} error={deleteError} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />
      )}
      {printing && <CashReceiptPrint operationKey={printing} onClose={() => setPrinting(null)} />}
      <CashSnackbar message={snack} onClose={closeSnack} />
    </main>
  )
}

function HeaderButton({ tone, icon: Icon, label, onClick }: { tone: "green" | "blue" | "red"; icon: typeof CreditCard; label: string; onClick: () => void }) {
  const color = { green: "bg-[#71ce87]", blue: "bg-[#4f71dc]", red: "bg-[#fa8072]" }[tone]
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-[30px] items-center gap-2 rounded-[4px] px-[14px] text-[13px] font-semibold text-white hover:brightness-95 ${color}`}>
      <Icon className="h-[18px] w-[18px]" /> {label}
    </button>
  )
}

function SortHeader({
  label,
  field,
  ordering,
  onSort,
  className = "",
  align = "left",
}: {
  label: string
  field: (typeof SORTABLE)[number]
  ordering: string
  onSort: (field: (typeof SORTABLE)[number]) => void
  className?: string
  align?: "left" | "right"
}) {
  const active = (ordering === field || ordering === `-${field}`) && ordering !== "-id"
  const Icon = ordering === field ? ArrowUp : ArrowDown
  return (
    <th className={`px-3 py-3 text-[13px] font-bold ${align === "right" ? "text-right" : ""} ${className}`}>
      <button type="button" onClick={() => onSort(field)} className={`inline-flex items-center gap-1 hover:text-[#17233b] ${active ? "text-[#17233b]" : ""}`}>
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "" : "opacity-0"}`} />
      </button>
    </th>
  )
}

/** "Описание" column of the Excel export (demo 3840 excelFormatterPath). */
function excelDescription(row: CashOperation, t: (text: string) => string): string {
  const client = row.client?.name ?? ""
  switch (row.type) {
    case 1:
      return t("Перевод с кассы")
    case 2:
      return `${t("Перевод с")} ${row.transfer?.otherCashbox ?? ""}`.trim()
    case 3:
      return `${client} ${t("Заказ")} № ${row.orderId ?? ""}`.trim()
    case 6:
      return `${t("Приход на счет клиента")} ${client}`.trim()
    case 8:
      return `${t("Приемка наличных с агента")} ${row.employee?.name ?? ""}`.trim()
    case 22:
      return `${t("Выдача денег для кэшбека")} ${client}`.trim()
    case 9:
      return t("Доп. расход")
    default:
      return t(row.title)
  }
}
