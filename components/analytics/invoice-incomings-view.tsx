"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, Download, FileSpreadsheet, FileText, MoreVertical, Plus, Search, Truck, X } from "lucide-react"

import { BalanceFilterChip, BalanceFilterDialog } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, cashMutate, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, MultiPick, mutationError, useCanWrite, useCashRates, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { downloadInvoiceTemplate, InvoiceImportDialog, InvoiceRejectDialog, InvoiceViewDialog } from "@/components/analytics/invoice-incomings-dialogs"
import { InvoiceFormDialog } from "@/components/analytics/invoice-incomings-form"
import { formatInvoiceDate, formatInvoiceMoney, InvoiceStatusBadge, supplyFromInvoiceHref, useInvoiceParties } from "@/components/analytics/invoice-incomings-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  INVOICE_STATUS_LABELS,
  INVOICE_TAB_LABELS,
  INVOICE_TABS,
  type InvoiceDetail,
  type InvoiceListResult,
  type InvoiceRow,
  type InvoiceTab,
} from "@/lib/invoice-incomings-types"

// "Входящие счет фактуры" (demo: the menu item opens the separate Linko EDO product,
// edo.linko.uz/ru/crm/documents?tab=accepted&doc_type=["invoice"], whose
// external_url is #/supply?openCreateDialog=true). Here it is an in-app EDO-style list
// of incoming e-invoices (ЭСФ) without any tax-service integration (spec: scratchpad
// extra/spec-invoice-incomings.md): tabs Все / Ожидает / Принятые / Отклоненные, search
// (номер, поставщик, ИНН), filter (период, поставщик, организация, валюта), pagination,
// totals per currency, create / edit / Excel import, card with Принять / Отклонить /
// Удалить and "Создать приход" → /analytics/supplier-incomings?openCreateDialog=true&invoiceId=N.
// Data: /api/invoice-incomings/** (lib/invoice-incomings-repo.ts). The URL keeps the state.

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

type Filters = { fromDate: string; toDate: string; supplierIds: number[]; organizationIds: number[]; currencies: string[] }

const EMPTY_FILTERS: Filters = { fromDate: "", toDate: "", supplierIds: [], organizationIds: [], currencies: [] }

type ViewState = { tab: InvoiceTab; search: string; page: number; pageSize: number; filters: Filters; viewId: number | null }

function positiveInt(value: string | null): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function idList(value: string | null): number[] {
  return (value ?? "")
    .split("-")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
}

function stateFromParams(params: URLSearchParams): ViewState {
  const tab = params.get("status") as InvoiceTab | null
  return {
    tab: tab && INVOICE_TABS.includes(tab) ? tab : "all",
    search: params.get("search") ?? "",
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: positiveInt(params.get("pageSize")) ?? 25,
    filters: {
      fromDate: params.get("fromDate") ?? "",
      toDate: params.get("toDate") ?? "",
      supplierIds: idList(params.get("supplier")),
      organizationIds: idList(params.get("organization")),
      currencies: params.getAll("currency").filter(Boolean),
    },
    viewId: positiveInt(params.get("id")),
  }
}

function stateToSearch(state: ViewState): string {
  return buildCashQuery({
    status: state.tab === "all" ? "" : state.tab,
    search: state.search,
    page: state.page > 1 ? state.page : "",
    pageSize: state.pageSize,
    fromDate: state.filters.fromDate,
    toDate: state.filters.toDate,
    supplier: state.filters.supplierIds.join("-"),
    organization: state.filters.organizationIds.join("-"),
    currency: state.filters.currencies,
    id: state.viewId ?? "",
  })
}

/** Query of GET /api/invoice-incomings (pageSize 0 = all rows for Excel). */
function listQuery(state: ViewState, pageSize = state.pageSize): CashQuery {
  return {
    status: state.tab,
    search: state.search,
    page: pageSize ? state.page : 1,
    pageSize: String(pageSize),
    fromDate: state.filters.fromDate,
    toDate: state.filters.toDate,
    supplier: state.filters.supplierIds,
    organization: state.filters.organizationIds,
    currency: state.filters.currencies,
  }
}

function filterCount(filters: Filters): number {
  return [Boolean(filters.fromDate || filters.toDate), filters.supplierIds.length > 0, filters.organizationIds.length > 0, filters.currencies.length > 0].filter(Boolean).length
}

