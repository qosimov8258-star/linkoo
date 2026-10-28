"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, CreditCard, Info, List, X } from "lucide-react"

import {
  AccountDebtFilterDialog,
  accountDebtFilterQuery,
  readAccountDebtFilters,
  writeAccountDebtFilters,
  type AccountDebtFilters,
} from "@/components/analytics/account-debts-filter"
import { BalanceTable } from "@/components/analytics/balance/balance-table"
import { ClientActDialog } from "@/components/analytics/balance/client-act-dialog"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { balanceListExcelRows } from "@/components/analytics/balance/excel"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterButton, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { GroupPaymentDialog } from "@/components/analytics/balance/group-payment-dialog"
import { BALANCE_PAGE_SIZES, BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery, useBalanceList, type BalanceQuery } from "@/components/analytics/balance/use-balance"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { defaultBalancePeriod, isIsoDay } from "@/lib/finance/dates"
import { MOVEMENT_LABELS, type BalanceDateMode, type BalanceListResult, type BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Долги по счетам" (demo #/statistics/market-expanded, a fork of the
// clients balance page): balances of financial accounts — clients grouped by
// INN (key "inn:<inn>", legal name from contracts) or single clients without
// INN — per currency for a period, by transaction creation or realization
// date. Data: GET /api/balances/account (shared finance ledger); act modal:
// ClientActDialog kind "account"; "Групповая оплата": GroupPaymentDialog →
// POST /api/balances/group-payment. Page state lives in the URL with the
// demo's query keys (fromDate/toDate or acceptedDateBegin/End, pageSize,
// ordering, toggle, filters, openClient).

type Toggle = "marketExpanded" | "marketType"

type PageState = {
  from: string
  to: string
  mode: BalanceDateMode
  toggle: Toggle
  search: string
  page: number
  pageSize: number
  ordering: string[]
  filters: AccountDebtFilters
  /** BalanceRow.key of the account whose act is open ("" = closed). */
  openClient: string
}

const GROUPS = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.account).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец" },
]

const SUMMARY_BOXES: SummaryBox[] = [
  { metrics: [{ label: "Баланс на начало периода", field: "begin_balance" }, { label: "Продажи", field: "order" }] },
  { metrics: [{ label: "Возврат", field: "order_return" }, { label: "Оплачено", field: "payment" }] },
  { metrics: [{ label: "Прочие приходы", field: "none_type_plus" }, { label: "Прочие расходы", field: "none_type_minus" }] },
  { align: "right", metrics: [{ label: "Баланс на конец периода", field: "end_balance" }] },
]

const PERIOD_HINTS: Record<BalanceDateMode, { intro: string; items: string[] }> = {
  created: {
    intro: "При расчете оперативного долга система будет учитывать все транзакции по дате создания и будет учитывать:",
    items: ["Все заказы (кроме неподтвержденных и отмененных заказов).", "Все оплаты (кроме отмененных).", "Все возвраты (кроме отмененных)."],
  },
  realization: {
    intro: "При расчете фактического долга система будет учитывать все транзакции по дате реализации и будет учитывать:",
    items: [
      "Заказы после выдачи со склада (то есть статус \"Доставляется\" и \"Доставленные\").",
      "Только принятые возвраты на склад (то есть статус \"Принят\").",
      "Только принятые оплаты в кассу.",
    ],
  },
}

