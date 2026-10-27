"use client"

import { ArrowDown, ArrowUp, CheckCheck, ChevronLeft, ChevronRight, EyeOff, Loader2, Search, X } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { RefEmpty, RefHeader, RefPage, RefTabs, REF_SHADOW, RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  RESTRICTION_DEFAULT_PAGE_SIZE,
  RESTRICTION_PAGE_SIZES,
  type RestrictionDetail,
  type RestrictionListResponse,
  type RestrictionListRow,
  type RestrictionMode,
  type RestrictionOrdering,
  type RestrictionTab,
} from "@/lib/product-restrictions-types"

import { RestrictionDetailPanel } from "./product-restrictions-detail"
import { RestrictionDialog, type RestrictionDialogMode } from "./product-restrictions-dialog"
import { apiErrorText, DemoCheckbox, rangeOf, TAB_COPY, type ApiErrorBody } from "./product-restrictions-shared"

// "Ограничение продуктов" (demo #/user_product): the employees with the size of their product
// list ("По продуктам") or product type list ("По типам продуктов"); 0 = "Не установлено" (not
// restricted). Rows are selected in checkbox mode and changed in bulk with "Добавить …",
// "Убрать …" and "Стереть и добавить"; a row opens the employee's detail with the pencil
// "Изменение". The list state lives in the URL (?tab=&search=&page=&pageSize=&ordering=&employee=).

type ViewState = {
  tab: RestrictionTab
  search: string
  page: number
  pageSize: number
  ordering: RestrictionOrdering
  employee: number | null
}

const MANAGE_CODES = ["catalog.manage"] as const

function positiveInt(text: string | null, max: number): number | null {
  if (!text || !/^\d{1,10}$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && value <= max ? value : null
}

function stateOf(params: URLSearchParams): ViewState {
  const size = positiveInt(params.get("pageSize"), 1000)
  return {
    tab: params.get("tab") === "product_type" ? "product_type" : "product",
    search: (params.get("search") ?? "").slice(0, 200),
    page: positiveInt(params.get("page"), 1_000_000) ?? 1,
    pageSize: size !== null && (RESTRICTION_PAGE_SIZES as readonly number[]).includes(size) ? size : RESTRICTION_DEFAULT_PAGE_SIZE,
    ordering: params.get("ordering") === "-id" ? "-id" : "id",
    employee: positiveInt(params.get("employee"), 2_147_483_647),
  }
}

function paramsOf(state: ViewState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.tab !== "product") params.set("tab", state.tab)
  if (state.search) params.set("search", state.search)
  if (state.page > 1) params.set("page", String(state.page))
  if (state.pageSize !== RESTRICTION_DEFAULT_PAGE_SIZE) params.set("pageSize", String(state.pageSize))
  if (state.ordering !== "id") params.set("ordering", state.ordering)
  if (state.employee) params.set("employee", String(state.employee))
  return params
}

