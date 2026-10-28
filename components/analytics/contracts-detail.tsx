"use client"

import { useState, type ReactNode } from "react"
import { Info } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, LoadingBlock, formatCashDate, mutationError } from "@/components/analytics/cash-management-shared"
import { formatCategoryDate } from "@/components/analytics/categories-grid"
import { CONTRACT_STATUS_LABELS, type ContractDetail, type ContractStatus } from "@/lib/contracts-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Demo ContractsDetail (modules 4948 + 4949), shown in place of the clicked row:
// "Договоры {№}" + "Изменить"; left — Официальное название, Дата создания,
// Клиент ("name (zone)" each), Агент, ИНН, Год, Организация, Комментарий, Статус;
// right — "Транзакции": payments made under the contract (№, Дата, Создал, Сумма,
// comment tooltip) plus client / cashbox and the totals per currency.

function InfoRow({ label, children, column = false }: { label: string; children: ReactNode; column?: boolean }) {
  return (
    <li className={`flex gap-x-3 py-[3px] text-[13px] leading-[19px] ${column ? "flex-col" : "flex-wrap justify-between"}`}>
      <span className="text-[#333]">{label}:</span>
      <span className={`font-semibold text-[#333] ${column ? "mt-[6px]" : "text-right"}`}>{children}</span>
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

  const statusColor = data.status === "active" ? "#6ccd8b" : data.status === "completed" ? "#4f71dc" : "#e57373"
  return (
    <div className="bg-white text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="relative flex h-[65px] items-center justify-between gap-3 border-b border-[#efefef] px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] truncate text-[18px] font-semibold text-[#333]">
          {t("Договоры")} {data.fullNumber}
        </h3>
        {canEdit && (
          <button type="button" disabled={busy} onClick={() => onEdit(data)} title={t("Изменить")} aria-label={t("Изменить")} className="relative z-[3] flex h-10 w-10 items-center justify-center disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          </button>
        )}
      </div>

      <div className="flex flex-col md:flex-row">
        <div className="border-b border-[#efefef] px-[30px] pb-[30px] pt-[18px] md:w-[340px] md:shrink-0 md:border-b-0 md:border-r">
          <ul>
            <InfoRow label={t("Официальное название")} column>
              {data.officialName || t("Не указано")}
            </InfoRow>
            <InfoRow label={t("Дата создания")}>{data.createdDate ? formatCategoryDate(data.createdDate.slice(0, 10), language) : t("Не указан")}</InfoRow>
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
              <span style={{ color: statusColor }}>{t(CONTRACT_STATUS_LABELS[data.status])}</span>
            </InfoRow>
          </ul>
        </div>

        <div className="min-w-0 flex-1 px-[20px] pb-5">
          <p className="mb-[26px] mt-[21px] font-semibold">{t("Транзакции")}</p>
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
            <>
              <div className="grid grid-cols-[185px_269px_269px_1fr] border-b-2 border-dotted border-[#d9e0e5] pb-[12px] pl-[5px] text-[13px]">
                <span>№</span>
                <span>{t("Дата")}</span>
                <span>{t("Создал")}</span>
                <span>{t("Сумма")}</span>
              </div>
              <div className="flex flex-col items-center pb-[30px] pt-[30px] text-[#888]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/robot-empty.png" alt="" className="w-[120px]" />
                <span className="-mt-[10px] text-[13px]">{`${t("По вашему запросу ничего не найдено")}...`}</span>
              </div>
            </>
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
