"use client"

import { useState } from "react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, LoadingBlock, mutationError } from "@/components/analytics/cash-management-shared"
import { docDate, formatQty } from "@/components/analytics/internal-transfers-shared"
import { RI } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatMoney } from "@/lib/finance/currency"
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
    [`${t("Списание №")} ${writeOff.id}`, writeOff.warehouse],
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

  const iconButton = "flex h-6 w-6 items-center justify-center text-[#555] hover:opacity-70 disabled:opacity-40"
  const money = (value: number) => formatMoney(value)
  const row = "flex h-[25px] items-center justify-between"
  // Reference layout (measured on #/write-off/69): 66 px title row, 370 px info column, 13 px text, columns 3:1:2:1:1:2:2.
  const cols = "grid grid-cols-[3fr_1fr_2fr_1fr_1fr_2fr_2fr]"
  return (
    <div className="bg-white text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex h-[66px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[27px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] text-[18px] font-semibold">
          {t("Списание №")} {data.id}
        </h3>
        <div className="relative z-[3] flex items-center gap-[24px]">
          {canEdit && data.status === "ожидает" && (
            <button type="button" onClick={() => setPending("finish")} title={t("Списать")} aria-label={t("Списать")} className={iconButton}>
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#81c784]" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
            </button>
          )}
          {canEdit && (data.status === "ожидает" || data.status === "закрыт") && (
            <button type="button" onClick={() => setPending("cancel")} title={data.status === "закрыт" ? t("Отменить списание") : t("Отменить")} aria-label={data.status === "закрыт" ? t("Отменить списание") : t("Отменить")} className={iconButton}>
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" /></svg>
            </button>
          )}
          <button type="button" onClick={() => downloadExcelTable(`${t("Списание №")} ${data.id}`, writeOffItemsSheet(data, t))} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className={iconButton}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d={RI.download} /></svg>
          </button>
          <button type="button" onClick={() => window.print()} title={t("Печать")} aria-label={t("Печать")} className={iconButton}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" /></svg>
          </button>
        </div>
      </div>
      <div className="flex">
        <div className="w-[370px] shrink-0 border-r border-[#efefef] pb-[27px]">
          <ul className="border-b border-[#efefef] px-[30px] pb-[17.8px] pt-[12.2px]">
            <li className={row}>{t("Создал")}<b className="font-semibold">{data.creator || t("Не указано")}</b></li>
            <li className={row}>{t("Склад")}<b className="font-semibold">{data.warehouse}</b></li>
            <li className={row}>{t("Дата создания")}<b className="font-semibold">{docDate(data.date, language)}</b></li>
            <li className={row}>{t("Статус")}<span className="relative top-[3px]"><WriteOffStatusLabel status={data.status} /></span></li>
            {data.status === "отменен" && data.cancelledAt && (
              <li className={row}>{t("Отменил")}<b className="font-semibold">{data.cancelledBy || "—"}</b></li>
            )}
          </ul>
          <div className="px-[30px] pt-[20px]">
            <div className="font-semibold">{t("Комментарий")}:</div>
            <div className="mt-[2px]">{data.comment || t("Комментарий отсутствует")}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 pl-[5.5px] pr-[6px]">
          {data.items.length ? (
            <div className="max-h-[560px] overflow-auto">
              <div className={`${cols} border-b border-dashed border-[#dcdcdc] pb-[12px] pt-[20px] font-semibold`}>
                <span>{t("Товар")}</span><span>{t("Код товара")}</span><span>{t("Серия")}</span><span>{t("Блок")}</span><span>{t("Кол-во")}</span><span>{t("Себестоимость")}</span><span>{t("Сумма")}</span>
              </div>
              {data.items.map((item) => (
                <div key={item.id} className={`${cols} border-b border-dashed border-[#dcdcdc] py-[14px] hover:bg-[#f2f5f8]`}>
                  <span className="pr-2">{item.product}</span>
                  <span>{item.code || "-"}</span>
                  <span>{item.series || "-"}</span>
                  <span>{item.block ? formatQty(item.block) : "0"}</span>
                  <span>{formatQty(item.qty, item.unit)}</span>
                  <span>{money(item.cost)}</span>
                  <span>{money(item.sum)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock text="Товаров не найдено" className="py-10" />
          )}
        </div>
      </div>
      {pending && (
        <ConfirmDialog
          title={pending === "finish" ? t("Списать") : t("Отменить списание")}
          text={`${t("Списание №")} ${data.id}`}
          confirmLabel={pending === "finish" ? "Списать" : "Да"}
          tone={pending === "finish" ? "blue" : "red"}
          kind={pending === "cancel" ? "cancel" : undefined}
          item={`${t("Списание №")} ${data.id}`}
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
