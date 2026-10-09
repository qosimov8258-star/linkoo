"use client"

import { Fragment, useEffect, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { cashMutate, useMoneyRequests } from "@/components/analytics/cash/use-cash"
import { supplierHref } from "@/components/analytics/cash-management-details"
import { CashModal, ConfirmDialog, EmptyBlock, ErrorBlock, LoadingBlock, MiniPager, formatCash, formatCashDate, mutationError } from "@/components/analytics/cash-management-shared"
import { MONEY_REQUEST_STATUS_LABELS, type MoneyRequest } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Запрос средств" (demo module 3859): approved money requests
// (GET /api/cash/money-requests?status=approved). "Оплатить" opens the Расход
// dialog in pay mode; the expanded row shows the request log and "Удалить"
// (PATCH {status: "cancelled"}).

const PAGE_SIZE = 25

export function CashRequestsDialog({
  canWrite,
  refreshToken,
  onClose,
  onPay,
  onChanged,
}: {
  canWrite: boolean
  /** Changes after a payment → refetch. */
  refreshToken: number
  onClose: () => void
  onPay: (request: MoneyRequest) => void
  onChanged: (message: string) => void
}) {
  const { t, language } = useLanguage()
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [cancelling, setCancelling] = useState<MoneyRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const { data, loading, error: loadError, reload } = useMoneyRequests({ status: "approved", page, pageSize: PAGE_SIZE })

  useEffect(() => {
    if (refreshToken) reload()
  }, [refreshToken, reload])

  const cancel = async () => {
    if (!cancelling) return
    setBusy(true)
    const result = await cashMutate<MoneyRequest>("PATCH", `/api/cash/money-requests/${cancelling.id}`, { status: "cancelled" })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    setCancelling(null)
    setExpanded(null)
    reload()
    onChanged("Успешно сохранено")
  }

  return (
    <CashModal title={t("Запрос средств")} onClose={onClose} size="lg" headerExtra={data ? <MiniPager page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} /> : null}>
      {loading && !data && <LoadingBlock />}
      {loadError && <ErrorBlock error={loadError} onRetry={reload} />}
      {data && !data.rows.length && <EmptyBlock text="Запросы отсутствуют" />}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-[14px]">
            <thead>
              <tr className="bg-[#626b7e] text-left text-white">
                <th className="w-8 px-2 py-3" />
                <th className="px-3 py-3 font-semibold">{t("Поставщик")}</th>
                <th className="px-3 py-3 font-semibold">{t("Комментарий")}</th>
                <th className="px-3 py-3 font-semibold">{t("Создал")}</th>
                <th className="px-3 py-3 font-semibold">{t("Дата")}</th>
                <th className="px-3 py-3 text-right font-semibold">{t("Сумма")}</th>
                <th className="w-32 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((request) => {
                const open = expanded === request.id
                return (
                  <Fragment key={request.id}>
                    <tr onClick={() => setExpanded(open ? null : request.id)} className={`cursor-pointer border-b border-dashed border-[#d8dee7] hover:bg-[#f2f5f8] ${open ? "bg-[#f2f5f8]" : ""}`}>
                      <td className="px-2 py-3 text-[#9aa3b6]">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="px-3 py-3">
                        <a href={supplierHref(request.supplier.id, request.supplier.name)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="text-[#4f70e7] hover:underline">
                          {request.supplier.name}
                        </a>
                      </td>
                      <td className="px-3 py-3">{request.comment || t("Нет описания")}</td>
                      <td className="px-3 py-3">{request.createdBy || request.responsibleUser || "—"}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatCashDate(request.createdAt, language)}</td>
                      <td className="px-3 py-3 text-right font-semibold whitespace-nowrap">{formatCash(request.amount, request.currency)}</td>
                      <td className="px-3 py-3 text-right">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              onPay(request)
                            }}
                            className="rounded-md bg-[#71ce87] px-4 py-1.5 font-semibold text-white hover:brightness-95"
                          >
                            {t("Оплатить")}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[#d8dee7] bg-[#fbfcfe]">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="mb-2 flex flex-wrap items-center gap-4 text-[13px] text-[#586174]">
                            <span>
                              {t("Баланс")}: <b className="text-[#17233b]">{formatCash(request.balances.balance, request.currency)}</b>
                            </span>
                            <span>
                              {t("Запас")}: <b className="text-[#17233b]">{formatCash(request.balances.reserve, request.currency)}</b>
                            </span>
                            <span>
                              {t("Остаток")}: <b className="text-[#17233b]">{formatCash(request.balances.remain, request.currency)}</b>
                            </span>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => {
                                  setError("")
                                  setCancelling(request)
                                }}
                                className="ml-auto rounded-md bg-[#fa8072] px-4 py-1.5 font-semibold text-white hover:brightness-95"
                              >
                                {t("Удалить")}
                              </button>
                            )}
                          </div>
                          <table className="w-full text-[13px]">
                            <thead>
                              <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
                                <th className="px-2 py-1.5 font-semibold">{t("Комментарий")}</th>
                                <th className="px-2 py-1.5 font-semibold">{t("Статус")}</th>
                                <th className="px-2 py-1.5 font-semibold">{t("Создал")}</th>
                                <th className="px-2 py-1.5 font-semibold">{t("Дата")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {request.logs.map((log, index) => (
                                <tr key={index} className="border-b border-dashed border-[#e1e5eb]">
                                  <td className="px-2 py-1.5">{log.comment || "—"}</td>
                                  <td className="px-2 py-1.5">{t(log.status in MONEY_REQUEST_STATUS_LABELS ? MONEY_REQUEST_STATUS_LABELS[log.status as keyof typeof MONEY_REQUEST_STATUS_LABELS] : log.status === "created" ? "Создан" : "Изменен")}</td>
                                  <td className="px-2 py-1.5">{log.user || "—"}</td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">{formatCashDate(log.at, language)}</td>
                                </tr>
                              ))}
                              {!request.logs.length && (
                                <tr>
                                  <td colSpan={4} className="px-2 py-3 text-center text-[#9aa3b6]">
                                    —
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {cancelling && (
        <ConfirmDialog
          title={t("Удалить")}
          text={`${t("Запрос")}: ${cancelling.comment || t("Нет описания")}`}
          busy={busy}
          error={error}
          onConfirm={cancel}
          onClose={() => setCancelling(null)}
        />
      )}
    </CashModal>
  )
}
