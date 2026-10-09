"use client"

import { Fragment, useState } from "react"
import { ChevronDown, ChevronRight, Download, Filter, Trash2 } from "lucide-react"

import { buildCashQuery, cashMutate, useAcceptGroups, useAgentPayments } from "@/components/analytics/cash/use-cash"
import {
  CashModal,
  ConfirmDialog,
  EmptyBlock,
  ErrorBlock,
  FormField,
  LoadingBlock,
  MiniPager,
  MultiPick,
  PrimaryButton,
  ReadonlyField,
  SearchSelect,
  formatCash,
  formatCashDate,
  inputClass,
  mutationError,
  useJsonList,
  type AcceptCashResult,
  type Named,
} from "@/components/analytics/cash-management-shared"
import type { AcceptGroup, AgentPayment, CashboxWithBalance } from "@/lib/cash/types"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// "Принять деньги" → "Принять наличные" (demo modules 3850 / 3851 / 3852 /
// 2349): client payments collected by agents (customer_payments without a
// cashbox, not accepted) grouped by agent × currency × organization × branch ×
// agent cashbox. A group expands into its payments; "Принять" accepts one
// payment, "Принять все" the whole group, into the chosen cashbox
// (POST /api/cash/accept-cash) — the list then shows a type-8 row.

const PAGE_SIZE = 25

type AcceptTarget = { group: AcceptGroup; payment: AgentPayment | null }

