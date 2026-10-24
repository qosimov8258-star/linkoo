"use client"

import { useState } from "react"
import { Pencil, Trash2, Undo2 } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, FormField, LoadingBlock, inputClass, mutationError } from "@/components/analytics/cash-management-shared"
import { TransferLogsPanel } from "@/components/analytics/internal-transfers-logs"
import { TransferStatusLabel, docDate, formatQty, formatSum, formatWeight, transferItemsSheet } from "@/components/analytics/internal-transfers-shared"
import { RefTip } from "@/components/ref/ref-tip"
import { formatMoney } from "@/lib/finance/currency"
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

// Material glyphs of the reference's transfer card (timer = "Авто распределение по сериям", sync = "Отменить автораспределение").
const ICON_TIMER = "M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"
const ICON_CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const ICON_SYNC = "M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"
const ICON_DOWNLOAD = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
const ICON_PRINT = "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"

/** Product table of the card: 424 / 331 / 193 / 220 / 245 px at 1500 wide (reference). */
const ITEM_COLS = "424fr 331fr 193fr 220fr 245fr"

type SortKey = "product" | "quantity" | "weight" | "price" | "sum"
type SortState = { key: SortKey; desc: boolean } | null

function sortItems(items: Transfer["items"], sort: SortState) {
  if (!sort) return items
  const value = (item: Transfer["items"][number]) =>
    sort.key === "product" ? item.product.toLowerCase() : sort.key === "quantity" ? item.quantity : sort.key === "weight" ? item.quantity * item.weight : sort.key === "price" ? item.price : item.quantity * item.price
  return [...items].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    return (sort.desc ? -1 : 1) * (x < y ? -1 : x > y ? 1 : 0)
  })
}

