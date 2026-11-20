"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ChevronDown, Pencil, X } from "lucide-react"

import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { docDate } from "@/components/analytics/internal-transfers-shared"
import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { WriteOffDetailPanel, WriteOffStatusLabel } from "@/components/analytics/write-offs-detail"
import { WriteOffFormDialog } from "@/components/analytics/write-offs-form"
import { FilterDate, RefFilterPanel, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { SplitDetailList } from "@/components/ref/split-detail"
import { useLanguage } from "@/lib/i18n/language-context"
import { WRITE_OFF_STATUSES, WRITE_OFF_STATUS_CODES, type WriteOff, type WriteOffListResult, type WriteOffOptions, type WriteOffStatus } from "@/lib/write-offs-types"

// Linko's «Списание» (#/write-off/, chunk 143: list 5211, filter 4471, card 5214, create 5212/5213). Header button
// «Списание товара»; toolbar «Показать фильтр» (Период создания, Склад, Создатель, Статус), search (the second quarter
// of the row), page size + «1 - 25 из N» and no Excel; columns № | Создал | Склад | Дата создания | Статус on Linko's
// 1/4/2/2/2 grid, № and Дата создания sort (several keys, «-created_date,id»). A row opens its card in its place (the
// rows above and below stay in two cards). The URL keeps the state under Linko's keys (id, openFilterDialog,
// openCreateDialog, openConfirmDialog, status=pending|finished|canceled); opening a card or a dialog adds a history
// entry as Linko's links do. Data: /api/write-offs/**.

type Filters = { warehouses: string[]; creators: string[]; status: WriteOffStatus | ""; fromDate: string; toDate: string }
const EMPTY: Filters = { warehouses: [], creators: [], status: "", fromDate: "", toDate: "" }
const DIALOG_KEYS = ["openCreateDialog", "openConfirmDialog"] as const
type DialogKey = (typeof DIALOG_KEYS)[number]
type ViewState = { search: string; ordering: string; page: number; pageSize: number; filters: Filters; detailId: number | null; dialogs: Partial<Record<DialogKey, string>> }

// Linko's status ids in the URL (WRITE_OFF_STATUS_ITEMS: pending / finished / canceled).
const STATUS_BY_CODE: Record<string, WriteOffStatus> = { pending: "ожидает", finished: "закрыт", canceled: "отменен", cancelled: "отменен" }
const statusCode = (status: WriteOffStatus) => (status === "отменен" ? "canceled" : WRITE_OFF_STATUS_CODES[status])

const positiveInt = (value: string | null) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function stateFromParams(params: URLSearchParams): ViewState {
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
  const raw = params.get("status") ?? ""
  const status = STATUS_BY_CODE[raw] ?? (WRITE_OFF_STATUSES.includes(raw as WriteOffStatus) ? (raw as WriteOffStatus) : "")
  return {
    search: params.get("search") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: { warehouses: list("stock"), creators: list("user"), status, fromDate: params.get("fromDate") ?? "", toDate: params.get("toDate") ?? "" },
    detailId: positiveInt(params.get("id")),
    dialogs: Object.fromEntries(DIALOG_KEYS.flatMap((key) => (params.get(key) ? [[key, params.get(key) ?? ""]] : []))),
  }
}

function stateToSearch(state: ViewState): string {
  const f = state.filters
  return buildCashQuery({
    search: state.search,
    ordering: state.ordering,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSize,
    stock: f.warehouses,
    user: f.creators,
    status: f.status ? statusCode(f.status) : "",
    fromDate: f.fromDate,
    toDate: f.toDate,
    id: state.detailId ?? "",
    ...state.dialogs,
  })
}

function listQuery(state: ViewState): CashQuery {
  const f = state.filters
  return { search: state.search, ordering: state.ordering, page: state.page, pageSize: String(state.pageSize), warehouse: f.warehouses, creator: f.creators, status: f.status, fromDate: f.fromDate, toDate: f.toDate }
}

/** Linko's header sort: a click adds the column ascending, then makes it descending, then drops it; the other keys stay. */
function nextOrdering(ordering: string, key: string): string {
  const keys = ordering.split(",").map((part) => part.trim()).filter(Boolean)
  const index = keys.findIndex((part) => part.replace(/^-/, "") === key)
  if (index < 0) return [...keys, key].join(",")
  if (keys[index].startsWith("-")) return keys.filter((_, i) => i !== index).join(",")
  return keys.map((part, i) => (i === index ? `-${key}` : part)).join(",")
}

// Linko marks an ascending column with ↓ and a descending one with ↑.
function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  const keys = ordering.split(",").map((part) => part.trim())
  if (keys.includes(sortKey)) return <ArrowDown className="ml-2 h-3.5 w-3.5 text-[#c9ccd3]" />
  if (keys.includes(`-${sortKey}`)) return <ArrowUp className="ml-2 h-3.5 w-3.5 text-[#c9ccd3]" />
  return null
}