export function CashAcceptDialog({
  cashboxes,
  canWrite,
  onClose,
  onSaved,
}: {
  cashboxes: CashboxWithBalance[]
  canWrite: boolean
  onClose: () => void
  /** After an accept / delete: refetch the list and balances. */
  onSaved: (message: string, result?: AcceptCashResult) => void
}) {
  const { t, language } = useLanguage()
  const [period, setPeriod] = useState({ from: "", to: "" })
  const [filterOpen, setFilterOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [agentCashboxes, setAgentCashboxes] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<AcceptTarget | null>(null)
  const [deleting, setDeleting] = useState<AgentPayment | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState("")

  const branchList = useJsonList<Named>(filterOpen ? "/api/branches" : null).items
  const groupsState = useAcceptGroups({ from: period.from, to: period.to, branch: branches, cashbox: agentCashboxes })
  const groups = groupsState.data?.groups ?? []
  const group = groups.find((item) => item.key === expanded) ?? null
  const payments = useAgentPayments(group ? { ...groupFilter(group), agentCashbox: group.agentCashbox?.id ?? "", from: period.from, to: period.to, page, pageSize: PAGE_SIZE } : null)
  const filterCount = (branches.length ? 1 : 0) + (agentCashboxes.length ? 1 : 0)

  const totals = groups.reduce<Record<string, number>>((sum, item) => ({ ...sum, [item.currency]: (sum[item.currency] ?? 0) + item.amount }), {})

  const reloadAll = () => {
    groupsState.reload()
    payments.reload()
  }

  const downloadGroup = async () => {
    if (!group) return
    const response = await fetch(`/api/cash/accept-cash/payments?${buildCashQuery({ ...groupFilter(group), agentCashbox: group.agentCashbox?.id ?? "", from: period.from, to: period.to, page: 1, pageSize: 5000 })}`, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as { rows?: AgentPayment[] } | null
    const rows = body?.rows ?? []
    downloadExcelTable(`accept-cash-${group.agent || "agent"}`, [
      ["№", t("Клиент"), t("Касса"), t("Филиал"), t("Организация"), t("Дата"), t("Сумма"), t("Валюта"), t("Комментарий")],
      ...rows.map((row) => [row.docNo, row.client.name, row.agentCashbox?.name ?? t("Не указано"), row.branch, row.organization, row.date.replace("T", " ").slice(0, 16), row.amount, currencyLabel(row.currency), row.comment]),
    ])
  }

  const removePayment = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    const result = await cashMutate("DELETE", `/api/cash/operations/customer-${deleting.id}`)
    setDeleteBusy(false)
    if (!result.ok) return setDeleteError(mutationError(result, t))
    setDeleting(null)
    reloadAll()
    onSaved("Успешно удалено")
  }

  return (
    <CashModal
      title={t("Принять наличные")}
      onClose={onClose}
      size="xl"
      headerExtra={
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-normal normal-case">
          <button type="button" onClick={() => setFilterOpen((current) => !current)} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#4f70e7] px-3 font-semibold text-[#4f70e7]">
            <Filter className="h-4 w-4" />
            {filterCount ? `${t("Фильтр")}: ${filterCount} ${t("элемента")}` : t("Показать фильтр")}
          </button>
          <span className="text-[#586174]">{t("Укажите период создания")}</span>
          <input type="date" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} className="h-9 rounded-md border border-[#dbe0e8] px-2" aria-label={t("Укажите период создания")} />
          <span>—</span>
          <input type="date" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} className="h-9 rounded-md border border-[#dbe0e8] px-2" aria-label={t("Укажите период создания")} />
        </div>
      }
    >
      {filterOpen && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-md bg-[#f7f9fc] p-3 sm:grid-cols-2">
          <MultiPick label={t("Филиалы")} options={branchList.map((item) => ({ value: item.name, label: item.name }))} value={branches} onChange={setBranches} />
          <MultiPick label={t("Касса")} options={cashboxes.map((item) => ({ value: String(item.id), label: item.name }))} value={agentCashboxes} onChange={setAgentCashboxes} />
        </div>
      )}

      {groupsState.loading && !groupsState.data && <LoadingBlock />}
      {groupsState.error && <ErrorBlock error={groupsState.error} onRetry={groupsState.reload} />}
      {groupsState.data && !groups.length && <EmptyBlock text="Никакой платеж не произведен" />}

      {groups.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[14px]">
            <thead>
              <tr className="bg-[#626b7e] text-left text-white">
                <th className="w-8 px-2 py-3" />
                <th className="px-3 py-3 font-semibold">{t("Создал")}</th>
                <th className="px-3 py-3 font-semibold">{t("Касса")}</th>
                <th className="px-3 py-3 font-semibold">{t("Филиал")}</th>
                <th className="px-3 py-3 font-semibold">{t("Организация")}</th>
                <th className="px-3 py-3 text-right font-semibold">{t("Сумма")}</th>
                <th className="w-32 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {groups.map((item) => {
                const open = item.key === expanded
                return (
                  <Fragment key={item.key}>
                    <tr
                      onClick={() => {
                        setExpanded(open ? null : item.key)
                        setPage(1)
                      }}
                      className={`cursor-pointer border-b border-dashed border-[#d8dee7] hover:bg-[#f2f5f8] ${open ? "bg-[#f2f5f8]" : ""}`}
                    >
                      <td className="px-2 py-3 text-[#9aa3b6]">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="px-3 py-3 font-semibold">{item.agent || t("Не указано")}</td>
                      <td className="px-3 py-3">{item.agentCashbox?.name ?? t("Не указано")}</td>
                      <td className="px-3 py-3">{item.branch || "—"}</td>
                      <td className="px-3 py-3">{item.organization || "—"}</td>
                      <td className="px-3 py-3 text-right font-semibold whitespace-nowrap text-[#4f71dc]">{formatCash(item.amount, item.currency)}</td>
                      <td className="px-3 py-3 text-right">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setTarget({ group: item, payment: null })
                            }}
                            className="rounded-md bg-[#71ce87] px-4 py-1.5 font-semibold text-white hover:brightness-95"
                          >
                            {t("Принять")}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[#d8dee7] bg-[#fbfcfe]">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="mb-3 flex flex-wrap items-center gap-3">
                            <b className="text-[#17233b]">{item.agent || t("Не указано")}</b>
                            <button type="button" onClick={downloadGroup} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#4caf72] hover:underline">
                              <Download className="h-4 w-4" /> Excel
                            </button>
                            <span className="text-[#586174]">
                              {t("Сумма")}: <b className="text-[#4f71dc]">{formatCash(item.amount, item.currency)}</b> ({item.count})
                            </span>
                            {canWrite && (
                              <button type="button" onClick={() => setTarget({ group: item, payment: null })} className="ml-auto rounded-md bg-[#71ce87] px-4 py-1.5 font-semibold text-white hover:brightness-95">
                                {t("Принять все")}
                              </button>
                            )}
                          </div>
                          {payments.loading && !payments.data && <LoadingBlock className="py-6" />}
                          {payments.error && <ErrorBlock error={payments.error} onRetry={payments.reload} />}
                          {payments.data && (
                            <>
                              <table className="w-full text-[13px]">
                                <thead>
                                  <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
                                    <th className="px-2 py-2 font-semibold">№</th>
                                    <th className="px-2 py-2 font-semibold">{t("Клиент")}</th>
                                    <th className="px-2 py-2 font-semibold">{t("Касса")}</th>
                                    <th className="px-2 py-2 font-semibold">{t("Филиал")}</th>
                                    <th className="px-2 py-2 font-semibold">{t("Дата")}</th>
                                    <th className="px-2 py-2 text-right font-semibold">{t("Сумма")}</th>
                                    <th className="px-2 py-2" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {payments.data.rows.map((payment) => (
                                    <tr key={payment.id} className="border-b border-dashed border-[#e1e5eb]">
                                      <td className="px-2 py-2" title={payment.comment || undefined}>
                                        {payment.docNo}
                                        {payment.comment ? <span className="ml-1 text-[11px] text-[#9aa3b6]">({t("ком.")})</span> : null}
                                      </td>
                                      <td className="px-2 py-2">{payment.client.name}</td>
                                      <td className="px-2 py-2">{payment.agentCashbox?.name ?? t("Не указано")}</td>
                                      <td className="px-2 py-2">{payment.branch || "—"}</td>
                                      <td className="px-2 py-2 whitespace-nowrap">{formatCashDate(payment.date, language)}</td>
                                      <td className="px-2 py-2 text-right whitespace-nowrap">
                                        <span className="font-semibold">{formatCash(payment.amount, payment.currency)}</span>
                                        {normCurrency(payment.debtCurrency) !== normCurrency(payment.currency) || payment.debtAmount !== payment.amount ? (
                                          <span className="block text-[11px] text-[#586174]">{formatCash(payment.debtAmount, payment.debtCurrency)}</span>
                                        ) : null}
                                      </td>
                                      <td className="px-2 py-2 text-right whitespace-nowrap">
                                        {canWrite && (
                                          <span className="inline-flex items-center gap-2">
                                            <button type="button" onClick={() => setTarget({ group: item, payment })} className="rounded-md bg-[#71ce87] px-3 py-1 font-semibold text-white hover:brightness-95">
                                              {t("Принять")}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setDeleteError("")
                                                setDeleting(payment)
                                              }}
                                              aria-label={t("Удалить")}
                                              className="text-[#e57373] hover:text-[#c94b4b]"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                  {!payments.data.rows.length && (
                                    <tr>
                                      <td colSpan={7} className="px-2 py-6 text-center text-[#9aa3b6]">
                                        {t("Никакой платеж не произведен")}
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[13px] text-[#586174]">
                                  {t("Общая сумма")}: <b className="text-[#17233b]">{formatCash(payments.data.total, payments.data.currency)}</b>
                                </span>
                                <MiniPager page={page} pageSize={PAGE_SIZE} count={payments.data.count} onPage={setPage} />
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 text-right text-[14px] text-[#586174]">
            {t("Общая сумма")}:{" "}
            {Object.entries(totals).map(([currency, amount], index) => (
              <b key={currency} className="text-[#17233b]">
                {index > 0 && ", "}
                {formatCash(amount, currency)}
              </b>
            ))}
          </p>
        </div>
      )}

      {target && (
        <AcceptConfirmDialog
          target={target}
          period={period}
          cashboxes={cashboxes}
          onClose={() => setTarget(null)}
          onSaved={(result) => {
            setTarget(null)
            if (!target.payment) setExpanded(null)
            reloadAll()
            onSaved("Успешно сохранено", result)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`${t("Транзакция")} №${deleting.docNo}`}
          text={`${deleting.client.name} · ${formatCash(deleting.amount, deleting.currency)}`}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={removePayment}
          onClose={() => setDeleting(null)}
        />
      )}
    </CashModal>
  )
}

function groupFilter(group: AcceptGroup) {
  return { agent: group.agent, currency: group.currency, organization: group.organization, branch: group.branch }
}

/** "Принять наличные <amount cur>" (demo 3851): read-only agent data, Время / Дата, Транзакция, Кассы. */
function AcceptConfirmDialog({
  target,
  period,
  cashboxes,
  onClose,
  onSaved,
}: {
  target: AcceptTarget
  period: { from: string; to: string }
  cashboxes: CashboxWithBalance[]
  onClose: () => void
  onSaved: (result: AcceptCashResult) => void
}) {
  const { t } = useLanguage()
  const { group, payment } = target
  const amount = payment ? payment.amount : group.amount
  const currency = payment ? payment.currency : group.currency
  // Demo: cashboxes of the payment currency; default = the agent cashbox.
  const options = cashboxes.filter((item) => normCurrency(item.currency) === normCurrency(currency))
  const [cashboxId, setCashboxId] = useState(() => {
    const agentBox = group.agentCashbox?.id ? options.find((item) => item.id === group.agentCashbox?.id) : undefined
    return agentBox ? String(agentBox.id) : options.length === 1 ? String(options[0].id) : ""
  })
  const [date, setDate] = useState(() => nowLocalIso().slice(0, 16))
  const [comment, setComment] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!cashboxId) return setError(t("Выберите кассу"))
    setBusy(true)
    const body = payment
      ? { cashboxId: Number(cashboxId), date, comment: comment.trim() || undefined, ids: [payment.id] }
      : {
          cashboxId: Number(cashboxId),
          date,
          comment: comment.trim() || undefined,
          group: { ...groupFilter(group), agentCashboxId: group.agentCashbox?.id ?? null, from: period.from || undefined, to: period.to || undefined },
        }
    const result = await cashMutate<AcceptCashResult>("POST", "/api/cash/accept-cash", body)
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved(result.data)
  }

  return (
    <CashModal
      title={`${t("Принять наличные")} ${formatCash(amount, currency)}`}
      onClose={onClose}
      size="sm"
      zIndex={140}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton tone="green" busy={busy} onClick={submit}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ReadonlyField label={t("Агент")} value={group.agent || t("Не указано")} />
        <ReadonlyField label={t("Организация")} value={group.organization} />
        <ReadonlyField label={t("Филиал")} value={group.branch} />
        <ReadonlyField label={t("Касса агента")} value={group.agentCashbox?.name ?? t("Не указано")} />
        <FormField label={t("Время")}>
          <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </FormField>
        {payment && <ReadonlyField label={t("Транзакция")} value={`№ ${payment.docNo} · ${payment.client.name}`} />}
        <FormField label={t("Кассы")} required>
          <SearchSelect
            value={cashboxId}
            onChange={(value) => {
              setCashboxId(value)
              setError("")
            }}
            options={(options.length ? options : cashboxes).map((item) => ({ value: String(item.id), label: `${item.name} (${currencyLabel(item.currency)})`, hint: item.branch }))}
            placeholder={t("Кассы")}
          />
        </FormField>
        <FormField label={t("Комментарий...")}>
          <input value={comment} onChange={(event) => setComment(event.target.value)} className={inputClass} />
        </FormField>
      </div>
    </CashModal>
  )
}
