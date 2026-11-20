"use client"

import { ArrowDown, ArrowUp, CheckCheck, EyeOff, Loader2, Search, X } from "lucide-react"
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
// "Изменение". The list state lives in the URL with Linko's names (?showTab=&search=&page=&pageSize=&ordering=
// &showCheckboxes=true, plus ?employee= for the detail; the older ?tab= is still read). Linko leaves the list
// unsorted until № is clicked (ordering=id ↓, -id ↑); the API then orders by id.

type ViewState = {
  tab: RestrictionTab
  search: string
  page: number
  pageSize: number
  /** "" = Linko's default: no ordering sent, no arrow on №. */
  ordering: RestrictionOrdering | ""
  employee: number | null
  /** Linko's checkbox mode (?showCheckboxes=true). */
  checkboxes: boolean
}

const MANAGE_CODES = ["catalog.manage"] as const

function positiveInt(text: string | null, max: number): number | null {
  if (!text || !/^\d{1,10}$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && value <= max ? value : null
}

function stateOf(params: URLSearchParams): ViewState {
  const size = positiveInt(params.get("pageSize"), 1000)
  const ordering = params.get("ordering")
  return {
    tab: (params.get("showTab") ?? params.get("tab")) === "product_type" ? "product_type" : "product",
    search: (params.get("search") ?? "").slice(0, 200),
    page: positiveInt(params.get("page"), 1_000_000) ?? 1,
    pageSize: size !== null && (RESTRICTION_PAGE_SIZES as readonly number[]).includes(size) ? size : RESTRICTION_DEFAULT_PAGE_SIZE,
    ordering: ordering === "-id" || ordering === "id" ? ordering : "",
    employee: positiveInt(params.get("employee"), 2_147_483_647),
    checkboxes: params.get("showCheckboxes") === "true",
  }
}

function paramsOf(state: ViewState): URLSearchParams {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.tab !== "product") params.set("showTab", state.tab)
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.checkboxes) params.set("showCheckboxes", "true")
  if (state.employee) params.set("employee", String(state.employee))
  return params
}

/** Linko's sort cycle of №: none → id (↓) → -id (↑) → id … */
function nextOrdering(current: ViewState["ordering"]): RestrictionOrdering {
  return current === "id" ? "-id" : "id"
}