/** One label/value line of the card (25px, label 400 / value 600 right aligned). */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex h-[25px] items-center justify-between gap-3">
      <span>{label}:</span>
      <span className="text-right font-semibold">{children}</span>
    </li>
  )
}

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
  const [sort, setSort] = useState<SortState>(null)
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
  const iconButton = "flex h-12 w-12 items-center justify-center hover:bg-[#f2f5f8] disabled:cursor-not-allowed disabled:opacity-40"
  const tipSlot = "mx-[7.5px]"
  const actionButton = "inline-flex h-[30px] items-center justify-center gap-[6px] rounded-[2px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
  const day = (moment: string) => docDate(moment, language) || t("Не указано")
  const currency = data.currency || "SUM"
  const sorted = sortItems(data.items, sort)
  const toggleSort = (key: SortKey) => setSort((current) => (current?.key === key ? (current.desc ? null : { key, desc: true }) : { key, desc: false }))

  return (
    <div className="-mx-[31px] my-[13px] bg-white text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex h-[67px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[23px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] text-[18px] font-semibold">
          {t("Передача")} № {data.id}
        </h3>
        <div className="relative z-[3] flex items-center">
          {canEdit && (status === "ожидает" || status === "потвержден" || status === "в пути") && (
            <>
              <RefTip text={t("Авто распределение по сериям")} side="bottom" gap={9} bold className={tipSlot}>
                <button type="button" aria-label={t("Авто распределение по сериям")} className={iconButton} onClick={() => notify(t("Нет товаров с сериями"))}>
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={ICON_TIMER} /></svg>
                </button>
              </RefTip>
              <RefTip
                text={status === "ожидает" ? t("Подтвердить") : request}
                side="right"
                gap={10}
                bold
                className={tipSlot}
              >
                <button
                  type="button"
                  aria-label={status === "ожидает" ? t("Подтвердить") : request}
                  className={iconButton}
                  onClick={() =>
                    open(
                      status === "ожидает"
                        ? { action: "approve", title: t("Подтвердить"), text: `${t("Передача")} №${data.id}`, withDate: false, tone: "blue", label: "Подтвердить", success: "Успешно сохранено" }
                        : status === "потвержден"
                          ? { action: "give", title: request, text: `${t("Запрос")} № ${data.id} · ${t("Передан со склада")} ${data.fromWarehouse}`, withDate: true, tone: "blue", label: "Подтвердить", success: "Успешно передан" }
                          : { action: "accept", title: request, text: `${t("Запрос")} № ${data.id} · ${t("Принять на склад")} ${data.toWarehouse}`, withDate: true, tone: "green", label: "Подтвердить", success: "Успешно сохранено" },
                    )
                  }
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]" aria-hidden><path d={ICON_CHECK_CIRCLE} /></svg>
                </button>
              </RefTip>
              <RefTip text={t("Отменить автораспределение")} side="right" gap={10} bold className={tipSlot}>
                <button type="button" aria-label={t("Отменить автораспределение")} className={iconButton} onClick={() => notify(t("Нет товаров с сериями"))}>
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={ICON_SYNC} /></svg>
                </button>
              </RefTip>
            </>
          )}
          <RefTip text={t("Скачать Excel")} side="left" gap={12} bold className={tipSlot}>
            <button type="button" onClick={() => downloadExcelTable(`${t("Передача")} №${data.id}`, transferItemsSheet(data, t))} aria-label={t("Скачать Excel")} className={iconButton}>
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={ICON_DOWNLOAD} /></svg>
            </button>
          </RefTip>
          <RefTip text={t("Распечатать")} side="left" gap={12} bold className={tipSlot}>
            <button type="button" onClick={() => onPrint(data)} aria-label={t("Распечатать")} className={iconButton}>
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={ICON_PRINT} /></svg>
            </button>
          </RefTip>
          {canEdit && (status === "в пути" || status === "принят") && (
            <button
              type="button"
              title={status === "в пути" ? t("Отменить передачу") : t("Отменить приемку")}
              aria-label={status === "в пути" ? t("Отменить передачу") : t("Отменить приемку")}
              className={`${iconButton} mx-[7.5px]`}
              onClick={() =>
                open(
                  status === "в пути"
                    ? { action: "cancel_given", title: t("Отменить передачу"), text: `${t("Передача №")}${data.id}`, withDate: false, tone: "red", label: "Подтвердить", success: "Успешно сохранено" }
                    : { action: "cancel_accepted", title: t("Отменить приемку"), text: `${t("Приемка №")}${data.id}`, withDate: false, tone: "red", label: "Подтвердить", success: "Успешно сохранено" },
                )
              }
            >
              <Undo2 className="h-6 w-6 text-[#e57373]" />
            </button>
          )}
          {canEdit && (
            <button type="button" disabled={!editable} onClick={() => onEdit(data)} title={editable ? undefined : t("Изменять можно только передачу в статусе «ожидает» или «потвержден»")} className={`${actionButton} ml-[7px] w-[121px] bg-[rgb(79,113,220)]`}>
              <Pencil className="h-[18px] w-[18px]" /> {t("Изменить")}
            </button>
          )}
          {canEdit && editable && (
            <button
              type="button"
              onClick={() => open({ action: "cancel", title: t("Подтверждение удаления"), text: t("Вы уверены что хотите удалить эти данные?"), withDate: false, tone: "red", label: "Удалить", success: "Успешно удалено" })}
              className={`${actionButton} ml-[23px] w-[109px] bg-[#fa8072]`}
            >
              <Trash2 className="h-[18px] w-[18px]" /> {t("Удалить")}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-[#efefef] px-[15px]">
        <ul className="min-h-[185px] border-r border-[#efefef] px-[15px] pb-[10px] pt-[15px]">
          <Row label={t("Со склада")}>{data.fromWarehouse}</Row>
          <Row label={t("На склад")}>{data.toWarehouse}</Row>
          <Row label={t("Прайс лист")}>{data.priceList || t("Не указано")}</Row>
          <Row label={t("Организация")}>{data.organization || t("Не указано")}</Row>
        </ul>
        <ul className="min-h-[185px] border-r border-[#efefef] px-[15px] pb-[10px] pt-[15px]">
          <Row label={t("Номер накладной")}>{data.invoiceNumber || t("Не указано")}</Row>
          <Row label={t("Номер транспорта")}>{data.transportNumber || t("Не указано")}</Row>
          <Row label={t("Водитель")}>{data.driver || t("Не указано")}</Row>
        </ul>
        <ul className="min-h-[185px] px-[16px] pb-[10px] pt-[15px]">
          <Row label={t("Статус")}>
            <TransferStatusLabel status={status} title />
          </Row>
          <Row label={t("Дата доставки")}>{day(data.deliveredAt)}</Row>
          <Row label={t("Дата создания")}>{day(data.createdAt)}</Row>
          <Row label={t("Дата приемки")}>{day(data.acceptedAt)}</Row>
          <Row label={t("Дата передачи")}>{day(data.givenAt)}</Row>
          {status === "отменен" && <Row label={t("Отменен")}>{day(data.cancelledAt)}</Row>}
          <Row label={t("Комментарий")}>{data.comment || t("Комментарий отсутствует")}</Row>
        </ul>
      </div>

      <div className="px-[31px] pb-[20px]">
        <div className="relative flex h-12 border-b border-[#efefef]">
          {(["items", "logs"] as const).map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)} className="relative h-12 w-[300px] text-[13px] font-medium text-black">
              {key === "items" ? t("Товары") : t("Логи")}
              {tab === key && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[rgb(79,113,220)]" />}
            </button>
          ))}
        </div>
        {tab === "logs" ? (
          <TransferLogsPanel key={logsVersion} id={data.id} />
        ) : data.items.length ? (
          <div className="mt-[2px]">
            <div className="grid h-[34px] items-center bg-[#f1f5f8] text-[13px] font-semibold text-[#374557]" style={{ gridTemplateColumns: ITEM_COLS }}>
              {([["product", t("Товар")], ["quantity", t("Количество")], ["weight", t("Вес")], ["price", t("Цена")], ["sum", t("Cумма")]] as Array<[SortKey, string]>).map(([key, label], index) => (
                <button key={key} type="button" onClick={() => toggleSort(key)} className="flex h-full items-center gap-[4px] text-left" style={{ paddingLeft: index === 0 ? 19 : 18 }}>
                  {label}
                  <svg viewBox="0 0 24 24" className={`h-4 w-4 ${sort?.key === key ? "fill-[#4f71dc]" : "fill-[#9aa3b6]"}`} aria-hidden>
                    <path d={sort?.key === key && sort.desc ? "M7 10l5 5 5-5z" : sort?.key === key ? "M7 14l5-5 5 5z" : "M7 10l5-5 5 5H7zm0 4l5 5 5-5H7z"} />
                  </svg>
                </button>
              ))}
            </div>
            {sorted.map((item) => (
              <div key={item.id} className="grid h-9 items-center border-b border-[#efefef] hover:bg-[#f2f5f8]" style={{ gridTemplateColumns: ITEM_COLS }}>
                <span className="truncate pl-[19px]">{item.product}</span>
                <span className="pl-[18px]">{formatQty(item.quantity, item.unit)}</span>
                <span className="pl-[18px]">{formatMoney(item.quantity * item.weight, 3)}</span>
                <span className="pl-[18px]">{formatSum(item.price, currency)}</span>
                <span className="pl-[18px]">{formatSum(item.quantity * item.price, currency)}</span>
              </div>
            ))}
            <div className="grid h-[39px] items-center border-b border-[#efefef] text-[15px] font-semibold" style={{ gridTemplateColumns: ITEM_COLS }}>
              <span className="pl-[19px]">{t("Итого")}</span>
              <span className="pl-[18px]">{formatQty(qtyTotal)}</span>
              <span className="pl-[18px]">{formatWeight(data.items.reduce((sum, item) => sum + item.quantity * item.weight, 0), t("кг"))}</span>
              <span />
              <span className="pl-[18px]">{formatSum(data.items.reduce((sum, item) => sum + item.quantity * item.price, 0), currency)}</span>
            </div>
          </div>
        ) : (
          <EmptyBlock text="Товаров не найдено" className="py-10" />
        )}
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