const filterCount = (f: Filters) => [f.fromDate || f.toDate, f.warehouses.length > 0, f.creators.length > 0, f.status].filter(Boolean).length

/** «Показать фильтр ⌄», or once applied «Фильтр: N элемента» with edit and clear (Linko's afterFilter). */
function WriteOffFilterBar({ filters, open, onOpen, onClose, onClear }: { filters: Filters; open: boolean; onOpen: () => void; onClose: () => void; onClear: () => void }) {
  const { t } = useLanguage()
  const count = filterCount(filters)
  if (count > 0)
    return (
      <div className="flex w-fit items-center gap-2 rounded-md bg-[#efefef] px-4 py-1.5 text-[#666]">
        <span className="whitespace-nowrap">
          {t("Фильтр")}: {count} {t("элемента")}
        </span>
        <button type="button" onClick={onOpen} aria-label={t("Изменить фильтр")} title={t("Изменить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" onClick={onClear} aria-label={t("Очистить фильтр")} title={t("Очистить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  return (
    <button type="button" onClick={open ? onClose : onOpen} className="flex items-center gap-[2px] whitespace-nowrap text-[13px] text-[#1E4A9A]">
      {t("Показать фильтр")} <ChevronDown className={`mt-[2px] h-3 w-3 transition ${open ? "rotate-180" : ""}`} />
    </button>
  )
}

const named = (values: string[]): RefSelectItem[] => values.map((value) => ({ value, label: value }))

/** Linko's 300px «Фильтр» panel: Период создания, Склад (several), Создатель (several), Статус, ПРИМЕНИТЬ. */
function WriteOffFilterPanel({ filters, options, onClose, onApply }: { filters: Filters; options: WriteOffOptions | null; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  // A value of the URL no longer offered stays choosable.
  const withChosen = (list: string[], chosen: string[]) => named([...chosen.filter((value) => !list.includes(value)), ...list])
  const warehouseItems = withChosen(options?.warehouses ?? [], draft.warehouses)
  const userItems = withChosen(options?.users ?? [], draft.creators)
  const statusItems = WRITE_OFF_STATUSES.map((status) => ({ value: status, label: t(status) }))
  const apply = () => {
    const swap = draft.fromDate && draft.toDate && draft.fromDate > draft.toDate
    onApply(swap ? { ...draft, fromDate: draft.toDate, toDate: draft.fromDate } : draft)
  }
  return (
    <RefFilterPanel narrow className="!w-[300px]" onClose={onClose} onApply={apply} applyClassName="mt-[15px]">
      <FilterDate words iconEnd label={t("Период создания")} begin={draft.fromDate} end={draft.toDate} onChange={(fromDate, toDate) => setDraft((current) => ({ ...current, fromDate, toDate }))} />
      <RefSearchSelect
        multi
        className="mt-[5px]"
        label={t("Склад")}
        rowHeight={32}
        items={warehouseItems}
        selected={warehouseItems.filter((item) => draft.warehouses.includes(item.value))}
        onChange={(next) => setDraft((current) => ({ ...current, warehouses: next.map((item) => item.value) }))}
      />
      <RefSearchSelect
        multi
        label={t("Создатель")}
        rowHeight={32}
        items={userItems}
        selected={userItems.filter((item) => draft.creators.includes(item.value))}
        onChange={(next) => setDraft((current) => ({ ...current, creators: next.map((item) => item.value) }))}
      />
      <RefSearchSelect
        searchable={false}
        rowHeight={32}
        label={t("Статус")}
        items={statusItems}
        selected={statusItems.filter((item) => item.value === draft.status)}
        onChange={(next) => setDraft((current) => ({ ...current, status: (next[0]?.value ?? "") as WriteOffStatus | "" }))}
      />
    </RefFilterPanel>
  )
}

export function WriteOffsView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  // ?openFilterDialog=true (Linko's link to the open filter) starts with the panel open.
  const [filterOpen, setFilterOpen] = useState(() => searchParams.get("openFilterDialog") === "true")
  const [detailVersion, setDetailVersion] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<WriteOffListResult>(`/api/write-offs?${buildCashQuery(listQuery(state))}`)
  const options = useCashJson<WriteOffOptions>("/api/write-offs/options")
  const data = list.data
  const rows = data?.results ?? []

  // The URL follows the state: a new entry when the card, a dialog, the page or the filters change (Linko's links
  // push), else (search typing, corrections the page makes by itself) the entry is replaced.
  const shown = useRef<ViewState | null>(null)
  const replaceNext = useRef(false)
  useEffect(() => {
    const search = stateToSearch(state)
    const previous = shown.current
    const replace = replaceNext.current
    shown.current = state
    replaceNext.current = false
    if (window.location.search.slice(1) === search) return
    const withoutSearch = (value: ViewState) => stateToSearch({ ...value, search: "" })
    const push = !replace && previous !== null && withoutSearch(previous) !== withoutSearch(state)
    const url = `${window.location.pathname}?${search}`
    // No state of our own: Next.js records the entry, so useSearchParams follows Back / Forward.
    if (push) window.history.pushState(null, "", url)
    else window.history.replaceState(null, "", url)
  }, [state])

  // Back / Forward: the state follows the URL.
  const urlSearch = searchParams.toString()
  useEffect(() => {
    const next = stateFromParams(new URLSearchParams(urlSearch))
    if (!shown.current || stateToSearch(next) === stateToSearch(shown.current)) return
    shown.current = next
    setState(next)
    setSearchDraft(next.search)
  }, [urlSearch])

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  // A page past the end (rows removed, a stale URL) jumps to the last page.
  useEffect(() => {
    if (!data || list.loading || state.page <= 1) return
    const last = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > last) {
      replaceNext.current = true
      setState((current) => ({ ...current, page: last }))
    }
  }, [data, list.loading, state.page, state.pageSize])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const setDialog = useCallback((key: DialogKey, value: string) => setState((current) => ({ ...current, dialogs: { ...current.dialogs, [key]: value } })), [])
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const sortHeader = (key: string, label: ReactNode) => (
    <button type="button" onClick={() => update({ ordering: nextOrdering(state.ordering, key), page: 1 })} className="inline-flex items-center font-semibold">
      {label}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )
  const clearFilters = () => {
    setFilterOpen(false)
    update({ filters: { ...EMPTY }, page: 1, detailId: null })
  }

  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const createOpen = canEdit && state.dialogs.openCreateDialog === "true"
  // Only № and Дата создания sort (on the server); the other heads are plain nodes (a string head sorts client-side).
  const heads = [
    <span key="n" className="-ml-2 block">{sortHeader("id", "№")}</span>,
    <span key="c">{t("Создал")}</span>,
    <span key="w">{t("Склад")}</span>,
    sortHeader("created_date", t("Дата создания")),
    <span key="s">{t("Статус")}</span>,
  ]
  return (
    <RefPage>
      <RefHeader title={t("Списание")}>
        {canEdit && (
          <button type="button" onClick={() => setDialog("openCreateDialog", "true")} className="-mr-4 h-9 px-4 text-[13px] font-semibold text-[#e57373] hover:bg-black/5">
            {t("Списание товара")}
          </button>
        )}
      </RefHeader>

      <SplitDetailList
        rows={rows}
        selectedKey={state.detailId}
        rowKey={(row: WriteOff) => row.id}
        toolbar={
          <>
            <RefToolbar
              filterOpen={filterOpen}
              filterPanel={
                <WriteOffFilterPanel
                  filters={state.filters}
                  options={options.data}
                  onClose={() => setFilterOpen(false)}
                  onApply={(filters) => {
                    setFilterOpen(false)
                    update({ filters, page: 1, detailId: null })
                  }}
                />
              }
              leftSlot={<WriteOffFilterBar filters={state.filters} open={filterOpen} onOpen={() => setFilterOpen(true)} onClose={() => setFilterOpen(false)} onClear={clearFilters} />}
              // Linko's search sits in the second quarter of the toolbar row (25% of the width + 18px).
              linkFilter="flush"
              fluid
              query={searchDraft}
              onQuery={setSearchDraft}
              pageSize={state.pageSize}
              onPageSize={(pageSize) => update({ pageSize, page: 1 })}
              from={(state.page - 1) * state.pageSize + 1}
              to={Math.min(state.page * state.pageSize, data?.count ?? 0)}
              total={data?.count ?? 0}
              page={state.page}
              pageCount={pageCount}
              onPage={(page) => update({ page })}
            />
            {list.error && (
              <div className="flex flex-wrap items-center gap-3 bg-white px-6 py-3 text-[#e57373]">
                <span>
                  {t("Не удалось загрузить данные")}: {t(list.error)}
                </span>
                <button type="button" onClick={list.reload} className="font-semibold text-[#1E4A9A] hover:underline">
                  {t("Повторить")}
                </button>
              </div>
            )}
          </>
        }
        tableProps={{
          // Linko's grid: № xs1, Создал xs4, Склад xs2, Дата создания xs2, Статус xs2 (+ the 12th column left empty).
          cols: "minmax(0,1fr) minmax(0,4fr) minmax(0,2fr) minmax(0,2fr) minmax(0,3fr)",
          heads,
          rowKey: (row: WriteOff) => row.id,
          onRowClick: (row: WriteOff) => update({ detailId: row.id }),
          empty: list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено"),
          render: (row: WriteOff) => [
            <span key="id" className="-ml-2 block">
              {row.id}
            </span>,
            row.creator || t("Не указано"),
            row.warehouse,
            docDate(row.date, language),
            <WriteOffStatusLabel key="status" status={row.status} />,
          ],
        }}
        detail={(row: WriteOff) => (
          <WriteOffDetailPanel
            key={`${row.id}-${detailVersion}`}
            id={row.id}
            canEdit={canEdit}
            confirmOpen={state.dialogs.openConfirmDialog === "true"}
            onConfirmOpen={(open) => setDialog("openConfirmDialog", open ? "true" : "false")}
            onClose={() => update({ detailId: null })}
            onChanged={list.reload}
            notify={notify}
          />
        )}
      />

      {createOpen && (
        <WriteOffFormDialog
          options={options.data}
          onClose={() => setDialog("openCreateDialog", "false")}
          onSaved={(saved) => {
            notify(t("Успешно сохранено"))
            list.reload()
            options.reload()
            setDetailVersion((value) => value + 1)
            setState((current) => ({ ...current, detailId: saved.id, page: 1, dialogs: { ...current.dialogs, openCreateDialog: "false" } }))
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeSnackbar} />
    </RefPage>
  )
}
