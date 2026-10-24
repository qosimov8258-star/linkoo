"use client"

import { useState, type ReactNode } from "react"
import { CheckCircle2, FileSpreadsheet, Info, Pencil, Trash2, XCircle } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, LoadingBlock, formatCashDate, inputClass, mutationError } from "@/components/analytics/cash-management-shared"
import { StatusLabel, diffColor, formatDiff, formatQty, formatSum, inventoryDateText, inventoryItemsSheet } from "@/components/analytics/stock-inventory-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { STOCK_INVENTORY_TYPE_LABELS, type StockInventoryDetail } from "@/lib/stock-inventories-types"

// Demo InventoryDetail (module 4750), shown in place of the clicked row: the
// creator as the title; "Изменить" (pending only), Excel of the lines,
// "Подтвердить" (pending; dialog "Подтверждения инвентаризации" with a comment)
// or "Отменить" (confirmed), "Удалить" (pending). Left: Тип, Склад, Статус,
// Дата создания, Время, Комментарий. Right: Наименование | Серия | Баланс (до) |
// Баланс (после) | Разница | Сумма + "Итого". While pending the balances are the
// live system ones; once confirmed they are the values frozen at confirmation.

type Pending = "confirm" | "cancel" | "delete" | null

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap justify-between gap-x-3 border-b border-dashed border-[#e1e5eb] py-1.5 leading-[22px] last:border-none">
      <span className="text-[#586174]">{label}:</span>
      <span className="text-right font-semibold text-[#17233b]">{children}</span>
    </li>
  )
}

