"use client"

import { useState } from "react"
import { CheckCircle2, FileSpreadsheet, Pencil, Printer, Send, Trash2, Undo2 } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, FormField, LoadingBlock, inputClass, mutationError } from "@/components/analytics/cash-management-shared"
import { TransferLogsPanel } from "@/components/analytics/internal-transfers-logs"
import { InfoRow, TransferStatusLabel, docDate, formatQty, formatSum, formatWeight, transferItemsSheet } from "@/components/analytics/internal-transfers-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { TRANSFER_EDITABLE, type Transfer, type TransferAction } from "@/lib/internal-transfers-types"

// Demo StockTransferDetail (c7 module 4638) shown in place of the clicked row:
// "Передача № N" + actions — "Подтвердить Запрос" (approved → give, given →
// accept; a dialog with "Дата"), "Скачать Excel", the printed "Накладная",
// "Изменить", "Отменить передачу" / "Отменить приемку", "Удалить" (= cancel).
// Left: Со склада, На склад, Прайс лист, Организация · Номер накладной, Номер
// транспорта, Водитель · Статус, Дата доставки / создания / приемки /
// передачи, Комментарий. Right: tabs "Товары" (module 4643) and "Логи".

type Pending = { action: TransferAction; title: string; text: string; withDate: boolean; tone: "red" | "blue" | "green"; label: string; success: string } | null

