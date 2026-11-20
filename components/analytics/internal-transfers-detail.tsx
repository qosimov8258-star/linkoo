"use client"

import { useState } from "react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, EmptyBlock, ErrorBlock, LoadingBlock, mutationError } from "@/components/analytics/cash-management-shared"
import { TransferLogsPanel } from "@/components/analytics/internal-transfers-logs"
import { ICON_AV_TIMER, ICON_CACHED, Spinner } from "@/components/analytics/internal-transfers-series"
import { docDate, formatQty, formatSum, formatUnitTotals, formatWeight, transferItemsSheet } from "@/components/analytics/internal-transfers-shared"
import { AcceptReturnDialog } from "@/components/orders/return-card-dialogs"
import { RefTip } from "@/components/ref/ref-tip"
import { formatMoney } from "@/lib/finance/currency"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { TRANSFER_CARD_STATUS_COLORS, TRANSFER_STATUS_TITLES, type Transfer, type TransferAction, type TransferItem } from "@/lib/internal-transfers-types"

// Demo StockTransferDetail (c7 module 4648) shown in place of the clicked row:
// "Передача № N" + actions — «Авто распределение по сериям» (FIFO / LIFO dialog,
// ?autoSetDialog), "Подтвердить Запрос" (approved → give, given → accept; a dialog
// with "Дата"), «Отменить автораспределение», "Скачать Excel", the printed
// "Накладная", "Изменить" (any status, ?openUpdateDialog), "Отменить передачу" /
// "Отменить приемку", "Удалить" (= cancel). Left: Со склада, На склад, Прайс лист
// (when set), Организация · Номер накладной, Номер транспорта, Водитель · Статус,
// Дата доставки / создания / приемки / передачи, Комментарий. Right: tabs "Товары"
// (module 4653: Серия when a product keeps an expiry, Цена / Сумма with a price
// list, the box count under the quantity) and "Логи".

// Material glyphs of the reference's transfer card.
const ICON_CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const ICON_EDIT = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const ICON_DELETE = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
const ICON_DOWNLOAD = "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
const ICON_REMOVE_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"
const ICON_PRINT = "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"

const cellBase = "border-b border-r border-[#efefef] p-0"
const cell = "border-b border-r border-[#efefef] py-[8px]"

type SortKey = "product" | "quantity" | "weight" | "series" | "price" | "sum"
type SortState = { key: SortKey; desc: boolean } | null

function sortItems(items: Transfer["items"], sort: SortState) {
  if (!sort) return items
  const value = (item: Transfer["items"][number]) =>
    sort.key === "product"
      ? item.product.toLowerCase()
      : sort.key === "quantity"
        ? item.quantity
        : sort.key === "weight"
          ? item.quantity * item.weight
          : sort.key === "series"
            ? item.series
            : sort.key === "price"
              ? item.price
              : item.quantity * item.price
  return [...items].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    return (sort.desc ? -1 : 1) * (x < y ? -1 : x > y ? 1 : 0)
  })
}

/** The box line under a quantity, as the reference prints it: whole boxes, then the remainder in the unit
 * («83 тонна (+2 кг)»); null for a product without a box. */