export function InventoryDetailPanel({
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
  onEdit: (detail: StockInventoryDetail) => void
  onChanged: () => void
  onDeleted: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<StockInventoryDetail>(`/api/stock/inventories/${id}`)
  const [pending, setPending] = useState<Pending>(null)
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = detail.data

  const open = (kind: Pending) => {
    setError("")
    setComment("")
    setPending(kind)
  }

  const run = async () => {
    if (!pending) return
    setBusy(true)
    setError("")
    const result =
      pending === "confirm"
        ? await cashMutate("POST", `/api/stock/inventories/${id}/confirm`, { comment })
        : pending === "cancel"
          ? await cashMutate("POST", `/api/stock/inventories/${id}/cancel`)
          : await cashMutate("DELETE", `/api/stock/inventories/${id}`)
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    const kind = pending
    setPending(null)
    if (kind === "delete") {
      notify(t("Успешно удалено"))
      onDeleted()
      return
    }
    notify(t("Успешно сохранено"))
    detail.reload()
    onChanged()
  }

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const currency = currencyLabel(data.currency)
  const iconButton = "flex h-10 w-10 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:cursor-not-allowed disabled:opacity-40"
  const actionButton = "inline-flex h-[30px] items-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
  return (
    <div className="bg-white text-[14px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex min-h-[65px] flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-4 py-2 md:px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] truncate text-[16px] font-bold text-[#333]">{data.createdBy || `№ ${data.id}`}</h3>
        <div className="relative z-[3] flex items-center gap-2.5">
          {canEdit && (
            <button type="button" disabled={data.status !== "pending"} onClick={() => onEdit(data)} title={t("Изменить")} aria-label={t("Изменить")} className={iconButton}>
              <Pencil className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => downloadExcelTable(`${t("Инвентаризация")} №${data.id}`, inventoryItemsSheet(data, t))}
            disabled={!data.items.length}
            title={t("Скачать Excel")}
            aria-label={t("Скачать Excel")}
            className={iconButton}
          >
            <FileSpreadsheet className="h-5 w-5 text-[#71ce87]" />
          </button>
          {canEdit && data.status === "pending" && (
            <button type="button" onClick={() => open("confirm")} className={`${actionButton} bg-[rgb(79,113,220)]`}>
              <CheckCircle2 className="h-4 w-4" /> {t("Подтвердить")}
            </button>
          )}
          {canEdit && data.status === "confirmed" && (
            <button type="button" onClick={() => open("cancel")} className={`${actionButton} bg-[#fa8072]`}>
              <XCircle className="h-4 w-4" /> {t("Отменить")}
            </button>
          )}
          {canEdit && data.status === "pending" && (
            <button type="button" onClick={() => open("delete")} title={t("Удалить")} aria-label={t("Удалить")} className={iconButton}>
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row">
        <div className="border-b border-[#efefef] px-4 py-4 md:w-[350px] md:shrink-0 md:border-b-0 md:border-r md:px-[30px]">
          <ul>
            <InfoRow label={t("Тип")}>{t(STOCK_INVENTORY_TYPE_LABELS[data.type])}</InfoRow>
            <InfoRow label={t("Склад")}>{data.warehouse}</InfoRow>
            <InfoRow label={t("Статус")}>
              <StatusLabel status={data.status} />
            </InfoRow>
            <InfoRow label={t("Дата создания")}>{inventoryDateText(data, language)}</InfoRow>
            <InfoRow label={t("Время")}>{data.forDayEnd ? t("На конец дня") : t("На начало дня")}</InfoRow>
            <InfoRow label={t("Комментарий")}>{data.comment || t("Комментариев нет")}</InfoRow>
            {data.confirmedAt && (
              <InfoRow label={t("Подтвердил")}>
                {data.confirmedBy || "—"}
                <span className="block text-[12px] font-normal text-[#586174]">{formatCashDate(data.confirmedAt, language)}</span>
              </InfoRow>
            )}
            {data.canceledAt && (
              <InfoRow label={t("Отменил")}>
                {data.canceledBy || "—"}
                <span className="block text-[12px] font-normal text-[#586174]">{formatCashDate(data.canceledAt, language)}</span>
              </InfoRow>
            )}
          </ul>
        </div>

        <div className="min-w-0 flex-1 px-4 pb-5 md:px-[30px]">
          {data.status === "pending" && (
            <p className={`mt-4 flex items-start gap-2 text-[13px] ${data.liveError ? "text-[#e57373]" : "text-[#586174]"}`}>
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              {data.liveError ? t(data.liveError) : t("Баланс (до) — текущий остаток склада на момент инвентаризации; он будет зафиксирован при подтверждении")}
            </p>
          )}
          {data.items.length ? (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-dashed border-[#e1e5eb] text-left font-semibold">
                    <th className="py-3 pr-3">{t("Наименование")}</th>
                    <th className="py-3 pr-3">{t("Серия")}</th>
                    <th className="py-3 pr-3 text-right">{t("Баланс (до)")}</th>
                    <th className="py-3 pr-3 text-right">{t("Баланс (после)")}</th>
                    <th className="py-3 pr-3 text-right">{t("Разница")}</th>
                    <th className="py-3 text-right">
                      {t("Сумма")} {currency}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-dashed border-[#e1e5eb] hover:bg-[#f2f5f8]">
                      <td className="py-3 pr-3">
                        {item.name}
                        {item.article && <span className="block text-[12px] text-[#9aa3b6]">{item.article}</span>}
                      </td>
                      <td className="py-3 pr-3">{item.series || "-"}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{formatQty(item.balanceAmount, item.unit)}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{formatQty(item.amount, item.unit)}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right font-semibold" style={{ color: diffColor(item.diff) }}>
                        {formatDiff(item.diff, item.unit)}
                      </td>
                      <td className="whitespace-nowrap py-3 text-right" title={`${t("Себестоимость")}: ${formatSum(item.cost, data.currency)}`}>
                        {formatSum(item.totalPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="pt-3 pr-3" colSpan={5}>
                      {t("Итого")}:
                    </td>
                    <td className="whitespace-nowrap pt-3 text-right" style={{ color: diffColor(data.totalPrice) }}>
                      {formatSum(data.totalPrice)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyBlock text="Товаров не найдено" className="py-10" />
          )}
        </div>
      </div>

      {pending === "confirm" && (
        <ConfirmDialog title={t("Подтверждения инвентаризации")} confirmLabel="Подтвердить" tone="blue" busy={busy} error={error} onConfirm={() => void run()} onClose={() => setPending(null)}>
          <label className="flex flex-col gap-1 text-[13px] text-[#586174]">
            {t("Комментарий")}...
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={2000} className={`${inputClass} h-auto py-2`} />
          </label>
        </ConfirmDialog>
      )}
      {pending === "cancel" && (
        <ConfirmDialog
          title={t("Подтверждение отмены")}
          kind="cancel"
          confirmLabel="Да"
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onClose={() => setPending(null)}
        />
      )}
      {pending === "delete" && (
        <ConfirmDialog
          title={t("Подтверждение удаления")}
          text={`${t("Вы уверены что хотите удалить эти данные?")} (${t("Инвентаризация")} №${data.id})`}
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