export function TransferDetailPanel({
  id,
  canEdit,
  onClose,
  onEdit,
  onPrint,
  onChanged,
  notify,
}: {
  id: number
  canEdit: boolean
  onClose: () => void
  onEdit: (transfer: Transfer) => void
  onPrint: (transfer: Transfer) => void
  onChanged: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<Transfer>(`/api/internal-transfers/${id}`)
  const [tab, setTab] = useState<"items" | "logs">("items")
  const [pending, setPending] = useState<Pending>(null)
  const [date, setDate] = useState(todayIso())
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [logsVersion, setLogsVersion] = useState(0)
  const data = detail.data

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const request = `${t("Подтвердить Запрос")} №${data.id}`
  const open = (next: Pending) => {
    setError("")
    setComment("")
    setDate(todayIso())
    setPending(next)
  }
  const run = async () => {
    if (!pending) return
    setBusy(true)
    setError("")
    const result = await cashMutate<Transfer>("POST", `/api/internal-transfers/${id}/action`, { action: pending.action, comment, ...(pending.withDate ? { date } : {}) })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    notify(t(pending.success))
    setPending(null)
    detail.reload()
    setLogsVersion((value) => value + 1)
    onChanged()
  }

  const status = data.status
  const editable = TRANSFER_EDITABLE.includes(status)
  const qtyTotal = data.items.reduce((sum, item) => sum + item.quantity, 0)
  const iconButton = "flex h-10 w-10 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:cursor-not-allowed disabled:opacity-40"
  const actionButton = "inline-flex h-[30px] items-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
  const who = (moment: string, name: string) =>
    moment ? (
      <>
        {docDate(moment, language, true)}
        {name && <span className="block text-[12px] font-normal text-[#586174]">{name}</span>}
      </>
    ) : (
      t("Не указано")
    )

  return (
    <div className="bg-white text-[14px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex min-h-[65px] flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-4 py-2 md:px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] text-[16px] font-bold">
          {t("Передача")} № {data.id}
        </h3>
        <div className="relative z-[3] flex flex-wrap items-center gap-1.5">
          {canEdit && status === "ожидает" && (
            <button type="button" title={t("Подтвердить")} aria-label={t("Подтвердить")} className={iconButton} onClick={() => open({ action: "approve", title: t("Подтвердить"), text: `${t("Передача")} №${data.id}`, withDate: false, tone: "blue", label: "Подтвердить", success: "Успешно сохранено" })}>
              <CheckCircle2 className="h-5 w-5 text-[rgb(79,113,220)]" />
            </button>
          )}
          {canEdit && (status === "потвержден" || status === "в пути") && (
            <button
              type="button"
              title={request}
              aria-label={request}
              className={iconButton}
              onClick={() =>
                open(
                  status === "потвержден"
                    ? { action: "give", title: request, text: `${t("Запрос")} № ${data.id} · ${t("Передан со склада")} ${data.fromWarehouse}`, withDate: true, tone: "blue", label: "Подтвердить", success: "Успешно передан" }
                    : { action: "accept", title: request, text: `${t("Запрос")} № ${data.id} · ${t("Принять на склад")} ${data.toWarehouse}`, withDate: true, tone: "green", label: "Подтвердить", success: "Успешно сохранено" },
                )
              }
            >
              <Send className="h-5 w-5 text-[#e57373]" />
            </button>
          )}
          <button type="button" onClick={() => downloadExcelTable(`${t("Передача")} №${data.id}`, transferItemsSheet(data, t))} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className={iconButton}>
            <FileSpreadsheet className="h-5 w-5 text-[#71ce87]" />
          </button>
          <button type="button" onClick={() => onPrint(data)} title={t("Накладная")} aria-label={t("Накладная")} className={iconButton}>
            <Printer className="h-5 w-5" />
          </button>
          {canEdit && (
            <button type="button" disabled={!editable} onClick={() => onEdit(data)} title={editable ? t("Изменить") : t("Изменять можно только передачу в статусе «ожидает» или «потвержден»")} className={`${actionButton} bg-[rgb(79,113,220)]`}>
              <Pencil className="h-4 w-4" /> {t("Изменить")}
            </button>
          )}
          {canEdit && (status === "в пути" || status === "принят") && (
            <button
              type="button"
              title={status === "в пути" ? t("Отменить передачу") : t("Отменить приемку")}
              aria-label={status === "в пути" ? t("Отменить передачу") : t("Отменить приемку")}
              className={iconButton}
              onClick={() =>
                open(
                  status === "в пути"
                    ? { action: "cancel_given", title: t("Отменить передачу"), text: `${t("Передача №")}${data.id}`, withDate: false, tone: "red", label: "Подтвердить", success: "Успешно сохранено" }
                    : { action: "cancel_accepted", title: t("Отменить приемку"), text: `${t("Приемка №")}${data.id}`, withDate: false, tone: "red", label: "Подтвердить", success: "Успешно сохранено" },
                )
              }
            >
              <Undo2 className="h-5 w-5 text-[#e57373]" />
            </button>
          )}
          {canEdit && editable && (
            <button
              type="button"
              onClick={() => open({ action: "cancel", title: t("Подтверждение удаления"), text: `${t("Вы уверены что хотите удалить эти данные?")} (${t("Передача")} №${data.id})`, withDate: false, tone: "red", label: "Удалить", success: "Успешно удалено" })}
              className={`${actionButton} bg-[#fa8072]`}
            >
              <Trash2 className="h-4 w-4" /> {t("Удалить")}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row">
        <div className="border-b border-[#efefef] px-4 py-3 md:w-[360px] md:shrink-0 md:border-b-0 md:border-r md:px-[30px]">
          <ul className="border-b border-[#efefef] pb-2">
            <InfoRow label={t("Со склада")}>{data.fromWarehouse}</InfoRow>
            <InfoRow label={t("На склад")}>{data.toWarehouse}</InfoRow>
            {data.priceList && <InfoRow label={t("Прайс лист")}>{data.priceList}</InfoRow>}
            <InfoRow label={t("Организация")}>{data.organization || t("Не указано")}</InfoRow>
          </ul>
          <ul className="border-b border-[#efefef] py-2">
            <InfoRow label={t("Номер накладной")}>{data.invoiceNumber || t("Не указано")}</InfoRow>
            <InfoRow label={t("Номер транспорта")}>{data.transportNumber || t("Не указано")}</InfoRow>
            <InfoRow label={t("Водитель")}>{data.driver || t("Не указано")}</InfoRow>
          </ul>
          <ul className="pt-2">
            <InfoRow label={t("Статус")}>
              <TransferStatusLabel status={status} title />
            </InfoRow>
            <InfoRow label={t("Дата доставки")}>{docDate(data.deliveredAt, language) || t("Не указано")}</InfoRow>
            <InfoRow label={t("Дата создания")}>{who(data.createdAt, data.createdBy)}</InfoRow>
            <InfoRow label={t("Дата приемки")}>{who(data.acceptedAt, data.acceptedBy)}</InfoRow>
            <InfoRow label={t("Дата передачи")}>{who(data.givenAt, data.givenBy)}</InfoRow>
            {status === "отменен" && <InfoRow label={t("Отменен")}>{who(data.cancelledAt, data.cancelledBy)}</InfoRow>}
            <InfoRow label={t("Комментарий")}>{data.comment || t("Комментарий отсутствует")}</InfoRow>
          </ul>
        </div>

        <div className="min-w-0 flex-1 px-4 pb-5 md:px-[30px]">
          <div className="flex border-b border-[#efefef]">
            {(["items", "logs"] as const).map((key) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`h-11 px-5 text-[13px] font-semibold uppercase ${tab === key ? "border-b-2 border-[rgb(79,113,220)] text-[rgb(79,113,220)]" : "text-[#586174]"}`}>
                {key === "items" ? t("Товары") : t("Логи")}
              </button>
            ))}
          </div>
          {tab === "logs" ? (
            <TransferLogsPanel key={logsVersion} id={data.id} />
          ) : data.items.length ? (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-dashed border-[#e1e5eb] text-left font-semibold">
                    <th className="py-3 pr-3">{t("Товар")}</th>
                    <th className="py-3 pr-3 text-right">{t("Количество")}</th>
                    <th className="py-3 pr-3 text-right">{t("Вес")}</th>
                    <th className="py-3 pr-3">{t("Серия")}</th>
                    <th className="py-3 pr-3 text-right">{t("Цена")}</th>
                    <th className="py-3 text-right">{t("Cумма")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-dashed border-[#e1e5eb] hover:bg-[#f2f5f8]">
                      <td className="py-3 pr-3">
                        {item.product}
                        {item.article && <span className="block text-[12px] text-[#9aa3b6]">{item.article}</span>}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{formatQty(item.quantity, item.unit)}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{formatWeight(item.quantity * item.weight, t("кг"))}</td>
                      <td className="py-3 pr-3">{item.series || "-"}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{formatSum(item.price)}</td>
                      <td className="whitespace-nowrap py-3 text-right">{formatSum(item.quantity * item.price, data.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="pt-3 pr-3">{t("Итого")}</td>
                    <td className="whitespace-nowrap pt-3 pr-3 text-right">{formatQty(qtyTotal)}</td>
                    <td className="whitespace-nowrap pt-3 pr-3 text-right">{formatWeight(data.weight, t("кг"))}</td>
                    <td colSpan={2} />
                    <td className="whitespace-nowrap pt-3 text-right">{formatSum(data.amount, data.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyBlock text="Товаров не найдено" className="py-10" />
          )}
        </div>
      </div>

      {pending && (
        <ConfirmDialog title={pending.title} text={pending.text} confirmLabel={pending.label} tone={pending.tone} busy={busy} error={error} onConfirm={() => void run()} onClose={() => setPending(null)}>
          <div className="mt-3 flex flex-col gap-3">
            {pending.withDate && (
              <FormField label={t("Дата")}>
                <input type="date" value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} className={inputClass} />
              </FormField>
            )}
            {pending.action !== "cancel" && (
              <FormField label={`${t("Комментарий")}...`}>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} maxLength={2000} className={`${inputClass} h-auto py-2`} />
              </FormField>
            )}
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}