function readState(params: URLSearchParams): PageState {
  const mode: BalanceDateMode = params.get("periodType") === "secondPeriod" ? "realization" : "created"
  const fallback = defaultBalancePeriod()
  const day = (name: string, alt: string) => {
    const value = params.get(name) ?? ""
    return isIsoDay(value) ? value : alt
  }
  let from = mode === "realization" ? day("acceptedDateBegin", fallback.from) : day("fromDate", fallback.from)
  let to = mode === "realization" ? day("acceptedDateEnd", fallback.to) : day("toDate", fallback.to)
  if (from > to) [from, to] = [to, from]
  const pageSize = Number(params.get("pageSize"))
  const page = Number(params.get("page"))
  return {
    from,
    to,
    mode,
    toggle: params.get("toggle") === "marketType" ? "marketType" : "marketExpanded",
    search: (params.get("search") ?? "").trim(),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (BALANCE_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 25,
    ordering: params.getAll("ordering").filter(Boolean).slice(0, 1),
    filters: readAccountDebtFilters(params),
    openClient: (params.get("openClient") ?? "").trim(),
  }
}

function stateUrl(state: PageState): string {
  const params = new URLSearchParams()
  if (state.mode === "realization") {
    params.set("periodType", "secondPeriod")
    params.set("acceptedDateBegin", state.from)
    params.set("acceptedDateEnd", state.to)
  } else {
    params.set("fromDate", state.from)
    params.set("toDate", state.to)
  }
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  state.ordering.forEach((key) => params.append("ordering", key))
  if (state.search) params.set("search", state.search)
  if (state.toggle === "marketType") params.set("toggle", "marketType")
  writeAccountDebtFilters(params, state.filters)
  if (state.openClient) params.set("openClient", state.openClient)
  return `?${params.toString()}`
}

export function AccountDebtsView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<PageState>(() => readState(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [groupPaymentOpen, setGroupPaymentOpen] = useState(false)
  // POST /api/balances/group-payment needs cash.manage (lib/capabilities-catalog.ts ROUTE_PERMISSIONS).
  const canGroupPay = useCanManage(["cash.manage"])
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<Map<string, BalanceRow>>(() => new Map())
  const [actName, setActName] = useState("")
  const [notice, setNotice] = useState("")
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  const { from, to, mode, toggle, search, page, pageSize, ordering, filters, openClient } = state
  const byType = toggle === "marketType"

  // Mirror the page state into the URL (demo keeps every filter in the query).
  const url = stateUrl(state)
  useEffect(() => {
    if (window.location.search !== url) window.history.replaceState(null, "", url)
  }, [url])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])

  /** Any change but paging goes back to page 1. */
  const update = (patch: Partial<PageState>) => setState((current) => ({ ...current, page: 1, ...patch }))

  const listQuery: BalanceQuery = useMemo(
    () => ({
      from,
      to,
      mode,
      ...accountDebtFilterQuery(filters),
      ordering,
      // The client-type view lists every type (demo total_by_types is not paged); its search is by type name.
      search: byType ? "" : search,
      groupBy: byType ? "type" : "",
      page: byType ? undefined : page,
      pageSize: byType ? 0 : pageSize,
    }),
    [from, to, mode, filters, ordering, search, byType, page, pageSize],
  )
  const { data, loading, error, reload } = useBalanceList("account", listQuery)

  const currencies = data?.visibleCurrencies ?? []

  // A page number past the end (stale URL, fewer rows after a change) jumps to the last page.
  useEffect(() => {
    if (byType || !data || loading || data.rows.length || page <= 1) return
    const lastPage = Math.max(1, Math.ceil(data.count / Math.max(1, pageSize)))
    if (page > lastPage) setState((current) => ({ ...current, page: lastPage }))
  }, [byType, data, loading, page, pageSize])
  const typeQuery = search.trim().toLowerCase()
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    if (!byType || !typeQuery) return all
    return all.filter((row) => (row.name || t("Не указано")).toLowerCase().includes(typeQuery))
  }, [data, byType, typeQuery, t])

  // Selected accounts are kept across pages; prefer the freshest numbers of the current page.
  const pageRows = useMemo(() => new Map((data?.rows ?? []).map((row) => [row.key, row])), [data])
  const selectedRows = [...selected.values()].map((row) => pageRows.get(row.key) ?? row)
  const selection = {
    selected: new Set(selected.keys()),
    onChange: (next: Set<string>) =>
      setSelected((current) => {
        const result = new Map<string, BalanceRow>()
        for (const key of next) {
          const row = pageRows.get(key) ?? current.get(key)
          if (row) result.set(key, row)
        }
        return result
      }),
  }

  const filterCount = countActiveFilters({
    ...(mode === "realization" ? { acceptedDateBegin: from, acceptedDateEnd: to } : { toDate: to }),
    ...filters,
  })
  const scope = [...filters.division, ...filters.branch]

  const openAct = (row: BalanceRow) => {
    setActName(row.name)
    setState((current) => ({ ...current, openClient: row.key }))
  }

  const drillIntoType = (row: BalanceRow) => {
    const type = String(row.info.type ?? "")
    if (!type) return
    setSearchDraft("")
    update({ toggle: "marketExpanded", search: "", filters: { ...filters, marketTypeParent: type } })
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    update({ search: searchDraft.trim() })
  }

  const fileBase = `${t("Долги по счетам")} ${from} - ${to}`

  const fetchAll = async (): Promise<BalanceListResult> => {
    const response = await fetch(`/api/balances/account?${buildBalanceQuery({ ...listQuery, page: undefined, pageSize: 0 })}`, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as (BalanceListResult & { error?: string }) | null
    if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
    return body
  }

  const runExport = async (build: (result: BalanceListResult) => void) => {
    setExporting(true)
    setExportError("")
    try {
      build(await fetchAll())
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExporting(false)
    }
  }

  const downloadAll = () =>
    runExport((result) => {
      const list = byType && typeQuery ? result.rows.filter((row) => (row.name || t("Не указано")).toLowerCase().includes(typeQuery)) : result.rows
      const leading = byType
        ? [{ label: "Тип клиента", value: (row: BalanceRow) => row.name || t("Не указано") }]
        : [
            { label: "Клиент", value: (row: BalanceRow) => row.name },
            { label: "ИНН", value: (row: BalanceRow) => String(row.info.inn ?? "") },
          ]
      downloadExcelTable(fileBase, balanceListExcelRows({ rows: list, groups: GROUPS, currencies: result.visibleCurrencies, leading, totals: result.totals, t }))
    })

  const downloadShort = () =>
    runExport((result) => {
      downloadExcelTable(
        `${fileBase} (${t("Скачать упрощенным")})`,
        balanceListExcelRows({
          rows: result.rows,
          groups: [{ field: "end_balance", label: "Баланс на конец" }],
          currencies: result.visibleCurrencies,
          leading: [{ label: "Клиент", value: (row) => row.name }],
          t,
        }),
      )
    })

  const firstColumn = byType
    ? {
        label: "Тип клиента",
        sortKey: "name",
        render: (row: BalanceRow) =>
          row.info.type ? (
            <button type="button" onClick={() => drillIntoType(row)} className="flex items-center gap-2 text-left text-[#17233b] hover:text-[#4f70e7]">
              {row.name}
              <List className="h-4 w-4 shrink-0 text-[#4f70e7]" />
            </button>
          ) : (
            <span className="text-[#586174]">{t("Не указано")}</span>
          ),
      }
    : {
        label: "Клиент",
        raw: true,
        width: 220,
        sortKey: "name",
        render: (row: BalanceRow) => (
          <div className="min-w-0">
            <button type="button" onClick={() => openAct(row)} className="text-left text-[#333] hover:text-[#4f71dc]">
              {row.name || "No"}
            </button>
            {(row.info.inn || Number(row.info.clients) > 1) && (
              <div className="text-[12px] text-[#586174]">
                {row.info.inn ? `${t("ИНН")}: ${row.info.inn}` : ""}
                {row.info.inn && Number(row.info.clients) > 1 ? " · " : ""}
                {Number(row.info.clients) > 1 ? `${t("Клиенты")}: ${row.info.clients}` : ""}
              </div>
            )}
          </div>
        ),
      }

  const realizedBadge =
    mode === "realization" ? (
      <span className="font-semibold text-[#4caf72]">
        {t("Реализовано")}
        {filters.deliveryMan ? ` (${t("По доставщику")})` : ""}
      </span>
    ) : null

  return (
    <main className="ref-white min-h-screen bg-white text-[#333]">
      <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-4 pl-[30px] pr-[28px]">
        <div className="flex items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <h1 className="text-[18px] font-bold text-[#5d6474]">{t("Долги по счетам")}</h1>
        </div>
        <div className="flex h-[32px] w-[720px] max-w-full bg-white">
          {(["created", "realization"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => value !== mode && update({ mode: value })}
              className={`group relative flex flex-1 items-center justify-center gap-2 px-5 text-[13px] font-normal ${mode === value ? "bg-[#71ce87] text-white" : "text-[#586174] hover:bg-[#f7f9fb]"}`}
            >
              <Info className="h-4 w-4" />
              {t(value === "created" ? "По дате создание транзакции" : "По дате реализации")}
              <span className="pointer-events-none absolute right-0 top-full z-[70] mt-2 hidden w-[380px] rounded-md bg-[#3d4656] p-3 text-left text-[13px] font-normal leading-5 text-white shadow-lg group-hover:block">
                {t(PERIOD_HINTS[value].intro)}
                <span className="mt-2 block">
                  {PERIOD_HINTS[value].items.map((item, index) => (
                    <span key={item} className="block">
                      {index + 1}. {t(item)}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-[30px] pb-[10px] pt-[21px]">
        <BalanceFilterButton count={filterCount} from={from} to={to} scope={scope} onOpen={() => setFilterOpen(true)} extra={realizedBadge} />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {!byType && canGroupPay && (
            <button
              type="button"
              onClick={() => setGroupPaymentOpen(true)}
              className="flex h-[34px] items-center gap-2 rounded-[3px] bg-[#4f71dc] pl-2 pr-4 text-[13px] font-semibold text-white"
            >
              <CreditCard className="h-5 w-5" /> {t("Групповая оплата")}
              {selected.size > 0 && <span className="rounded-full bg-white px-2 text-[12px] text-[#4f71dc]">{selected.size}</span>}
            </button>
          )}
          <BalanceDownloadMenu
            wide
            disabled={exporting}
            label={exporting ? "Загрузка..." : "Скачать"}
            items={byType ? [{ label: "Скачать все", onClick: downloadAll }] : [{ label: "Скачать все", onClick: downloadAll }, { label: "Скачать упрощенным", onClick: downloadShort }]}
          />
        </div>
        {exportError && <p className="w-full text-right text-sm text-[#e57373]">{exportError}</p>}
      </section>

      <BalanceSummaryCards digits={3} compact boxes={SUMMARY_BOXES} totals={data?.totals ?? {}} currencies={currencies} loading={loading} />

      <ExpandedOverlay expanded={expanded}>
        <section className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[#efefef] px-[30px] pb-[4px] pt-[10px]">
          <div className="hidden overflow-hidden rounded-sm">
            {(["marketExpanded", "marketType"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  if (value === toggle) return
                  // Demo: switching the view drops the search and the client-type drill-down.
                  setSearchDraft("")
                  update({ toggle: value, search: "", filters: { ...filters, marketTypeParent: "" } })
                }}
                className={`px-5 py-2 text-[13px] font-bold uppercase tracking-wide ${
                  toggle === value ? "bg-[#4f71dc] text-white shadow-[0_1px_6px_rgba(0,0,0,0.12)]" : "bg-white text-[#4f71dc] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
                }`}
              >
                {t(value === "marketExpanded" ? "Разбить по валютам" : "Показать по типам клиентов")}
              </button>
            ))}
          </div>

          {filters.marketTypeParent && (
            <div className="flex items-center gap-2 whitespace-nowrap text-[14px]">
              <span className="text-[#586174]">{t("Отфильтровано по")}:</span>
              <span className="font-semibold">{filters.marketTypeParent}</span>
              <button type="button" onClick={() => update({ filters: { ...filters, marketTypeParent: "" } })} className="font-semibold text-[#4f70e7] hover:underline">
                {t("Сбросить фильтр")}
              </button>
            </div>
          )}

          <form onSubmit={submitSearch} className="flex w-[256px] items-center gap-2 border-b border-[#e0e0e0] pb-1">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t(byType ? "Тип клиента" : "Клиент")}
              aria-label={t(byType ? "Тип клиента" : "Клиент")}
              className="h-8 flex-1 bg-transparent pt-[6px] text-[13px] outline-none placeholder:font-semibold placeholder:text-black"
            />
            {(searchDraft || search) && (
              <button
                type="button"
                aria-label={t("Очистить")}
                onClick={() => {
                  setSearchDraft("")
                  if (search) update({ search: "" })
                }}
                className="text-[#9aa3b6] hover:text-[#586174]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>

          <div className="ml-auto flex items-center gap-5">{byType ? (
            <span className="whitespace-nowrap text-[#586174]">
              {rows.length ? 1 : 0} - {rows.length} {t("из")} {rows.length}
            </span>
          ) : (
            <BalancePagination page={page} pageSize={pageSize} count={data?.count ?? 0} onChange={(next) => setState((current) => ({ ...current, ...next }))} />
          )}
          <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} /></div>
        </section>

        {error && (
          <div className="mx-6 mb-4 flex items-center justify-between gap-4 rounded-md border border-[#f3c7c7] bg-[#fdf3f3] px-4 py-3 text-[#c0392b] md:mx-9">
            <span>
              {t("Не удалось загрузить данные")}: {error}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className="pb-10">
          <BalanceTable
              fixedWidth={100}
              rowPad={8}
              selectionAfterFirst
            rows={rows}
            groups={GROUPS}
            currencies={currencies.length ? currencies : ["SUM"]}
            first={firstColumn}
            selection={byType ? undefined : selection}
            ordering={ordering}
            onOrderingChange={(next) => update({ ordering: next })}
            loading={loading}
            emptyText={byType && typeQuery ? "Ничего не найдено" : "По вашему запросу ничего не найдено"}
          />
        </div>
      </ExpandedOverlay>

      <AccountDebtFilterDialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        from={from}
        to={to}
        mode={mode}
        filters={filters}
        onApply={(period, next) => update({ ...period, filters: next })}
      />

      {openClient && (
        <ClientActDialog
          key={`${openClient}|${from}|${to}|${mode}`}
          kind="account"
          entityKey={openClient}
          name={actName || pageRows.get(openClient)?.name || ""}
          from={from}
          to={to}
          mode={mode}
          onClose={() => {
            setActName("")
            setState((current) => ({ ...current, openClient: "" }))
          }}
        />
      )}

      <GroupPaymentDialog
        open={groupPaymentOpen}
        rows={selectedRows}
        currencies={currencies.length ? currencies : ["SUM"]}
        onClose={() => setGroupPaymentOpen(false)}
        onSaved={() => {
          setSelected(new Map())
          setNotice(t("Успешно сохранено"))
          reload()
        }}
      />

      {notice && (
        <div className="fixed bottom-6 right-6 z-[120] flex items-center gap-2 rounded-md bg-[#4caf72] px-5 py-3 font-semibold text-white shadow-lg" role="status">
          <CheckCircle2 className="h-5 w-5" /> {notice}
        </div>
      )}
    </main>
  )
}
