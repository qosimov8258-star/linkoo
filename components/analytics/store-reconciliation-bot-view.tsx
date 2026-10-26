"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, FileSpreadsheet, MinusCircle, PlusCircle, Search, Send } from "lucide-react"

import { ClientActDialog } from "@/components/analytics/balance/client-act-dialog"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery, type BalanceQuery } from "@/components/analytics/balance/use-balance"
import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { CorrectionDialog, DeadlineDialog, TelegramDialog } from "@/components/analytics/store-reconciliation-dialogs"
import {
  countReconciliationFilters,
  emptyReconciliationFilters,
  ReconciliationFilterDialog,
  reconciliationQuery,
  stateFromParams,
  stateToSearch,
  type ReconciliationState,
} from "@/components/analytics/store-reconciliation-filters"
import { DebtImportDialog } from "@/components/analytics/store-reconciliation-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, formatMoney, roundMoney } from "@/lib/finance/currency"
import { formatStatementDate, todayIso } from "@/lib/finance/dates"
import type { BalanceDateMode, CurrencyBalance } from "@/lib/finance/types"
import {
  reconciliationStatusColor,
  reconciliationStatusLabel,
  type ReconciliationVariant,
  type StoreReconciliationListResult,
  type StoreReconciliationOptions,
  type StoreReconciliationRow,
} from "@/lib/finance-store-reconciliation-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Сверка магазина через бот" (demo #/sales-market-balance, variant "client")
// and "Сверка счетов" (demo #/client-balance, variant "account"): every
// client's / account's balance on a day per currency split into cash / bank,
// the base-currency total, the bot reconciliation status, debt term, days since
// the last payment / order and the number of orders (GET
// /api/store-reconciliation, shared ledger — totals equal "Баланс клиентов" /
// "Долги по счетам"). Row actions: debt term, Telegram reconciliation
// (recorded only: no bot is connected), Списать / Добавить; Excel exports; the
// client / account act on row click; "Установить долг с Excel" only for shops
// (the demo "Сверка счетов" has no such button).

const LIST_URL = "/api/store-reconciliation"

const SUMMARY: SummaryBox[] = [
  { metrics: [{ label: "Наличными", field: "cash" }] },
  { metrics: [{ label: "Перечисления", field: "bank" }] },
  { align: "right", metrics: [{ label: "Общий", field: "total" }] },
]

/** Demo grid colours (4614): Сумма green #92ce95 / red #e27676. */
function totalColor(value: number): string | undefined {
  if (value > 0) return "#92ce95"
  if (value < 0) return "#e27676"
  return undefined
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

function useReconciliationList(url: string) {
  const [data, setData] = useState<StoreReconciliationListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (StoreReconciliationListResult & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
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

type RowDialog = { kind: "telegram" | "deadline" | "expense" | "income"; row: StoreReconciliationRow } | null

const TITLES: Record<ReconciliationVariant, string> = {
  client: "Сверка магазина через бот",
  account: "Сверка счетов",
}

export function StoreReconciliationBotView({ variant = "client" }: { variant?: ReconciliationVariant }) {
  const { t, language } = useLanguage()
  const isAccount = variant === "account"
  // Both variants share the reference's grid (300px client column + 100px columns, white card); only the header colour differs.
  const refGrid = true
  const title = TITLES[variant]
  const searchParams = useSearchParams()
  const [state, setState] = useState<ReconciliationState>(() => stateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dialog, setDialog] = useState<RowDialog>(null)
  const [options, setOptions] = useState<StoreReconciliationOptions | null>(null)
  const [user, setUser] = useState<{ name: string; canEdit: boolean }>({ name: "", canEdit: false })
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const query = useMemo(() => reconciliationQuery(state), [state])
  const listUrl = useCallback((params: BalanceQuery) => `${LIST_URL}?${buildBalanceQuery(isAccount ? { variant, ...params } : params)}`, [isAccount, variant])
  const { data, loading, error, reload } = useReconciliationList(listUrl(query))

  // The demo keeps everything in the URL query.
  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    fetchJson<StoreReconciliationOptions>(`${LIST_URL}/options`)
      .then(setOptions)
      .catch(() => setOptions(null))
    // Row actions / Excel debt import = demo can_add_none_type_client_transaction → manager or admin (the POST routes require manager).
    fetchJson<{ role?: string; displayName?: string; username?: string }>("/api/auth/me")
      .then((me) => setUser({ name: me.displayName || me.username || "", canEdit: me.role === "manager" || me.role === "admin" }))
      .catch(() => setUser({ name: "", canEdit: false }))
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  // A page past the end (stale URL, rows gone) jumps to the last page.
  useEffect(() => {
    if (!data || loading || data.rows.length || state.page <= 1) return
    const lastPage = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > lastPage) setState((current) => ({ ...current, page: lastPage }))
  }, [data, loading, state.page, state.pageSize])

  const update = (patch: Partial<ReconciliationState>) => setState((current) => ({ ...current, ...patch }))
  const changeMode = (mode: BalanceDateMode) => {
    if (mode !== state.mode) update({ mode, page: 1 })
  }

  const rows = data?.rows ?? []
  const columnCurrencies = useMemo(() => (data?.currencies ?? []).map((currency) => currency.code), [data])
  const cardTotals = useMemo(() => {
    const out: Record<string, CurrencyBalance> = {}
    for (const [code, money] of Object.entries(data?.totals ?? {})) out[code] = { ...money, begin_balance: 0, end_balance: money.total }
    return out
  }, [data])
  const filterCount = countReconciliationFilters(state.filters)
  const asOf = data?.asOf ?? (state.filters.debtDate || todayIso())

  const daysText = (value: number | null) => (value === null ? "—" : `${formatMoney(value, 0)} ${t("дня")}`)
  const deadlineText = (value: string | null) => (value ? formatStatementDate(value, language, false) : t("Не указано"))

  // --- Excel ---------------------------------------------------------------------------------
  const cashBankHeaders = (codes: string[]) => codes.flatMap((code) => [`${currencyLabel(code)}${t(" нал.")}`, `${currencyLabel(code)}${t(" переч.")}`])
  const cashBankCells = (row: StoreReconciliationRow, codes: string[]) => codes.flatMap((code) => [roundMoney(row.currencies[code]?.cash ?? 0), roundMoney(row.currencies[code]?.bank ?? 0)])

  /** "Список": the loaded page with the demo's list columns (4613 `re ∪ ie`). */
  const downloadPage = () => {
    if (!data) return
    const codes = columnCurrencies
    const sheet: Array<Array<string | number | null>> = [
      [t("Клиент"), t("После прошедшего заказа прошло"), t("Сумма"), ...cashBankHeaders(codes), t("Количество заказов")],
      ...rows.map((row) => [row.name, row.orderDays === null ? null : `${row.orderDays} ${t("дня")}`, row.total, ...cashBankCells(row, codes), row.orders]),
    ]
    downloadExcelTable(t("Статистика баланса клиентов"), sheet)
  }

  /** "Скачать все": every filtered row with every column + totals. */
  const downloadAll = async () => {
    try {
      const all = await fetchJson<StoreReconciliationListResult>(listUrl({ ...query, page: undefined, pageSize: 0 }))
      const codes = all.currencies.map((currency) => currency.code)
      const sheet: Array<Array<string | number | null>> = [
        [
          isAccount ? t("ИНН") : "ID",
          t("Клиент"),
          t("Статус сверки"),
          t("Срок долга"),
          t("Прошло дней после оплаты"),
          t("Прошло дней после заказа"),
          `${t("Сумма")} ${currencyLabel(all.baseCurrency)}`,
          ...cashBankHeaders(codes),
          t("Кол-во заказов"),
        ],
        ...all.rows.map((row) => [
          isAccount ? row.info.inn : row.id,
          row.name,
          t(reconciliationStatusLabel(row.status)),
          row.paymentDeadline ?? "",
          row.paymentDays,
          row.orderDays,
          row.total,
          ...cashBankCells(row, codes),
          row.orders,
        ]),
        [t("Итого"), "", "", "", null, null, all.total, ...codes.flatMap((code) => [all.totals[code]?.cash ?? 0, all.totals[code]?.bank ?? 0]), all.rows.reduce((sum, row) => sum + row.orders, 0)],
      ]
      downloadExcelTable(`${t(title)} ${all.asOf}`, sheet)
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? reason.message : t("Сервер недоступен, попробуйте ещё раз"), error: true })
    }
  }

  // --- table ----------------------------------------------------------------------------------
  const sortHeader = (sortKey: string, label: ReactNode) => {
    const icon = state.ordering.includes(sortKey) ? (
      <ArrowUp className="h-3.5 w-3.5" />
    ) : state.ordering.includes(`-${sortKey}`) ? (
      <ArrowDown className="h-3.5 w-3.5" />
    ) : (
      <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
    )
    return (
      <button type="button" onClick={() => update({ ordering: nextOrdering(state.ordering, sortKey, "asc-first"), page: 1 })} className={`inline-flex items-center gap-1 ${refGrid ? "justify-center whitespace-normal text-center" : "whitespace-nowrap"}`}>
        {label}
        {refGrid ? null : icon}
      </button>
    )
  }
  const openAct = (row: StoreReconciliationRow) => update({ openClient: { key: row.key, name: row.name } })
  const columnCount = 7 + columnCurrencies.length * 2
  const head = refGrid ? "border border-[#efefef] px-2 py-2 text-center text-[13px] font-semibold leading-[18px] whitespace-normal break-words" : "border border-[#6b87e3] px-4 py-3 text-left font-semibold"

  const actionButton = (title: string, icon: ReactNode, onClick: () => void, raw = false) => (
    <button
      type="button"
      title={raw ? title : t(title)}
      aria-label={raw ? title : t(title)}
      {...(raw ? { "data-no-translate": "" } : {})}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-full hover:bg-white"
    >
      {icon}
    </button>
  )

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-4 px-[28px]">
        <div className="flex items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t(title)}</span>
        </div>
        <div className="mt-[1px] -mr-[23px] flex h-[32px] w-[51%] overflow-hidden bg-white">
          {(
            [
              ["created", "По дате создания"],
              ["realization", "По дате реализации"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => changeMode(mode)}
              className={`flex-1 px-5 text-[13px] font-normal ${state.mode === mode ? "bg-[#71ce87] text-white shadow" : "bg-white text-[#586174]"}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </header>

      {!refGrid && (
        <div className="px-6 pt-4 text-[14px] text-[#586174] md:px-9">
          {t("Баланс на")} <strong className="text-[#4f70e7]">{formatStatementDate(asOf, language, false)}</strong>
        </div>
      )}
      <div className={refGrid ? "pt-1" : "pt-4"}>
        <BalanceSummaryCards plain marginClass="mx-[28px]" boxes={SUMMARY} totals={cardTotals} currencies={data?.visibleCurrencies ?? []} loading={loading} />
      </div>
      {data && data.missingRates.length > 0 && (
        <p className="px-6 pb-3 text-[13px] text-[#8a6d3b] md:px-9">
          {t("Нет курса валюты, не учтено в сумме")}: {data.missingRates.map(currencyLabel).join(", ")}
        </p>
      )}

      <div className={refGrid ? "mx-[28px] mt-[15px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" : ""}>
      <ExpandedOverlay expanded={expanded}>
        <section className="flex h-[55px] items-center gap-3 px-[30px]">
          <BalanceFilterChip
            count={filterCount}
            onOpen={() => setFilterOpen(true)}
            onClear={() => {
              setSearchDraft("")
              update({ filters: emptyReconciliationFilters(), search: "", page: 1, pageSize: 25, ordering: [] })
            }}
          />
          <form
            className="relative mx-auto flex min-w-[160px] flex-1 items-center justify-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              update({ search: searchDraft.trim(), page: 1 })
            }}
          >
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-[36px] w-[256px] border-b border-[#dbe0e8] bg-transparent text-[13px] outline-none placeholder:font-semibold placeholder:text-black focus:border-[#4f70e7]"
            />
            <button type="submit" aria-label={t("Поиск")} className="absolute left-[calc(50%+138px)] p-1.5 text-[#ccc]">
              <Search className="h-5 w-5" />
            </button>
          </form>
          <div className="flex items-center gap-3">
            {user.canEdit && !isAccount && (
              <button type="button" onClick={() => setImportOpen(true)} className="flex h-[34px] items-center gap-2 rounded-sm bg-[rgb(79,113,220)] px-4 font-semibold text-white">
                <FileSpreadsheet className="h-4 w-4" /> {t("Установить долг с Excel")}
              </button>
            )}
            <BalanceDownloadMenu
              disabled={!data}
              items={[
                { label: "Список", onClick: downloadPage },
                { label: "Скачать все", onClick: () => void downloadAll() },
              ]}
            />
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={({ page, pageSize }) => update({ page, pageSize })} />
            <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          </div>
        </section>

        {error && (
          <div className="flex items-center gap-3 px-6 py-3 text-[#e57373] md:px-9">
            <span>
              {t("Не удалось загрузить данные")}: {error}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
          <table className={`border-collapse text-[#666] ${refGrid ? "table-fixed text-[13px]" : "w-full min-w-[1150px] text-[14px]"}`} style={refGrid ? { width: 300 + 100 * (5 + columnCurrencies.length * 2 + 1) } : undefined}>
            {refGrid && (
              <colgroup>
                <col style={{ width: 300 }} />
                {Array.from({ length: 5 + columnCurrencies.length * 2 + 1 }, (_, index) => (
                  <col key={index} style={{ width: 100 }} />
                ))}
              </colgroup>
            )}
            <thead className={`sticky top-0 z-[1] bg-[#f0f4f9] text-[#374557]`}>
              <tr>
                <th className={`${head} sticky left-0 z-[2] min-w-[300px] bg-[#f0f4f9]`}>{t("Клиент")}</th>
                <th className={head}>{sortHeader("status", t("Статус сверки"))}</th>
                <th className={head}>{sortHeader("deadline", t("Срок долга"))}</th>
                <th className={head}>{sortHeader("payment_days", t("Прошло дней после оплаты"))}</th>
                <th className={head}>{sortHeader("order_days", t("Прошло дней после заказа"))}</th>
                <th className={head}>{sortHeader("total", t("Сумма"))}</th>
                {columnCurrencies.flatMap((code) =>
                  (["cash", "bank"] as const).map((field) => (
                    <th key={`${field}.${code}`} className={head}>
                      {sortHeader(`${field}.${code}`, `${currencyLabel(code)}${t(field === "cash" ? " нал." : " переч.")}`)}
                    </th>
                  )),
                )}
                <th className={head}>{sortHeader("orders", t("Кол-во заказов"))}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const background = index % 2 ? "#ffffff" : "#F4F8FB"
                const cell = "cursor-pointer border-b border-r border-[#efefef] px-[6px] py-[3px] leading-[16px]"
                const overdue = Boolean(row.paymentDeadline && row.paymentDeadline < todayIso())
                return (
                  <tr key={row.key} style={{ background }} className="group hover:!bg-[#e9f8ff] hover:font-semibold">
                    <td className="sticky left-0 z-[1] border-b border-r border-[#efefef] px-4 py-2" style={{ background: "inherit" }}>
                      <div className="relative flex min-h-[30px] w-[300px] items-center">
                        <span className="truncate">{row.name || "No"}</span>
                        {user.canEdit && (
                          <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 bg-gradient-to-r from-transparent to-[#F4F8FB] pl-6 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">

                            {actionButton("Изменить срок долга", <CalendarClock className="h-5 w-5 text-[rgb(93,100,116)]" />, () => setDialog({ kind: "deadline", row }), true)}
                            {actionButton("Телеграм", <Send className="h-5 w-5 text-[rgb(93,100,116)]" />, () => setDialog({ kind: "telegram", row }))}
                            {actionButton("Списать", <MinusCircle className="h-5 w-5 text-[#ff584b]" />, () => setDialog({ kind: "expense", row }))}
                            {actionButton("Добавить", <PlusCircle className="h-5 w-5 text-[#8dc572]" />, () => setDialog({ kind: "income", row }))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className={cell} onClick={() => openAct(row)}>
                      <span className="font-semibold" style={{ color: reconciliationStatusColor(row.status) }}>
                        {t(reconciliationStatusLabel(row.status))}
                      </span>
                    </td>
                    <td className={cell} onClick={() => openAct(row)}>
                      <span style={overdue ? { color: "#e27676", fontWeight: 600 } : { color: row.paymentDeadline ? "#000" : undefined }}>{deadlineText(row.paymentDeadline)}</span>
                    </td>
                    <td className={cell} onClick={() => openAct(row)}>
                      <span style={row.paymentDays !== null && row.paymentDays > 20 ? { color: "#e27676", fontWeight: 600 } : undefined}>{daysText(row.paymentDays)}</span>
                    </td>
                    <td className={cell} onClick={() => openAct(row)}>
                      {daysText(row.orderDays)}
                    </td>
                    <td className={cell} onClick={() => openAct(row)}>
                      <span className="font-semibold" style={{ color: totalColor(row.total) }}>
                        {formatMoney(row.total)}
                      </span>
                    </td>
                    {columnCurrencies.flatMap((code) =>
                      (["cash", "bank"] as const).map((field) => (
                        <td key={`${field}.${code}`} className={cell} onClick={() => openAct(row)}>
                          {formatMoney(row.currencies[code]?.[field] ?? 0)}
                        </td>
                      )),
                    )}
                    <td className={cell} onClick={() => openAct(row)}>
                      {formatMoney(row.orders, 0)}
                    </td>
                  </tr>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={columnCount} className="border-b border-[#efefef] px-4 py-16 text-center text-[#9aa3b6]">
                    {loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ExpandedOverlay>
      </div>

      <ReconciliationFilterDialog
        open={filterOpen}
        filters={state.filters}
        options={options}
        onClose={() => setFilterOpen(false)}
        onApply={(filters) => update({ filters, search: searchDraft.trim(), page: 1 })}
      />

      {state.openClient && (
        <ClientActDialog
          key={state.openClient.key}
          kind={variant}
          entityKey={state.openClient.key}
          name={state.openClient.name}
          from={`${asOf.slice(0, 8)}01`}
          to={asOf}
          mode={state.mode}
          onClose={() => update({ openClient: null })}
        />
      )}

      {dialog?.kind === "telegram" && (
        <TelegramDialog
          entity={{ variant, key: dialog.row.key, name: dialog.row.name }}
          canSend={user.canEdit}
          asOf={asOf}
          mode={state.mode}
          onClose={() => setDialog(null)}
          onSent={(text, isError) => {
            setNotice({ text, error: isError })
            reload()
          }}
        />
      )}
      {dialog?.kind === "deadline" && (
        <DeadlineDialog
          entity={{ variant, key: dialog.row.key, name: dialog.row.name }}
          current={dialog.row.paymentDeadline}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setNotice({ text: t("Успешно сохранено"), error: false })
            reload()
          }}
        />
      )}
      {(dialog?.kind === "expense" || dialog?.kind === "income") && (
        <CorrectionDialog
          row={dialog.row}
          kind={dialog.kind}
          options={options}
          userName={user.name}
          currencies={data?.visibleCurrencies ?? columnCurrencies}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setNotice({ text: t("Успешно сохранено"), error: false })
            reload()
          }}
        />
      )}

      {!isAccount && (
        <DebtImportDialog
          open={importOpen}
          options={options}
          listQuery={query}
          initialDate={state.filters.debtDate || todayIso()}
          mode={state.mode}
          onClose={() => setImportOpen(false)}
          onImported={(count) => {
            setNotice({ text: count ? t("Клиенты успешно добавлены") : t("Изменений нет"), error: false })
            reload()
          }}
        />
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-[120] max-w-[90vw] -translate-x-1/2 rounded-md px-5 py-3 font-semibold text-white shadow-lg ${notice.error ? "bg-[#e57373]" : "bg-[#48a34b]"}`}
        >
          {notice.text}
        </div>
      )}
    </main>
  )
}