function SolidIcon({ d, className = "h-[18px] w-[18px]" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0 fill-current`} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const ARROW_PREV = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z"
const ARROW_NEXT = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z"
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
    const params = new URLSearchParams({ tab: state.tab, page: String(state.page), pageSize: String(state.pageSize) })
    if (state.ordering) params.set("ordering", state.ordering)
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

  const selectMode = state.checkboxes
  function toggleSelectMode() {
    setSelected(new Map())
    navigate({ checkboxes: !selectMode })
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
      if (!selectMode) navigate({ checkboxes: true })
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

  // Linko's FlatButtons: 36 px, 12 px before the 24 px icon, 8 px to the label, 16 px after it, 5 px apart.
  const actionButton = "flex h-9 items-center whitespace-nowrap rounded-[2px] pl-[12px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95"
  const actionButtons = canManage && (
    <div className="flex flex-wrap items-center gap-[5px]">
      <button type="button" onClick={() => openBulk("add")} className={`${actionButton} bg-[#4db6ac]`}>
        <SolidIcon d={ICON_BOX} className="h-6 w-6" />
        <span className="ml-2">{t(copy.add)}</span>
      </button>
      <button type="button" onClick={() => openBulk("remove")} className={`${actionButton} bg-[#ff8a65]`}>
        <SolidIcon d={RI.trash} className="h-6 w-6" />
        <span className="ml-2">{t(copy.remove)}</span>
      </button>
      <button type="button" onClick={() => openBulk("set")} className={`${actionButton} bg-[#1E4A9A]`}>
        <SolidIcon d={ICON_SHIELD} className="h-6 w-6" />
        <span className="ml-2">{t("Стереть и добавить")}</span>
      </button>
    </div>
  )

  // Linko's pager: "1 - 25 из N" in #5d6474 and the two circled arrows.
  const pager = (
    <>
      <span className="mr-[5px] whitespace-nowrap">
        {range.from} - {range.to} {t("из")} {count}
      </span>
      <button type="button" onClick={() => navigate({ page: Math.max(1, page - 1) })} disabled={page <= 1} aria-label={t("Назад")} className="px-[5px]">
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`} aria-hidden="true"><path d={ARROW_PREV} /></svg>
      </button>
      <button type="button" onClick={() => navigate({ page: Math.min(pageCount, page + 1) })} disabled={page >= pageCount} aria-label={t("Вперед")}>
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`} aria-hidden="true"><path d={ARROW_NEXT} /></svg>
      </button>
    </>
  )

  // Linko's grid: 30 px inset and three equal columns, every column but the first 8 px padded; the checkbox
  // mode starts 20 px in with a 30 px checkbox column.
  const gridCols = selectMode ? "grid-cols-[30px_repeat(3,minmax(0,1fr))] pl-[20px] pr-[30px]" : "grid-cols-3 px-[30px]"
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
              <div className="flex min-h-[50px] flex-wrap items-center gap-x-5 gap-y-2 bg-[#f2f5f8] py-[7px] pl-4 pr-[5px] text-[#5d6474] sm:pl-[30px]">
                <span className="font-semibold text-[#333]">
                  {t("Выбрано")}: {selected.size}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-y-2">
                  {pager}
                  <button
                    type="button"
                    onClick={() => setSelected(new Map())}
                    title={t("Снять выделение")}
                    aria-label={t("Снять выделение")}
                    className="ml-[20px] flex h-12 w-12 items-center justify-center rounded-full text-[#5d6474] hover:bg-white"
                  >
                    <X className="h-6 w-6" />
                  </button>
                  {actionButtons}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[50px] flex-wrap items-center gap-y-2 py-[1px] pr-[5px] lg:flex-nowrap">
                {/* Linko places the search a quarter of the card plus ~16 px in; on a narrower card it moves left
                    instead of running under the buttons. */}
                <div className="w-full min-w-0 pr-4 sm:w-auto sm:flex-1 sm:pr-[18px]" style={{ paddingLeft: "max(16px, min(calc(25% + 18px), calc(100% - 1136px)))" }}>
                  <label className="relative flex w-full max-w-full items-center border-b border-[#e0e0e0] focus-within:border-[#5d6474] sm:w-[300px]">
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
                      className="h-12 min-w-0 flex-1 bg-transparent pr-7 text-[13px] outline-none placeholder:text-black/30"
                    />
                    <Search className="absolute right-[2px] h-6 w-6 text-[#ccc]" />
                  </label>
                </div>
                <div className="ml-auto flex max-w-full flex-wrap items-center gap-y-2 text-[13px] text-[#5d6474] lg:shrink-0">
                  <div className="relative mr-[27px]">
                    <select
                      value={state.pageSize}
                      onChange={(event) => navigate({ pageSize: Number(event.target.value), page: 1 })}
                      aria-label={t("Количество строк")}
                      className="h-12 w-[40px] appearance-none bg-transparent text-[13px] text-[#333] outline-none"
                    >
                      {RESTRICTION_PAGE_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                    <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30" aria-hidden="true"><path d="M7 10l5 5 5-5z" /></svg>
                  </div>
                  {pager}
                  {canManage && (
                    <button
                      type="button"
                      onClick={toggleSelectMode}
                      title={t(selectMode ? "Спрятать флажки" : "Выбрать из списка")}
                      aria-label={t(selectMode ? "Спрятать флажки" : "Выбрать из списка")}
                      className="ml-[20px] flex h-12 w-12 items-center justify-center rounded-full text-[#5d6474] hover:bg-[#f2f5f8]"
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
                <div className={`grid h-[50px] items-center bg-[#5d6474] font-semibold text-white ${gridCols}`}>
                  {selectMode && (
                    <button
                      type="button"
                      onClick={togglePage}
                      disabled={!rows.length}
                      title={t("Выбрать все")}
                      aria-label={t("Выбрать все")}
                      className={`flex h-6 w-6 items-center justify-center ${someOnPage ? "text-white" : "text-white/80"}`}
                    >
                      <CheckCheck className="h-6 w-6" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate({ ordering: nextOrdering(state.ordering), page: 1 })}
                    className="flex h-9 w-fit items-center gap-[6px] text-left"
                  >
                    №{state.ordering === "id" ? <ArrowDown className="h-4 w-4" /> : state.ordering === "-id" ? <ArrowUp className="h-4 w-4" /> : null}
                  </button>
                  <span className="pl-2">{t("Сотрудник")}</span>
                  <span className="pl-2">{t(copy.count)}</span>
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
                      className="rounded-md border border-[#1E4A9A] px-4 py-2 font-semibold text-[#1E4A9A]"
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
                        className={`relative grid min-h-[50px] cursor-pointer items-center after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8] ${gridCols} ${loading ? "opacity-60" : ""}`}
                      >
                        {selectMode && (
                          <span className="flex w-6 justify-center" onClick={(event) => event.stopPropagation()}>
                            <DemoCheckbox checked={selected.has(row.id)} onChange={(checked) => toggleRow(row, checked)} label={row.name} />
                          </span>
                        )}
                        <span className="py-2">{row.id}</span>
                        <span className="break-words py-2 pl-2">
                          {row.name}
                          {!row.active && <span className="ml-2 text-[12px] text-[#9e9e9e]">{t("Неактивный")}</span>}
                        </span>
                        <span className="py-2 pl-2">{amount === 0 ? t("Не установлено") : amount}</span>
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
          employeeName={dialog.items?.name}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}

      <CashSnackbar message={message} onClose={closeMessage} />
    </RefPage>
  )
}