export function InvoiceIncomingsView() {
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const canEdit = useCanWrite()
  const [state, setState] = useState<ViewState>(() => stateFromParams(new URLSearchParams(searchParams.toString())))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterDraft, setFilterDraft] = useState<Filters>(state.filters)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  // undefined = closed, null = create, invoice = edit.
  const [form, setForm] = useState<InvoiceDetail | null | undefined>(undefined)
  const [viewVersion, setViewVersion] = useState(0)
  const [rejectTarget, setRejectTarget] = useState<InvoiceRow | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [rejectError, setRejectError] = useState("")
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const list = useCashJson<InvoiceListResult>(`/api/invoice-incomings?${buildCashQuery(listQuery(state))}`)
  const parties = useInvoiceParties()
  const { codes } = useCashRates()
  const data = list.data
  const rows = data?.results ?? []

  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  useEffect(() => {
    if (!data || list.loading || state.page <= 1) return
    const last = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > last) setState((current) => ({ ...current, page: last }))
  }, [data, list.loading, state.page, state.pageSize])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [menuOpen])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])

  // The dialog needs a period; with no active one it shows this month and, if left
  // untouched, applying keeps the list unrestricted by date.
  const seededPeriod = useMemo(() => {
    const to = todayIso()
    return { from: state.filters.fromDate || monthStartIso(to), to: state.filters.toDate || to }
  }, [state.filters.fromDate, state.filters.toDate])

  const openFilter = () => {
    setFilterDraft(state.filters)
    setFilterOpen(true)
  }

  const applyFilter = (period: { from: string; to: string }) => {
    const untouched = !state.filters.fromDate && !state.filters.toDate && period.from === seededPeriod.from && period.to === seededPeriod.to
    update({ filters: { ...filterDraft, fromDate: untouched ? "" : period.from, toDate: untouched ? "" : period.to }, page: 1 })
  }

  const clearFilters = () => {
    setSearchDraft("")
    update({ search: "", page: 1, filters: { ...EMPTY_FILTERS } })
  }

  const createSupply = (invoiceId: number) => router.push(supplyFromInvoiceHref(invoiceId))

  const quickAccept = async (row: InvoiceRow) => {
    setBusyId(row.id)
    const result = await cashMutate("PATCH", `/api/invoice-incomings/${row.id}`, { action: "accept" })
    setBusyId(null)
    if (!result.ok) {
      notify(mutationError(result, t), true)
      return
    }
    notify("Счет-фактура принята")
    list.reload()
  }

  const reject = async (reason: string) => {
    if (!rejectTarget) return
    setBusyId(rejectTarget.id)
    setRejectError("")
    const result = await cashMutate("PATCH", `/api/invoice-incomings/${rejectTarget.id}`, { action: "reject", reason })
    setBusyId(null)
    if (!result.ok) {
      setRejectError(mutationError(result, t))
      return
    }
    setRejectTarget(null)
    notify("Счет-фактура отклонена")
    list.reload()
  }

  const downloadList = async () => {
    try {
      const response = await fetch(`/api/invoice-incomings?${buildCashQuery(listQuery(state, 0))}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (InvoiceListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const header = [
        t("№ счет-фактуры"),
        t("Дата счет-фактуры"),
        t("Поставщик"),
        t("ИНН поставщика"),
        t("Покупатель"),
        t("ИНН покупателя"),
        t("№ договора"),
        t("Дата договора"),
        t("Валюта"),
        t("Сумма без НДС"),
        t("НДС"),
        t("Сумма с НДС"),
        t("Статус"),
        t("Приход"),
      ]
      const lines = body.results.map((row) => [
        row.number,
        formatInvoiceDate(row.date),
        row.supplierName,
        row.supplierInn,
        row.organizationName || row.buyerName,
        row.buyerInn,
        row.contractNumber,
        formatInvoiceDate(row.contractDate),
        row.currency,
        row.amountWithoutVat,
        row.vatAmount,
        row.total,
        t(INVOICE_STATUS_LABELS[row.status]),
        row.incoming ? `${t("Приход №")} ${row.incoming.id}` : "",
      ])
      downloadExcelTable(t("Входящие счет фактуры"), [header, ...lines])
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    }
  }

  const currencyOptions = useMemo(
    () => [...new Set([...codes, ...(data?.totals.map((total) => total.currency) ?? []), ...state.filters.currencies])].map((code) => ({ value: code, label: code })),
    [codes, data?.totals, state.filters.currencies],
  )

  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-3 align-middle"

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-4 px-[28px]">
        <div className="flex min-w-0 items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <h1 className="truncate text-[18px] font-bold text-[#5d6474]">{t("Входящие счет фактуры")}</h1>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <div ref={menuRef} className="relative">
              <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-label={t("Меню")} className="flex h-11 w-11 items-center justify-center rounded-full text-[#586174] hover:bg-white">
                <MoreVertical className="h-6 w-6" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-12 z-[60] min-w-[240px] overflow-hidden rounded-md border border-[#e1e5eb] bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      setImportOpen(true)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-[#f2f5f8]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#71ce87] text-white">
                      <FileSpreadsheet className="h-4 w-4" />
                    </span>
                    {t("Импортировать с excel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      downloadInvoiceTemplate(t)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-[#f2f5f8]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#4f70e7] text-white">
                      <Download className="h-4 w-4" />
                    </span>
                    {t("Скачать шаблон")}
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setForm(null)}
              title={t("Добавить счет-фактуру")}
              aria-label={t("Добавить счет-фактуру")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(79,113,220)] text-white shadow-md hover:brightness-95"
            >
              <Plus className="h-6 w-6" />
            </button>
          </div>
        )}
      </header>

      <section className="mx-4 mt-4 overflow-x-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] md:mx-6">
        <div className="grid min-w-[480px] grid-cols-4">
          {INVOICE_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => update({ tab, page: 1 })}
              className={`flex h-[52px] items-center justify-center gap-2 border-b-[3px] px-2 text-[15px] ${state.tab === tab ? "border-[rgb(79,113,220)] font-semibold text-[#17233b]" : "border-transparent text-[#586174] hover:text-[#17233b]"}`}
            >
              {t(INVOICE_TAB_LABELS[tab])}
              {data && <span className={`rounded-full px-2 text-[12px] ${state.tab === tab ? "bg-[#4f70e7] text-white" : "bg-[#eef1f5] text-[#586174]"}`}>{data.tabCounts[tab]}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
          <BalanceFilterChip count={filterCount(state.filters)} onOpen={openFilter} onClear={clearFilters} />
          <label className="relative min-w-[180px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[340px]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Номер, поставщик или ИНН")}
              aria-label={t("Поиск")}
              className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
            />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} sizes={PAGE_SIZES} onChange={({ page, pageSize }) => update({ page, pageSize })} />
            <button type="button" onClick={() => void downloadList()} disabled={!data} aria-label={t("Скачать Excel")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:opacity-40">
              <FileSpreadsheet className="h-5 w-5" />
            </button>
          </div>
        </div>

        {data && data.totals.length > 0 && (
          <div className="flex flex-wrap gap-3 border-b border-[#e1e5eb] bg-[#f7f9fc] px-4 py-3 md:px-6">
            {data.totals.map((total) => (
              <div key={total.currency} className="flex min-w-[260px] flex-1 flex-wrap items-baseline gap-x-5 gap-y-1 rounded-md bg-white px-4 py-2 text-[13px] shadow-sm sm:flex-none">
                <span className="font-bold text-[#4f70e7]">
                  {total.currency} · {total.count} {t("док.")}
                </span>
                <span className="text-[#586174]">
                  {t("Без НДС")}: <b className="text-[#17233b]">{formatInvoiceMoney(total.amountWithoutVat, total.currency)}</b>
                </span>
                <span className="text-[#586174]">
                  {t("НДС")}: <b className="text-[#17233b]">{formatInvoiceMoney(total.vatAmount, total.currency)}</b>
                </span>
                <span className="text-[#586174]">
                  {t("Всего")}: <b className="text-[#17233b]">{formatInvoiceMoney(total.total, total.currency)}</b>
                </span>
              </div>
            ))}
          </div>
        )}

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto ${list.loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[1180px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#e1e5eb] text-[#17233b]">
                <th className={`${th} pl-6`}>{t("№ / дата")}</th>
                <th className={th}>{t("Поставщик")}</th>
                <th className={th}>{t("Покупатель")}</th>
                <th className={th}>{t("Договор")}</th>
                <th className={`${th} text-right`}>{t("Без НДС")}</th>
                <th className={`${th} text-right`}>{t("НДС")}</th>
                <th className={`${th} text-right`}>{t("Сумма с НДС")}</th>
                <th className={`${th} text-center`}>{t("Статус")}</th>
                <th className={th}>{t("Приход")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => update({ viewId: row.id })} className="cursor-pointer border-b border-[#efefef] hover:bg-[#f2f5f8]">
                  <td className={`${td} pl-6`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <FileText className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
                      {row.number || "—"}
                    </span>
                    <span className="block pl-6 text-[12px] text-[#7b8497]">{formatInvoiceDate(row.date)}</span>
                  </td>
                  <td className={td}>
                    <span className="block max-w-[260px] truncate" title={row.supplierName}>
                      {row.supplierName || "—"}
                    </span>
                    <span className="block text-[12px] text-[#7b8497]">
                      {row.supplierInn ? `${t("ИНН")} ${row.supplierInn}` : ""}
                      {!row.supplierId && <span className="text-[#c77700]">{row.supplierInn ? " · " : ""}{t("не сопоставлен")}</span>}
                    </span>
                  </td>
                  <td className={td}>
                    <span className="block max-w-[220px] truncate">{row.organizationName || row.buyerName || "—"}</span>
                    {row.buyerInn && <span className="block text-[12px] text-[#7b8497]">{`${t("ИНН")} ${row.buyerInn}`}</span>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {row.contractNumber ? (
                      <>
                        № {row.contractNumber}
                        {row.contractDate && <span className="block text-[12px] text-[#7b8497]">{`${t("от")} ${formatInvoiceDate(row.contractDate)}`}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>{formatInvoiceMoney(row.amountWithoutVat, row.currency)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>{formatInvoiceMoney(row.vatAmount, row.currency)}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`}>{formatInvoiceMoney(row.total, row.currency)}</td>
                  <td className={`${td} text-center`}>
                    <InvoiceStatusBadge status={row.status} title={row.status === "rejected" ? row.rejectReason : undefined} />
                  </td>
                  <td className={`${td} whitespace-nowrap`} onClick={(event) => event.stopPropagation()}>
                    {row.incoming ? (
                      <Link href="/analytics/supplier-incomings" className="font-semibold text-[#4f70e7] hover:underline">
                        {t("Приход №")} {row.incoming.id}
                      </Link>
                    ) : canEdit && row.status === "accepted" ? (
                      <button type="button" onClick={() => createSupply(row.id)} className="inline-flex items-center gap-1.5 rounded-md bg-[#71ce87] px-3 py-1.5 text-[13px] font-semibold text-white hover:brightness-95">
                        <Truck className="h-4 w-4" /> {t("Создать приход")}
                      </button>
                    ) : canEdit && row.status === "pending" ? (
                      <span className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void quickAccept(row)}
                          title={t("Принять")}
                          aria-label={t("Принять")}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#71ce87] text-[#2e9b52] hover:bg-[#e7f6ec] disabled:opacity-40"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => {
                            setRejectError("")
                            setRejectTarget(row)
                          }}
                          title={t("Отклонить")}
                          aria-label={t("Отклонить")}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#fa8072] text-[#d64545] hover:bg-[#fdecec] disabled:opacity-40"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-[#9aa3b6]">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-[#9aa3b6]">
                    {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <BalanceFilterDialog open={filterOpen} onClose={() => setFilterOpen(false)} from={seededPeriod.from} to={seededPeriod.to} onApply={applyFilter} dateLabel="Период (дата счет-фактуры)">
        <p className="text-[12px] text-[#9aa3b6] md:col-span-2">{t("Если период не менять, фильтр по дате не применяется.")}</p>
        <MultiPick
          label={t("Поставщик")}
          options={parties.suppliers}
          value={filterDraft.supplierIds.map(String)}
          onChange={(next) => setFilterDraft((current) => ({ ...current, supplierIds: next.map(Number) }))}
        />
        <MultiPick
          label={t("Организация")}
          options={parties.organizations}
          value={filterDraft.organizationIds.map(String)}
          onChange={(next) => setFilterDraft((current) => ({ ...current, organizationIds: next.map(Number) }))}
        />
        <MultiPick label={t("Валюта")} options={currencyOptions} value={filterDraft.currencies} onChange={(next) => setFilterDraft((current) => ({ ...current, currencies: next }))} />
      </BalanceFilterDialog>

      {state.viewId !== null && (
        <InvoiceViewDialog
          id={state.viewId}
          canEdit={canEdit}
          version={viewVersion}
          onClose={() => update({ viewId: null })}
          onEdit={(invoice) => setForm(invoice)}
          onChanged={list.reload}
          onCreateSupply={(invoice) => createSupply(invoice.id)}
          notify={notify}
        />
      )}

      {form !== undefined && (
        <InvoiceFormDialog
          invoice={form}
          onClose={() => setForm(undefined)}
          onSaved={(saved) => {
            setForm(undefined)
            notify("Успешно сохранено")
            list.reload()
            setViewVersion((value) => value + 1)
            update({ viewId: saved.id })
          }}
        />
      )}

      {rejectTarget && <InvoiceRejectDialog busy={busyId === rejectTarget.id} error={rejectError} onClose={() => setRejectTarget(null)} onConfirm={(reason) => void reject(reason)} />}

      {importOpen && (
        <InvoiceImportDialog
          onClose={() => setImportOpen(false)}
          onDone={(created) => {
            notify(`${t("Импортировано")}: ${created}`)
            update({ tab: "pending", page: 1 })
            list.reload()
          }}
        />
      )}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