function SolidIcon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 fill-current`} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const ICON_BOX = "M21 7.5l-9-5.25L3 7.5v9l9 5.25 9-5.25v-9zM12 4.55l5.9 3.45L12 11.45 6.1 8 12 4.55zM5 9.7l6 3.5v6.9l-6-3.5V9.7zm8 10.4v-6.9l6-3.5v6.9l-6 3.5z"
const ICON_SHIELD = "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"

type DialogState = { mode: RestrictionDialogMode; employeeIds: number[]; items?: RestrictionDetail }

export function ProductRestrictionsView() {
  const { t } = useLanguage()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const state = useMemo(() => stateOf(new URLSearchParams(searchParams.toString())), [searchParams])
  const canManage = useCanManage(MANAGE_CODES)

  const [searchText, setSearchText] = useState(state.search)
  const [data, setData] = useState<(RestrictionListResponse & { query: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Map<number, RestrictionListRow>>(() => new Map())
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  // The search box follows the URL (back / forward), but not the search it wrote itself while
  // the user keeps typing.
  const typedSearch = useRef<string | null>(null)
  useEffect(() => {
    if (typedSearch.current === state.search) return
    typedSearch.current = null
    setSearchText(state.search)
  }, [state.search])
  const closeMessage = useCallback(() => setMessage(null), [])

  /** Writes a new state into the URL (useSearchParams follows, no server round-trip). */
  const navigate = useCallback(
    (patch: Partial<ViewState>, mode: "push" | "replace" = "replace") => {
      const next = paramsOf({ ...state, ...patch }).toString()
      const url = `${pathname}${next ? `?${next}` : ""}`
      if (mode === "push") window.history.pushState(null, "", url)
      else window.history.replaceState(null, "", url)
    },
    [state, pathname],
  )

  // Typing searches 400 ms after the last key (Enter at once), from page 1.
  useEffect(() => {
    const text = searchText.trim()
    if (text === state.search) return
    const timer = window.setTimeout(() => {
      typedSearch.current = text
      navigate({ search: text, page: 1 })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [searchText, state.search, navigate])

  const listQuery = useMemo(() => {
    const params = new URLSearchParams({ tab: state.tab, page: String(state.page), pageSize: String(state.pageSize), ordering: state.ordering })
    if (state.search) params.set("search", state.search)
    return params.toString()
  }, [state.tab, state.page, state.pageSize, state.ordering, state.search])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/product-restrictions?${listQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (RestrictionListResponse & ApiErrorBody) | null
        if (controller.signal.aborted) return
        if (!response.ok || !body) throw new Error(apiErrorText(body, "Не удалось загрузить ограничения", t))
        setData({ ...body, query: listQuery })
        setLoadError("")
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setLoadError(reason instanceof Error && reason.message ? reason.message : t("Не удалось загрузить ограничения"))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [listQuery, reloadKey, t])

  // A page beyond the end (rows removed, a stale link) moves to the last one.
  useEffect(() => {
    if (data && data.query === listQuery && data.page !== state.page) navigate({ page: data.page })
  }, [data, listQuery, state.page, navigate])

  const copy = TAB_COPY[state.tab]
  const rows = data?.results ?? []
  const count = data?.count ?? 0
  const page = data?.page ?? state.page
  const pageCount = Math.max(1, Math.ceil(count / state.pageSize))
  const range = rangeOf(page, state.pageSize, count)
  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someOnPage = rows.some((row) => selected.has(row.id))

  function switchTab(label: string) {
    const tab: RestrictionTab = label === TAB_COPY.product_type.tab ? "product_type" : "product"
    if (tab === state.tab) return
    setSelected(new Map())
    navigate({ tab, page: 1 })
  }

  function toggleSelectMode() {
    setSelectMode((current) => !current)
    setSelected(new Map())
  }

  function toggleRow(row: RestrictionListRow, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current)
      if (checked) next.set(row.id, row)
      else next.delete(row.id)
      return next
    })
  }

  function togglePage() {
    setSelected((current) => {
      const next = new Map(current)
      for (const row of rows) {
        if (allOnPage) next.delete(row.id)
        else next.set(row.id, row)
      }
      return next
    })
  }

  function openBulk(mode: RestrictionMode) {
    if (!selected.size) {
      setSelectMode(true)
      setMessage({ text: "Выберите хотя бы одного сотрудника", tone: "error" })
      return
    }
    setDialog({ mode, employeeIds: [...selected.keys()] })
  }

  function saved() {
    setDialog(null)
    setSelected(new Map())
    setReloadKey((key) => key + 1)
    setMessage({ text: "Успешно сохранено", tone: "success" })
  }

  const actionButtons = canManage && (
    <div className="flex flex-wrap items-center gap-[5px]">
      <button
        type="button"
        onClick={() => openBulk("add")}
        className="flex h-9 items-center gap-2 rounded-[3px] bg-[#4db6ac] px-[14px] text-[13px] font-semibold text-white hover:brightness-95"
      >
        <SolidIcon d={ICON_BOX} />
        {t(copy.add)}
      </button>
      <button
        type="button"
        onClick={() => openBulk("remove")}
        className="flex h-9 items-center gap-2 rounded-[3px] bg-[#ff8a65] px-[14px] text-[13px] font-semibold text-white hover:brightness-95"
      >
        <SolidIcon d={RI.trash} />
        {t(copy.remove)}
      </button>
      <button
        type="button"
        onClick={() => openBulk("set")}
        className="flex h-9 items-center gap-2 rounded-[3px] bg-[#4f71dc] px-[14px] text-[13px] font-semibold text-white hover:brightness-95"
      >
        <SolidIcon d={ICON_SHIELD} />
        {t("Стереть и добавить")}
      </button>
    </div>
  )

  const pager = (
    <div className="flex items-center gap-2 whitespace-nowrap text-[13px]">
      <span>
        {range.from} - {range.to} {t("из")} {count}
      </span>
      <button
        type="button"
        onClick={() => navigate({ page: Math.max(1, page - 1) })}
        disabled={page <= 1}
        aria-label={t("Назад")}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-400 text-slate-600 disabled:border-slate-200 disabled:text-slate-300"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => navigate({ page: Math.min(pageCount, page + 1) })}
        disabled={page >= pageCount}
        aria-label={t("Вперед")}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-400 text-slate-600 disabled:border-slate-200 disabled:text-slate-300"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )

  const gridCols = selectMode ? "grid-cols-[44px_minmax(0,4fr)_minmax(0,4fr)_minmax(0,4fr)]" : "grid-cols-[minmax(0,4fr)_minmax(0,4fr)_minmax(0,4fr)]"
  const countOf = (row: RestrictionListRow) => (state.tab === "product" ? row.productCount : row.productTypeCount)

  return (
    <RefPage>
      <RefHeader title="Ограничение продуктов" />

      <section className={`bg-white ${REF_SHADOW}`}>
        <RefTabs labels={[TAB_COPY.product.tab, TAB_COPY.product_type.tab]} value={copy.tab} onChange={switchTab} />

        {state.employee ? (
          <RestrictionDetailPanel
            employeeId={state.employee}
            tab={state.tab}
            reloadKey={reloadKey}
            canManage={canManage}
            onBack={() => navigate({ employee: null }, "push")}
            onEdit={(detail) => setDialog({ mode: "update", employeeIds: [detail.id], items: detail })}
          />
        ) : (
          <>
            {selected.size > 0 ? (
              <div className="flex min-h-[50px] flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#eef0f4] bg-[#f2f5f8] px-4 py-2 sm:px-[30px]">
                <span className="font-semibold">
                  {t("Выбрано")}: {selected.size}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
                  {pager}
                  {actionButtons}
                  <button
                    type="button"
                    onClick={() => setSelected(new Map())}
                    title={t("Снять выделение")}
                    aria-label={t("Снять выделение")}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#5d6474] hover:bg-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[50px] flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#eef0f4] px-4 py-2 sm:px-[30px]">
                <label className="relative flex w-full items-center border-b border-[#e0e0e0] focus-within:border-[#5d6474] sm:w-[300px] lg:ml-[calc(25%-150px)]">
                  <input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      typedSearch.current = searchText.trim()
                      navigate({ search: searchText.trim(), page: 1 })
                    }}
                    maxLength={200}
                    placeholder={t("Поиск")}
                    aria-label={t("Поиск")}
                    className="h-[34px] min-w-0 flex-1 bg-transparent pr-7 text-[13px] outline-none placeholder:text-black/30"
                  />
                  <Search className="absolute right-1 h-[18px] w-[18px] text-[#c4cad4]" />
                </label>
                <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
                  <select
                    value={state.pageSize}
                    onChange={(event) => navigate({ pageSize: Number(event.target.value), page: 1 })}
                    aria-label={t("Количество строк")}
                    className="h-8 bg-transparent text-[13px] outline-none"
                  >
                    {RESTRICTION_PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  {pager}
                  {canManage && (
                    <button
                      type="button"
                      onClick={toggleSelectMode}
                      title={t(selectMode ? "Спрятать флажки" : "Выбрать из списка")}
                      aria-label={t(selectMode ? "Спрятать флажки" : "Выбрать из списка")}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[#333] hover:bg-[#f2f5f8]"
                    >
                      {selectMode ? <EyeOff className="h-6 w-6" /> : <SolidIcon d={RI.checklist} className="h-6 w-6" />}
                    </button>
                  )}
                  {actionButtons}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <div className="min-w-[480px]">
                <div className={`grid h-[50px] items-center bg-[#5d6474] font-bold text-white ${gridCols}`}>
                  {selectMode && (
                    <button
                      type="button"
                      onClick={togglePage}
                      disabled={!rows.length}
                      title={t("Выбрать все")}
                      aria-label={t("Выбрать все")}
                      className={`flex h-full items-center justify-center ${someOnPage ? "text-white" : "text-white/70"}`}
                    >
                      <CheckCheck className="h-5 w-5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate({ ordering: state.ordering === "id" ? "-id" : "id", page: 1 })}
                    className="flex items-center gap-1 pl-4 text-left sm:pl-[30px]"
                  >
                    №{state.ordering === "-id" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                  </button>
                  <span className="pl-4 sm:pl-[30px]">{t("Сотрудник")}</span>
                  <span className="pl-4 sm:pl-[30px]">{t(copy.count)}</span>
                </div>

                {loading && !data ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-[#586174]">
                    <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
                  </div>
                ) : loadError ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center text-[#586174]">
                    <p className="text-[#e53935]">{loadError}</p>
                    <button
                      type="button"
                      onClick={() => setReloadKey((key) => key + 1)}
                      className="rounded-md border border-[#4f70e7] px-4 py-2 font-semibold text-[#4f70e7]"
                    >
                      {t("Повторить")}
                    </button>
                  </div>
                ) : rows.length === 0 ? (
                  <RefEmpty text="По вашему запросу ничего не найдено" />
                ) : (
                  rows.map((row) => {
                    const amount = countOf(row)
                    return (
                      <div
                        key={row.id}
                        role="link"
                        tabIndex={0}
                        onClick={() => navigate({ employee: row.id }, "push")}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") navigate({ employee: row.id }, "push")
                        }}
                        className={`grid min-h-[50px] cursor-pointer items-center border-b border-dashed border-[#dfe3ea] hover:bg-[#f8f9fb] ${gridCols} ${loading ? "opacity-60" : ""}`}
                      >
                        {selectMode && (
                          <span className="flex justify-center" onClick={(event) => event.stopPropagation()}>
                            <DemoCheckbox checked={selected.has(row.id)} onChange={(checked) => toggleRow(row, checked)} label={row.name} />
                          </span>
                        )}
                        <span className="pl-4 sm:pl-[30px]">{row.id}</span>
                        <span className="break-words pl-4 text-[#4a6ee0] sm:pl-[30px]">
                          {row.name}
                          {!row.active && <span className="ml-2 text-[12px] text-[#9e9e9e]">{t("Неактивный")}</span>}
                        </span>
                        <span className={`pl-4 sm:pl-[30px] ${amount === 0 ? "text-[#9e9e9e]" : ""}`}>{amount === 0 ? t("Не установлено") : amount}</span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {dialog && (
        <RestrictionDialog
          tab={state.tab}
          mode={dialog.mode}
          employeeIds={dialog.employeeIds}
          initialItems={dialog.items ? (state.tab === "product" ? dialog.items.products : dialog.items.productTypes) : []}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}

      <CashSnackbar message={message} onClose={closeMessage} />
    </RefPage>
  )
}
