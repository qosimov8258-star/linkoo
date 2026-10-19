"use client"

import { useState, type ReactNode } from "react"
import { CheckCircle2, Info, Pencil, RotateCcw, Trash2, XCircle } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, LoadingBlock, formatCashDate, mutationError } from "@/components/analytics/cash-management-shared"
import { ContractStatusBadge } from "@/components/analytics/contracts-fields"
import type { ContractDetail, ContractStatus } from "@/lib/contracts-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Demo ContractsDetail (modules 4948 + 4949), shown in place of the clicked row:
// "Договоры {№}" + "Изменить"; left — Официальное название, Дата создания,
// Клиент ("name (zone)" each), Агент, ИНН, Год, Организация, Комментарий, Статус;
// right — "Транзакции": payments made under the contract (№, Дата, Создал, Сумма,
// comment tooltip) plus client / cashbox and the totals per currency.

function InfoRow({ label, children, column = false }: { label: string; children: ReactNode; column?: boolean }) {
  return (
    <li className={`flex gap-x-3 border-b border-dashed border-[#e1e5eb] py-1.5 leading-[22px] last:border-none ${column ? "flex-col" : "flex-wrap justify-between"}`}>
      <span className="text-[#586174]">{label}:</span>
      <span className={`font-semibold text-[#17233b] ${column ? "" : "text-right"}`}>{children}</span>
    </li>
  )
}

export function ContractDetailPanel({
  id,
  canEdit,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
  notify,
}: {
  id: number
  canEdit: boolean
  onClose: () => void
  onEdit: (contract: ContractDetail) => void
  onChanged: () => void
  onDeleted: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<ContractDetail>(`/api/contracts/${id}`)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  const data = detail.data

  const changeStatus = async (status: ContractStatus) => {
    setBusy(true)
    const result = await cashMutate<ContractDetail>("PATCH", `/api/contracts/${id}`, { status })
    setBusy(false)
    if (!result.ok) return notify(mutationError(result, t), true)
    detail.reload()
    onChanged()
    notify(t("Успешно сохранено"))
  }

  const remove = async () => {
    setBusy(true)
    const result = await cashMutate("DELETE", `/api/contracts/${id}`)
    setBusy(false)
    if (!result.ok) return setDeleteError(mutationError(result, t))
    setConfirmDelete(false)
    notify(t("Успешно удалено"))
    onDeleted()
  }

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const iconButton = "flex h-10 w-10 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:opacity-40"
  return (
    <div className="bg-white text-[14px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex min-h-[65px] items-center justify-between gap-3 border-b border-[#efefef] px-4 md:px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] truncate text-[18px] font-semibold text-[#333]">
          {t("Договоры")} {data.fullNumber}
        </h3>
        {canEdit && (
          <div className="relative z-[3] flex items-center">
            {data.status === "active" ? (
              <>
                <button type="button" disabled={busy} onClick={() => void changeStatus("completed")} title={t("Завершить")} aria-label={t("Завершить")} className={iconButton}>
                  <CheckCircle2 className="h-5 w-5" />
                </button>
                <button type="button" disabled={busy} onClick={() => void changeStatus("cancelled")} title={t("Отменить")} aria-label={t("Отменить")} className={iconButton}>
                  <XCircle className="h-5 w-5" />
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => void changeStatus("active")} title={t("Активировать")} aria-label={t("Активировать")} className={iconButton}>
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => onEdit(data)} title={t("Изменить")} aria-label={t("Изменить")} className={iconButton}>
              <Pencil className="h-5 w-5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDeleteError("")
                setConfirmDelete(true)
              }}
              title={t("Удалить")}
              aria-label={t("Удалить")}
              className={iconButton}
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row">
        <div className="border-b border-[#efefef] px-4 py-4 md:w-[340px] md:shrink-0 md:border-b-0 md:border-r md:px-[30px]">
          <ul>
            <InfoRow label={t("Официальное название")} column>
              {data.officialName || t("Не указано")}
            </InfoRow>
            <InfoRow label={t("Дата создания")}>{data.createdDate ? formatCashDate(data.createdDate, language, false) : t("Не указан")}</InfoRow>
            <InfoRow label={t("Клиент")}>
              {data.clients.length
                ? data.clients.map((client, index) => (
                    <span key={`${client.id ?? "x"}-${index}`} className="block whitespace-nowrap">
                      {client.name} ({client.zone || t("Не указан")})
                    </span>
                  ))
                : t("Не указан")}
            </InfoRow>
            <InfoRow label={t("Агент")}>{data.agent.name || t("Не указан")}</InfoRow>
            <InfoRow label={t("ИНН")}>{data.inn || t("Не указан")}</InfoRow>
            <InfoRow label={t("Год")}>{data.year}</InfoRow>
            <InfoRow label={t("Организация")}>{data.organization.name || t("Не указано")}</InfoRow>
            <InfoRow label={t("Комментарий")}>{data.comment || t("Не указано")}</InfoRow>
            <InfoRow label={t("Статус")}>
              <ContractStatusBadge status={data.status} />
            </InfoRow>
          </ul>
        </div>

        <div className="min-w-0 flex-1 px-4 pb-5 md:px-5">
          <p className="mb-2.5 mt-5 font-semibold">{t("Транзакции")}</p>
          {data.transactions.length ? (
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-dashed border-[#e1e5eb] text-left font-semibold">
                    <th className="py-3 pr-3">№</th>
                    <th className="py-3 pr-3">{t("Дата")}</th>
                    <th className="py-3 pr-3">{t("Создал")}</th>
                    <th className="py-3 pr-3">{t("Клиент")}</th>
                    <th className="py-3 pr-3">{t("Касса")}</th>
                    <th className="py-3 pr-3 text-right">{t("Сумма")}</th>
                    <th className="w-10 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((item) => (
                    <tr key={item.id} className="border-b border-dashed border-[#e1e5eb] hover:bg-[#f2f5f8]">
                      <td className="py-3 pr-3">{item.docNo ?? item.id}</td>
                      <td className="whitespace-nowrap py-3 pr-3">
                        {item.date ? formatCashDate(item.date, language, false) : t("Не указан")}
                        {!item.accepted && (
                          <span className="ml-2 rounded bg-[#fff4e5] px-1.5 py-0.5 text-[11px] font-semibold text-[#f0ad4e]" title={t("Не подтвержден")}>
                            {t("Не подтвержден")}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3">{item.createdBy || t("Не указан")}</td>
                      <td className="max-w-[200px] truncate py-3 pr-3" title={item.client}>
                        {item.client || t("Не указан")}
                      </td>
                      <td className="max-w-[160px] truncate py-3 pr-3" title={item.cashbox}>
                        {item.cashbox || t("Не указан")}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right font-semibold">
                        {formatMoney(item.amount, 2)} {currencyLabel(item.currency)}
                      </td>
                      <td className="py-3 text-center">
                        {item.comment ? (
                          <span title={item.comment} className="inline-flex text-[rgb(79,113,220)]">
                            <Info className="h-4 w-4" />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="pt-3 pr-3" colSpan={5}>
                      {t("Итого")}
                    </td>
                    <td className="whitespace-nowrap pt-3 pr-3 text-right">
                      {data.totals.map((total) => (
                        <span key={total.currency} className="block">
                          {formatMoney(total.amount, 2)} {currencyLabel(total.currency)}
                        </span>
                      ))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyBlock text={`${t("По вашему запросу ничего не найдено")}...`} className="py-10" />
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t("Удалить договор")}
          text={`${t("Удалить договор")} № ${data.fullNumber}?`}
          busy={busy}
          error={deleteError}
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