function boxLine(item: TransferItem): { boxes: string; rest: number } | null {
  const size = Number(item.boxAmount) || 0
  if (!(size > 0)) return null
  const whole = Math.floor(item.quantity / size + 1e-9)
  const rest = Math.round((item.quantity - whole * size) * 1e6) / 1e6
  return { boxes: formatQty(whole, item.boxUnit ?? ""), rest: Math.abs(rest) > 1e-9 ? rest : 0 }
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
  onAutoSet,
  onPrint,
  onChanged,
  notify,
}: {
  id: number
  canEdit: boolean
  onClose: () => void
  /** «Изменить» (any status, as the reference). */
  onEdit: (transfer: Transfer) => void
  /** «Авто распределение по сериям»: opens its dialog. */
  onAutoSet: () => void
  onPrint: (transfer: Transfer) => void
  onChanged: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<Transfer>(`/api/internal-transfers/${id}`)
  const [tab, setTab] = useState<"items" | "logs">("items")
  const [sort, setSort] = useState<SortState>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [logsVersion, setLogsVersion] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  const data = detail.data

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  // The check icon hands the goods over ("потвержден" → "в пути") or takes them in ("в пути" → "принят"); its
  // tooltip is the reference's «Подтвердить Запрос №N», the dialog names the step.
  const giveTitle = `${t("Передать")} №${data.id}`
  const acceptTitle = `${t("Принять")} №${data.id}`
  const request = `${t("Подтвердить Запрос")} №${data.id}`
  const open = (next: Pending) => {
    setError("")
    setPending(next)
  }
  /** Runs the pending step; `day` is the acceptance / hand-over day of the «ВЫПОЛНИТЬ» dialog (none: now). */
  const run = async (day?: string) => {
    if (!pending) return
    // «Удалить» of a transfer that moved or is cancelled already: the reference's failure text (its server refuses it).
    if (pending.action === "cancel" && !(data.status === "ожидает" || data.status === "потвержден")) {
      setPending(null)
      return notify(t("Удаление невозможно из-за связи с другими данными"), true)
    }
    setBusy(true)
    setError("")
    const result = await cashMutate<Transfer>("POST", `/api/internal-transfers/${id}/action`, { action: pending.action, ...(pending.withDate && day ? { date: day } : {}) })
    setBusy(false)
    if (!result.ok) {
      // «Удалить» of a transfer that moved or is cancelled already: the reference's failure text.
      if (pending.action === "cancel" && result.status === 409) {
        setPending(null)
        return notify(t("Удаление невозможно из-за связи с другими данными"), true)
      }
      // The «ВЫПОЛНИТЬ» dialog has no error line: Linko closes it and says why in the snackbar.
      if (pending.withDate) {
        setPending(null)
        return notify(mutationError(result, t), true)
      }
      return setError(mutationError(result, t))
    }
    notify(t(pending.success))
    setPending(null)
    detail.reload()
    setLogsVersion((value) => value + 1)
    onChanged()
  }

  /** «Отменить автораспределение»: at once, no confirmation; a spinner replaces the icon meanwhile. */
  const cancelAuto = async () => {
    if (cancelling) return
    setCancelling(true)
    const result = await cashMutate<{ transfers: number; lines: number }>("POST", "/api/internal-transfers/series/auto-cancel", { ids: [id] })
    setCancelling(false)
    if (!result.ok) return notify(mutationError(result, t), true)
    notify(t("Успешно завершено"))
    detail.reload()
    onChanged()
  }

  const status = data.status
  // "Итого" per unit ("5 dona, 1,5 kg"): kilograms, pieces and litres are never added up.
  const qtyTotal = formatUnitTotals(data.items.map((item) => ({ qty: item.quantity, unit: item.unit })), t)
  // The reference's header icon buttons have no hover background.
  const iconButton = "flex h-12 w-12 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
  const tipSlot = "mx-[7.5px]"
  const actionButton = "inline-flex h-[30px] items-center justify-center gap-[6px] rounded-[2px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
  const day = (moment: string) => docDate(moment, language) || t("Не указано")
  const currency = data.currency
  const sorted = sortItems(data.items, sort)
  const toggleSort = (key: SortKey) => setSort((current) => (current?.key === key ? (current.desc ? null : { key, desc: true }) : { key, desc: false }))

  const canCancel = canEdit && (status === "в пути" || status === "принят")
  // The reference prints the status of the card as its own colored word (no dot), in the UI language, with its own
  // spelling «Потвержден».
  const statusText = <span style={{ color: TRANSFER_CARD_STATUS_COLORS[status] }}>{t(status === "потвержден" ? "Потвержден" : TRANSFER_STATUS_TITLES[status])}</span>
  // Серия when a line's product keeps an expiry; Цена / Сумма only with a price list (as the reference).
  const withSeries = data.items.some((item) => item.trackExpiry)
  const withPrices = Boolean(data.priceList.trim())
  const columns: Array<[SortKey, string]> = [
    ["product", t("Товар")],
    ["quantity", t("Количество")],
    ["weight", t("Вес")],
    ...(withSeries ? ([["series", t("Серия")]] as Array<[SortKey, string]>) : []),
    ...(withPrices
      ? ([
          ["price", t("Цена")],
          ["sum", t("Сумма")],
        ] as Array<[SortKey, string]>)
      : []),
  ]
  const cancelMinus = () =>
    open(
      status === "в пути"
        ? { action: "cancel_given", title: t("Отменить передачу"), text: `${t("Передача №")}${data.id}`, withDate: false, tone: "blue", label: "Да", success: "Успешно сохранено" }
        : { action: "cancel_accepted", title: t("Отменить приемку"), text: `${t("Приемка №")}${data.id}`, withDate: false, tone: "blue", label: "Да", success: "Успешно сохранено" },
    )

  return (
    <div className="-mx-[15px] mb-[20px] mt-[20px] border-b border-dotted border-[#eee] bg-white text-[13px] text-[#333] [box-shadow:0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="relative flex h-[67px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[23px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] text-[18px] font-semibold leading-[24px]">
          {t("Передача")} № {data.id}
        </h3>
        <div className="relative z-[3] flex items-center">
          {canEdit && (
            <RefTip text={t("Авто распределение по сериям")} side="bottom" gap={9} bold className={tipSlot}>
              <button type="button" aria-label={t("Авто распределение по сериям")} className={iconButton} onClick={onAutoSet}>
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={ICON_AV_TIMER} /></svg>
              </button>
            </RefTip>
          )}
          {canEdit && (status === "потвержден" || status === "в пути") && (
            <RefTip text={request} side="right" gap={10} bold className={tipSlot}>
              <button
                type="button"
                aria-label={request}
                className={iconButton}
                onClick={() =>
                  open(
                    status === "потвержден"
                      ? { action: "give", title: giveTitle, text: `${t("Передача")} № ${data.id} · ${t("Передан со склада")} ${data.fromWarehouse}`, withDate: true, tone: "blue", label: "Передать", success: "Успешно передан" }
                      : { action: "accept", title: acceptTitle, text: `${t("Передача")} № ${data.id} · ${t("Принять на склад")} ${data.toWarehouse}`, withDate: true, tone: "green", label: "Принять", success: "Успешно сохранено" },
                  )
                }
              >
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#1E4A9A]" aria-hidden><path d={ICON_CHECK_CIRCLE} /></svg>
              </button>
            </RefTip>
          )}
          {canEdit && (
            <RefTip text={t("Отменить автораспределение")} side="right" gap={10} bold className={tipSlot}>
              <button type="button" aria-label={t("Отменить автораспределение")} aria-busy={cancelling} className={iconButton} onClick={() => void cancelAuto()}>
                {cancelling ? <Spinner size={16} /> : <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]" aria-hidden><path d={ICON_CACHED} /></svg>}
              </button>
            </RefTip>
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
          {canEdit && (
            <button type="button" onClick={() => onEdit(data)} className={`${actionButton} ml-[7.5px] w-[121px] bg-[rgb(79,113,220)]`}>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d={ICON_EDIT} /></svg> {t("Изменить")}
            </button>
          )}
          {canCancel && (
            <RefTip text={status === "в пути" ? t("Отменить передачу") : t("Отменить приемку")} side="left" gap={12} bold className="ml-[23px]">
              <button type="button" aria-label={status === "в пути" ? t("Отменить передачу") : t("Отменить приемку")} className={iconButton} onClick={cancelMinus}>
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#e57373]" aria-hidden><path d={ICON_REMOVE_CIRCLE} /></svg>
              </button>
            </RefTip>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => open({ action: "cancel", title: t("Подтверждение удаления"), text: t("Вы уверены что хотите удалить эти данные?"), withDate: false, tone: "red", label: "Удалить", success: "Успешно удалено" })}
              className={`${actionButton} ${canCancel ? "ml-[15px]" : "ml-[23px]"} w-[109px] bg-[#fa8072]`}
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d={ICON_DELETE} /></svg> {t("Удалить")}
            </button>
          )}
        </div>
      </div>

      <div className="mx-[15px] grid grid-cols-3 border-b border-[#efefef]">
        <ul className="h-[185px] border-r border-[#efefef] pl-[15px] pr-[15px] pt-[15px]">
          <Row label={t("Со склада")}>{data.fromWarehouse}</Row>
          <Row label={t("На склад")}>{data.toWarehouse}</Row>
          {withPrices && <Row label={t("Прайс лист")}>{data.priceList}</Row>}
          <Row label={t("Организация")}>{data.organization || t("Не указано")}</Row>
        </ul>
        <ul className="h-[185px] border-r border-[#efefef] pl-[15px] pr-[15px] pt-[15px]">
          <Row label={t("Номер накладной")}>{data.invoiceNumber || t("Не указано")}</Row>
          <Row label={t("Номер транспорта")}>{data.transportNumber || t("Не указано")}</Row>
          <Row label={t("Водитель")}>{data.driver || t("Не указано")}</Row>
        </ul>
        <ul className="h-[185px] pl-[15px] pr-[15px] pt-[15px]">
          <Row label={t("Статус")}>{statusText}</Row>
          <Row label={t("Дата доставки")}>{day(data.deliveredAt)}</Row>
          <Row label={t("Дата создания")}>{day(data.createdAt)}</Row>
          <Row label={t("Дата приемки")}>{day(data.acceptedAt)}</Row>
          <Row label={t("Дата передачи")}>{data.givenAt ? docDate(data.givenAt, language, true) : t("Не указано")}</Row>
          {/* Linko's card has no cancellation row: the moment is in «Логи». */}
          <Row label={t("Комментарий")}>{data.comment || t("Комментарий отсутствует")}</Row>
        </ul>
      </div>

      <div className="px-[31px] pb-[20px]">
        <div className="flex h-[49px] border-b border-[#f2f5f8]">
          {(["items", "logs"] as const).map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)} className="relative h-[48px] w-[300px] pb-[3px] text-[13px] font-medium text-black">
              {key === "items" ? t("Товары") : t("Логи")}
              {tab === key && <span className="absolute inset-x-0 -bottom-px h-[2px] bg-[rgb(79,113,220)]" />}
            </button>
          ))}
        </div>
        {tab === "logs" ? (
          <TransferLogsPanel key={logsVersion} id={data.id} />
        ) : data.items.length ? (
          // Auto layout like the reference (Товар 30%, the rest by content).
          <table className="w-full border-collapse border-l border-[#efefef] text-[13px]">
            <thead>
              <tr className="h-[35.6px] bg-[#f0f4f9] text-left text-[13px] font-semibold text-[#374557]">
                {columns.map(([key, label], index) => (
                  <th key={key} className="p-0 font-semibold" style={{ paddingLeft: 17.5, ...(index === 0 ? { width: "30%" } : {}) }}>
                    <button type="button" onClick={() => toggleSort(key)} className="flex items-center gap-[4.9px] text-left">
                      {label}
                      <span className="relative block h-[20px] w-[15px]" aria-hidden>
                        {/* Linko's mark: a sorted column keeps only the triangle of its direction. */}
                        <svg viewBox="0 0 24 24" className={`absolute left-0 top-0 h-[15px] w-[15px] ${sort?.key === key && sort.desc ? "fill-transparent" : "fill-[#9aa3b6]"}`}><path d="M7 14l5-5 5 5z" /></svg>
                        <svg viewBox="0 0 24 24" className={`absolute left-0 top-[5px] h-[15px] w-[15px] ${sort?.key === key && !sort.desc ? "fill-transparent" : "fill-[#9aa3b6]"}`}><path d="M7 10l5 5 5-5z" /></svg>
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => {
                const box = boxLine(item)
                return (
                  <tr key={item.id} className="hover:bg-[#f2f5f8]">
                    <td className={`${cell} pl-[17.5px]`}>{item.product}</td>
                    <td className={`${cell} pl-[18px]`}>
                      <div className="leading-[19.5px]">
                        {formatQty(item.quantity, item.unit ? t(item.unit) : "")}
                        {box && (
                          <p className="text-[12px] leading-[18px] text-[#1E4A9A]">
                            {box.boxes}
                            {box.rest ? <span className="ml-[4px] text-[12px]">(+{formatQty(box.rest, item.unit ? t(item.unit) : "")})</span> : null}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className={`${cell} pl-[18px]`}>{formatMoney(item.quantity * item.weight, 3)}</td>
                    {withSeries && <td className={`${cell} pl-[18px]`}>{item.series}</td>}
                    {withPrices && <td className={`${cell} pl-[18px]`}>{formatSum(item.price, currency)}</td>}
                    {withPrices && <td className={`${cell} pl-[18px]`}>{formatSum(item.quantity * item.price, currency)}</td>}
                  </tr>
                )
              })}
              <tr className="h-[39.1px] text-[15px] font-semibold">
                <td className={`${cellBase} pl-[17.5px]`}>{t("Итого")}</td>
                <td className={`${cellBase} pl-[18px]`}>{qtyTotal}</td>
                <td className={`${cellBase} pl-[18px]`}>{formatWeight(data.weight, t("кг"))}</td>
                {withSeries && <td className={cellBase} />}
                {withPrices && <td className={cellBase} />}
                {withPrices && <td className={`${cellBase} pl-[18px]`}>{formatSum(data.amount, currency)}</td>}
              </tr>
            </tbody>
          </table>
        ) : (
          <EmptyBlock text="Товаров не найдено" className="py-10" />
        )}
      </div>

      {/* Linko: hand-over and acceptance ask «ВЫПОЛНИТЬ» / «Подтверждение запроса» / «Запрос № N» with the «Дата»
          («ДА»); the minus asks «ПОДТВЕРЖДЕНИЕ ОТМЕНЫ» over «Передача №N» («ДА»); «Удалить» its delete question. */}
      {pending?.withDate && <AcceptReturnDialog returnId={data.id} busy={busy} onConfirm={(day) => void run(day)} onClose={() => setPending(null)} />}
      {pending && !pending.withDate && (
        <ConfirmDialog
          title={pending.title}
          kind={pending.action === "cancel" ? undefined : "cancel"}
          item={pending.action === "cancel" ? undefined : `${t("Передача №")}${data.id}`}
          text={pending.action === "cancel" ? pending.text : undefined}
          confirmLabel={pending.label}
          tone={pending.tone}
          busy={busy}
          error={error}
          onConfirm={() => void run()}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
