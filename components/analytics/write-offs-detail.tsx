"use client"

import { useState } from "react"
import { CheckCircle2, FileSpreadsheet, Undo2, XCircle } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, LoadingBlock, mutationError } from "@/components/analytics/cash-management-shared"
import { InfoRow, docDate, formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { WRITE_OFF_STATUS_COLORS, type WriteOff, type WriteOffAction, type WriteOffStatus } from "@/lib/write-offs-types"

// Demo WriteOffDetail (c142 module 5200), shown in place of the clicked row:
// "Списание № N" + "Отменить списание" (finished; fails with "Отменение
// невозможно из-за связи с другими данными" when a later inventory counted
// it), for a pending one "Списать" / "Отменить"; Excel of the lines. Left:
// Создал, Склад, Дата создания, Статус, Комментарий. Right: Товар | Код товара
// | Серия | Блок | Кол-во | Себестоимость | Сумма + "Итого".

export function WriteOffStatusLabel({ status }: { status: WriteOffStatus }) {
  const { t } = useLanguage()
  return (
    <span className="whitespace-nowrap font-semibold" style={{ color: WRITE_OFF_STATUS_COLORS[status] }}>
      {t(status)}
    </span>
  )
}

type Cell = string | number

export function writeOffItemsSheet(writeOff: WriteOff, t: (text: string) => string): Cell[][] {
  return [
    [`${t("Списание")} № ${writeOff.id}`, writeOff.warehouse],
    [],
    [t("Товар"), t("Код товара"), t("Серия"), t("Блок"), t("Кол-во"), t("Ед. изм."), t("Себестоимость"), t("Сумма")],
    ...writeOff.items.map((item) => [item.product, item.code || "-", item.series || "-", item.block, item.qty, item.unit, item.cost, Math.round(item.sum * 100) / 100]),
    [t("Итого"), "", "", "", writeOff.items.reduce((sum, item) => sum + item.qty, 0), "", "", Math.round(writeOff.total * 100) / 100],
  ]
}

export function WriteOffDetailPanel({ id, canEdit, onClose, onChanged, notify }: { id: number; canEdit: boolean; onClose: () => void; onChanged: () => void; notify: (text: string, error?: boolean) => void }) {
  const { t, language } = useLanguage()
  const detail = useCashJson<WriteOff>(`/api/write-offs/${id}`)
  const [pending, setPending] = useState<WriteOffAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = detail.data

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const run = async () => {
    if (!pending) return
    setBusy(true)
    setError("")
    const result = await cashMutate<WriteOff>("POST", `/api/write-offs/${id}/action`, { action: pending })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    notify(t(pending === "cancel" ? "Успешно отменено" : "Успешно сохранено"))
    setPending(null)
    detail.reload()
    onChanged()
  }

  const iconButton = "flex h-10 w-10 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:opacity-40"
  const qty = data.items.reduce((sum, item) => sum + item.qty, 0)
  return (
    <div className="bg-white text-[14px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex min-h-[65px] flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-4 py-2 md:px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] text-[16px] font-bold">
          {t("Списание")} № {data.id}
        </h3>
        <div className="relative z-[3] flex items-center gap-1.5">
          {canEdit && data.status === "ожидает" && (
            <>
              <button type="button" onClick={() => setPending("finish")} title={t("Списать")} aria-label={t("Списать")} className={iconButton}>
                <CheckCircle2 className="h-5 w-5 text-[#81c784]" />
              </button>
              <button type="button" onClick={() => setPending("cancel")} title={t("Отменить")} aria-label={t("Отменить")} className={iconButton}>
                <XCircle className="h-5 w-5 text-[#e57373]" />
              </button>
            </>
          )}
          {canEdit && data.status === "закрыт" && (
            <button type="button" onClick={() => setPending("cancel")} title={t("Отменить списание")} aria-label={t("Отменить списание")} className={iconButton}>
              <Undo2 className="h-5 w-5 text-[#e57373]" />
            </button>
          )}
          <button type="button" onClick={() => downloadExcelTable(`${t("Списание")} №${data.id}`, writeOffItemsSheet(data, t))} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className={iconButton}>
            <FileSpreadsheet className="h-5 w-5 text-[#71ce87]" />
          </button>
        </div>
      </div>
      <div className="flex flex-col md:flex-row">
        <div className="border-b border-[#efefef] px-4 py-3 md:w-[340px] md:shrink-0 md:border-b-0 md:border-r md:px-[30px]">
          <ul>
            <InfoRow label={t("Создал")}>{data.creator || t("Не указано")}</InfoRow>
            <InfoRow label={t("Склад")}>{data.warehouse}</InfoRow>
            <InfoRow label={t("Дата создания")}>{docDate(data.date, language, true)}</InfoRow>
            <InfoRow label={t("Статус")}>
              <WriteOffStatusLabel status={data.status} />
            </InfoRow>
            {data.status === "отменен" && data.cancelledAt && (
              <InfoRow label={t("Отменил")}>
                {data.cancelledBy || "—"}
                <span className="block text-[12px] font-normal text-[#586174]">{docDate(data.cancelledAt, language, true)}</span>
              </InfoRow>
            )}
          </ul>
          <div className="mt-3">
            <div className="mb-1 font-semibold uppercase">{t("Комментарий")}:</div>
            <div className="text-[#586174]">{data.comment || t("Комментарий отсутствует")}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 px-4 pb-5 md:px-[30px]">
          {data.items.length ? (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[680px] border-collapse">
                <thead>
                  <tr className="border-b border-dashed border-[#e1e5eb] text-left font-semibold">
                    <th className="py-3 pr-3">{t("Товар")}</th>
                    <th className="py-3 pr-3">{t("Код товара")}</th>
                    <th className="py-3 pr-3">{t("Серия")}</th>
                    <th className="py-3 pr-3 text-right">{t("Блок")}</th>
                    <th className="py-3 pr-3 text-right">{t("Кол-во")}</th>
                    <th className="py-3 pr-3 text-right">{t("Себестоимость")}</th>
                    <th className="py-3 text-right">{t("Сумма")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-dashed border-[#e1e5eb] hover:bg-[#f2f5f8]">
                      <td className="py-3 pr-3">{item.product}</td>
                      <td className="py-3 pr-3">{item.code || "-"}</td>
                      <td className="py-3 pr-3">{item.series || "-"}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{item.block ? formatQty(item.block) : "-"}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{formatQty(item.qty, item.unit)}</td>
                      <td className="whitespace-nowrap py-3 pr-3 text-right">{formatSum(item.cost)}</td>
                      <td className="whitespace-nowrap py-3 text-right">{formatSum(item.sum)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="pt-3 pr-3" colSpan={4}>
                      {t("Итого")}
                    </td>
                    <td className="whitespace-nowrap pt-3 pr-3 text-right">{formatQty(qty)}</td>
                    <td />
                    <td className="whitespace-nowrap pt-3 text-right">{formatSum(data.total)}</td>
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
        <ConfirmDialog
          title={pending === "finish" ? t("Списать") : t("Отменить списание")}
          text={`${t("Списание")} №${data.id}`}
          confirmLabel={pending === "finish" ? "Списать" : "Подтвердить"}
          tone={pending === "finish" ? "blue" : "red"}
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
