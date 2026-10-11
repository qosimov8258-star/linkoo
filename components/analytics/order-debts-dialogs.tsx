"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Banknote, CreditCard, Pencil, X } from "lucide-react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { PaymentModal } from "@/components/analytics/customer-payments-dialogs"
import { formatRuDate } from "@/components/analytics/customer-payments-filters"
import { ExpectedPaymentPayDialog } from "@/components/analytics/expected-payments-pay-dialog"
import { convertMoney, type RateMap } from "@/lib/cash/rates"
import type { CustomerPaymentOptions } from "@/lib/cash/customer-payments-types"
import type { CategoryOptionKey } from "@/lib/cash/types"
import { currencyLabel, formatMoney, roundMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import {
  bucketLabel,
  fillTemplate,
  type DebtBucket,
  type OrderDebtClientDetail,
  type OrderDebtConfig,
  type OrderDebtOrderDetail,
  type OrderDebtOrderRow,
} from "@/lib/finance-order-debts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of "Долги с заказов": "Настроить период" (demo a(3775)), the client
// drill-down (a(3771)) with "Пересчитать с даты" (a(3772)) and "Изменение даты
// оплаты" (ORDER_MULTI_UPDATE), the order dialog with "Оплатить" (the shared
// order-mode "Приход" dialog → POST /api/cash/orders/[id]/pay, income category
// with the «Заказ» option = demo key_name=order) and "Групповая оплата"
// (a(2168) → POST /api/order-debts/group-payment).

const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b] disabled:bg-[#f2f5f8]"

function Label({ text, children }: { text: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-[#586174]">{t(text)}</span>
      {children}
    </label>
  )
}

function ErrorLine({ error }: { error: string }) {
  const { t } = useLanguage()
  return error ? <p className="rounded-md bg-[#fdecec] px-3 py-2 text-sm text-[#d64545]">{t(error)}</p> : null
}

function SaveButton({ busy, disabled = false }: { busy: boolean; disabled?: boolean }) {
  const { t } = useLanguage()
  return (
    <button type="submit" disabled={busy || disabled} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white disabled:opacity-50">
      {busy ? t("Сохранение...") : t("Сохранить")}
    </button>
  )
}

const money = (value: number, currency?: string) => `${formatMoney(value, 2)}${currency ? ` ${currencyLabel(currency)}` : ""}`

/** Translated bucket header ("Прошло до 7 дней", "C 7 дней - До 30", …). */
export function useBucketTitle(config: OrderDebtConfig) {
  const { t } = useLanguage()
  return (bucket: DebtBucket | "total") => {
    const label = bucketLabel(bucket, config)
    return fillTemplate(t(label.key), label.values)
  }
}

// --- "Настроить период" -----------------------------------------------------------------

export function OrderDebtPeriodDialog({ config, onClose, onSaved }: { config: OrderDebtConfig; onClose: () => void; onSaved: (config: OrderDebtConfig) => void }) {
  const [values, setValues] = useState({ first: String(config.firstDebtPeriod), second: String(config.secondDebtPeriod), third: String(config.thirdDebtPeriod) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async () => {
    const body = { firstDebtPeriod: Number(values.first), secondDebtPeriod: Number(values.second), thirdDebtPeriod: Number(values.third) }
    if (Object.values(body).some((value) => !Number.isInteger(value) || value < 1)) return setError("Укажите количество дней")
    setBusy(true)
    setError("")
    const result = await cashMutate<OrderDebtConfig>("PUT", "/api/order-debts/settings", body)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onSaved(result.data)
  }
  return (
    <PaymentModal title="Настроить период" onClose={onClose} width={500}>
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {(
          [
            ["first", "Первый период"],
            ["second", "Второй период"],
            ["third", "Третий период"],
          ] as const
        ).map(([field, label]) => (
          <Label key={field} text={label}>
            <input
              type="number"
              min={1}
              max={3650}
              value={values[field]}
              onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
              className={fieldClass}
              required
            />
          </Label>
        ))}
        <ErrorLine error={error} />
        <div className="flex justify-end">
          <SaveButton busy={busy} />
        </div>
      </form>
    </PaymentModal>
  )
}

// --- "Пересчитать" (client) ---------------------------------------------------------------

function RecalcDialog({ clientId, onClose, onDone }: { clientId: number; onClose: () => void; onDone: () => void }) {
  const [fromDate, setFromDate] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate("POST", "/api/order-debts/recalc", { clientId, fromDate: fromDate || undefined })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onDone()
  }
  return (
    <PaymentModal title="Пересчитать" onClose={onClose} width={400}>
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Label text="Пересчитать с даты">
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={fieldClass} />
        </Label>
        <ErrorLine error={error} />
        <div className="flex justify-end">
          <SaveButton busy={busy} />
        </div>
      </form>
    </PaymentModal>
  )
}

// --- "Изменение даты оплаты" --------------------------------------------------------------

export function PaymentDateDialog({ orderIds, single, initial = "", onClose, onDone }: { orderIds: number[]; single: boolean; initial?: string; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const [day, setDay] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate("POST", "/api/order-debts/payment-date", { orderIds, paymentDate: day })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onDone()
  }
  const title = `${t("Изменение даты оплаты")} ${single ? `${t("заказа")}: №${orderIds[0]}` : t("всех заказов")}`
  return (
    <PaymentModal title={title} onClose={onClose} width={400}>
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Label text="Дата оплаты">
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)} className={fieldClass} />
        </Label>
        <ErrorLine error={error} />
        <div className="flex justify-end">
          <SaveButton busy={busy} />
        </div>
      </form>
    </PaymentModal>
  )
}

// --- status cell (demo a(651)) ----------------------------------------------------------------

/** Payment icon (cash / bank) coloured by the promised payment date + the order status. */
export function OrderPaymentStatus({ row, today }: { row: Pick<OrderDebtOrderRow, "paymentType" | "paymentDate" | "remaining" | "currency" | "status">; today: string }) {
  const { t, language } = useLanguage()
  const due = row.paymentDate
  const owes = row.remaining > 0.005
  const amount = money(row.remaining, row.currency)
  let color = "#b7bbb7"
  let tip = ""
  if (!owes) {
    color = "#81c784"
    tip = t("Оплачено")
  } else if (due && due > today) {
    tip = `${t("Оплата ожидается")}: ${formatRuDate(due, false, language)}\n${t("Ожидаемый платеж")}: ${amount}`
  } else if (due === today) {
    color = "#f0ad4e"
    tip = `${t("Оплата ожидается сегодня")}\n${t("Сумма")}: ${amount}`
  } else if (due) {
    color = "#e57373"
    tip = `${t("Оплата ожидалась")}: ${formatRuDate(due, false, language)}\n${t("Долг")}: ${amount}`
  } else tip = `${t("Долг")}: ${amount}`
  const Icon = row.paymentType === "bank" ? CreditCard : Banknote
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span title={tip} className="inline-flex">
        <Icon className="h-5 w-5" style={{ color }} />
      </span>
      <span className="whitespace-nowrap text-[13px] text-[#586174]">{t(row.status)}</span>
    </span>
  )
}

// --- client drill-down ------------------------------------------------------------------------

export function ClientDebtDetail({
  clientKey,
  name,
  canEdit,
  onClose,
  onOpenOrder,
  onChanged,
  notify,
}: {
  clientKey: string
  name: string
  canEdit: boolean
  onClose: () => void
  onOpenOrder: (orderId: number) => void
  /** Something was saved (refresh the page data). */
  onChanged: () => void
  notify: (text: string) => void
}) {
  const { t, language } = useLanguage()
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 })
  const detail = useCashJson<OrderDebtClientDetail>(`/api/order-debts/clients/${encodeURIComponent(clientKey)}?page=${paging.page}&pageSize=${paging.pageSize}`)
  const [editDates, setEditDates] = useState<{ ids: number[]; single: boolean; initial: string } | null>(null)
  const [recalcOpen, setRecalcOpen] = useState(false)
  const data = detail.data
  const lines = data?.lines ?? []
  const orderIds = [...new Set(lines.flatMap((line) => (line.kind === "order" ? [line.orderId] : [])))]
  const unexplained = Object.entries(data?.unexplained ?? {})
  const today = data?.today ?? todayIso()
  const clientId = data?.client.id ?? null

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10" onClick={onClose}>
      <div className="w-full max-w-[1000px] rounded-md bg-white shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex h-[60px] items-center justify-between pl-[30px] pr-3">
          <span className="font-bold uppercase text-[#17233b]">{data?.client.name || name}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="p-2 text-[#666]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-6 border-t border-[#efefef] px-[30px] py-2">
          {canEdit && clientId !== null && (
            <button type="button" onClick={() => setRecalcOpen(true)} className="h-[30px] rounded-md bg-[#4f70e7] px-4 text-[13px] font-semibold text-white">
              {t("Пересчитать")}
            </button>
          )}
          <BalancePagination page={paging.page} pageSize={paging.pageSize} count={data?.count ?? 0} onChange={setPaging} />
        </div>
        {data?.client.wrongDebt && unexplained.length > 0 && (
          <div className="mx-[30px] mb-3 rounded-[10px] border border-[#ffd6d6] border-l-[5px] border-l-[#e54848] bg-[#fff5f5] px-3 py-2 text-[14px] font-semibold text-[#a8071a]">
            {t("Требуется перерасчет")}: {t("Долг без заказа")} {unexplained.map(([code, value]) => money(value, code)).join(", ")}
          </div>
        )}
        {detail.error && <p className="px-[30px] py-3 text-[#e57373]">{t(detail.error)}</p>}
        <div className="overflow-x-auto border-t border-[#efefef]">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr className="h-[50px] text-left font-semibold text-[#666]">
                <th className="pl-[30px] pr-2">№ {t("заказа")}</th>
                <th className="px-2">{t("Ожидаемая дата оплаты")}</th>
                <th className="px-2">{t("Тип оплаты")}</th>
                <th className="px-2 text-right">{t("Сумма заказа")}</th>
                <th className="px-2 text-right">{t("Осталось")}</th>
                <th className="px-2 text-right">{t("Статус")}</th>
                <th className="pl-2 pr-[30px] text-right">
                  {canEdit && orderIds.length > 0 && (
                    <button
                      type="button"
                      title={t("Изменить дату оплаты всех заказов")}
                      aria-label={t("Изменить дату оплаты всех заказов")}
                      onClick={() => setEditDates({ ids: orderIds, single: false, initial: "" })}
                      className="p-1 text-[#666] hover:text-[#4f70e7]"
                    >
                      <Pencil className="h-5 w-5" />
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody className={detail.loading ? "opacity-60" : ""}>
              {lines.map((line) =>
                line.kind === "order" ? (
                  <tr key={line.key} className="group h-[50px] cursor-pointer border-t border-dashed border-[#efefef] hover:bg-[#f2f5f8]" onClick={() => onOpenOrder(line.orderId)}>
                    <td className="pl-[30px] pr-2">{line.orderId}</td>
                    <td className="px-2">{line.paymentDate ? formatRuDate(line.paymentDate, false, language) : t("Не указано")}</td>
                    <td className="px-2">{line.paymentType === "bank" ? `${t("Переч")}.` : `${t("Нал")}.`}</td>
                    <td className="whitespace-nowrap px-2 text-right">{money(line.total, line.currency)}</td>
                    <td className="whitespace-nowrap px-2 text-right font-semibold text-[#E27676]">{money(line.remaining, line.currency)}</td>
                    <td className="px-2 text-right">
                      <OrderPaymentStatus row={line} today={today} />
                    </td>
                    <td className="pl-2 pr-[30px] text-right" onClick={(event) => event.stopPropagation()}>
                      {canEdit && (
                        <button
                          type="button"
                          title={t("Изменить дату оплаты")}
                          aria-label={t("Изменить дату оплаты")}
                          onClick={() => setEditDates({ ids: [line.orderId], single: true, initial: line.paymentDate })}
                          className="p-1 text-[#666] opacity-0 transition-opacity hover:text-[#4f70e7] group-hover:opacity-100 focus:opacity-100"
                        >
                          <Pencil className="h-5 w-5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr key={line.key} className="h-[50px] border-t border-dashed border-[#efefef]">
                    <td className="pl-[30px] pr-2 text-[#586174]">—</td>
                    <td className="px-2" colSpan={2}>
                      {fillTemplate(t("Долг без заказа с {date}"), { date: formatRuDate(line.date, false, language) })}
                    </td>
                    <td className="px-2 text-right">—</td>
                    <td className="whitespace-nowrap px-2 text-right font-semibold text-[#E27676]">{money(line.remaining, line.currency)}</td>
                    <td className="px-2" />
                    <td className="pl-2 pr-[30px]" />
                  </tr>
                ),
              )}
              {!lines.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#9aa3b6]">
                    {detail.loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editDates && (
        <PaymentDateDialog
          orderIds={editDates.ids}
          single={editDates.single}
          initial={editDates.initial}
          onClose={() => setEditDates(null)}
          onDone={() => {
            setEditDates(null)
            detail.reload()
            onChanged()
            notify(t("Заказы успешно изменены"))
          }}
        />
      )}
      {recalcOpen && clientId !== null && (
        <RecalcDialog
          clientId={clientId}
          onClose={() => setRecalcOpen(false)}
          onDone={() => {
            setRecalcOpen(false)
            detail.reload()
            onChanged()
            notify(t("Долги пересчитаны"))
          }}
        />
      )}
    </div>
  )
}

// --- order dialog -----------------------------------------------------------------------------

export function OrderDebtOrderDialog({
  orderId,
  canEdit,
  options,
  onClose,
  onChanged,
  notify,
}: {
  orderId: number
  canEdit: boolean
  options: CustomerPaymentOptions | null
  onClose: () => void
  onChanged: () => void
  notify: (text: string) => void
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<OrderDebtOrderDetail>(`/api/order-debts/orders/${orderId}`)
  const [paying, setPaying] = useState<string | null>(null)
  const [editDate, setEditDate] = useState(false)
  const data = detail.data
  const order = data?.order
  const open = (data?.parts ?? []).filter((part) => part.remaining > 0.005)

  const info: Array<[string, ReactNode]> = order
    ? [
        ["Клиент", order.client.name],
        ["Статус", t(order.status)],
        ["Дата создания", order.createdAt ? formatRuDate(order.createdAt, true, language) : t("Не указано")],
        ["Дата реализации", order.realizationDate ? formatRuDate(order.realizationDate, false, language) : t("Не указано")],
        ["Дата доставки", order.deliveryDate ? formatRuDate(order.deliveryDate, false, language) : t("Не указано")],
        ["Срок оплаты", order.paymentDate ? formatRuDate(order.paymentDate, false, language) : t("Не указано")],
        ["Тип оплаты", t(order.paymentType === "bank" ? "Перечислением" : "Наличными")],
        ["Агент", order.agent || t("Не указано")],
        ["Доставщик", order.deliveryMan || t("Не указано")],
        ["Организация", order.organization || t("Не указано")],
        ["Зона", order.zone || t("Не указано")],
        ["Прошло дней", order.passedDays],
      ]
    : []

  return (
    <PaymentModal title={`${t("Заказ")} №${orderId}`} onClose={onClose} width={860}>
      {detail.error && <p className="px-5 py-6 text-[#e57373]">{t(detail.error)}</p>}
      {!data && !detail.error && <p className="px-5 py-6 text-[#9aa3b6]">{t("Загрузка...")}</p>}
      {data && order && (
        <div className="flex flex-col gap-5 px-5 py-5 text-[14px]">
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md bg-[#f2f5f8] px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
            {info.map(([label, value]) => (
              <p key={label} className="flex justify-between gap-2">
                <span className="text-[#586174]">{t(label)}</span>
                <strong className="text-right text-[#17233b]">{value}</strong>
              </p>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#edf2f7] text-left text-[#253653]">
                  <th className="px-3 py-2">{t("Валюта")}</th>
                  <th className="px-3 py-2 text-right">{t("Сумма заказа")}</th>
                  <th className="px-3 py-2 text-right">{t("Оплачено по заказу")}</th>
                  <th className="px-3 py-2 text-right">{t("Зачтено из оплат клиента")}</th>
                  <th className="px-3 py-2 text-right">{t("Осталось")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.parts.map((part) => (
                  <tr key={part.currency} className="border-b border-[#e1e5eb]">
                    <td className="px-3 py-2">{currencyLabel(part.currency)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(part.total)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(part.paid)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{money(part.allocated)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-[#E27676]">{money(part.remaining)}</td>
                    <td className="px-3 py-2 text-right">
                      {canEdit && part.remaining > 0.005 && (
                        <button type="button" onClick={() => setPaying(part.currency)} className="h-8 rounded-md bg-[#4f70e7] px-4 text-[13px] font-semibold text-white">
                          {t("Оплатить")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#edf2f7] text-left text-[#253653]">
                    <th className="px-3 py-2">{t("Товар")}</th>
                    <th className="px-3 py-2 text-right">{t("Количество")}</th>
                    <th className="px-3 py-2 text-right">{t("Цена")}</th>
                    <th className="px-3 py-2 text-right">{t("Скидка")}</th>
                    <th className="px-3 py-2 text-right">{t("Сумма")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b border-[#e1e5eb]">
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {formatMoney(item.quantity, 3)} {item.unit}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{money(item.price, item.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{item.discount ? `${formatMoney(item.discount, 2)}%` : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{money(item.amount, item.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setEditDate(true)} className="flex h-10 items-center gap-2 rounded-md border border-[#4f70e7] px-4 font-semibold text-[#4f70e7]">
                <Pencil className="h-4 w-4" /> {t("Изменить дату оплаты")}
              </button>
              {open.length === 1 && (
                <button type="button" onClick={() => setPaying(open[0].currency)} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white">
                  {t("Оплатить")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {paying && (
        <ExpectedPaymentPayDialog
          orderId={orderId}
          currency={paying}
          options={options}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null)
            detail.reload()
            onChanged()
            notify(t("Успешно сохранено"))
          }}
        />
      )}
      {editDate && order && (
        <PaymentDateDialog
          orderIds={[orderId]}
          single
          initial={order.paymentDate}
          onClose={() => setEditDate(false)}
          onDone={() => {
            setEditDate(false)
            detail.reload()
            onChanged()
            notify(t("Заказы успешно изменены"))
          }}
        />
      )}
    </PaymentModal>
  )
}

// --- "Групповая оплата" -----------------------------------------------------------------------

type Category = { id: number; name: string; kind: string; options: CategoryOptionKey[] }
type GroupResult = { results: Array<{ orderId: number; docNo: number }>; failed: Array<{ orderId: number; error: string }> }

export function OrderGroupPaymentDialog({
  rows,
  options,
  onClose,
  onSaved,
}: {
  rows: OrderDebtOrderRow[]
  options: CustomerPaymentOptions | null
  onClose: () => void
  onSaved: (result: GroupResult) => void
}) {
  const { t } = useLanguage()
  const categories = useCashJson<{ categories: Category[] }>("/api/cash/categories?kind=income")
  const orderCategories = useMemo(() => (categories.data?.categories ?? []).filter((category) => category.options.includes("order")), [categories.data])
  const [date, setDate] = useState(todayIso())
  const [branch, setBranch] = useState(options?.branches[0] ?? "")
  const [cashboxId, setCashboxId] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [responsibleId, setResponsibleId] = useState("")
  const [verified, setVerified] = useState(true)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const base = options?.baseCurrency ?? "SUM"
  const rates: RateMap = useMemo(() => Object.fromEntries((options?.currencies ?? []).map((item) => [item.code, item.rate])), [options])
  const cashbox = options?.cashboxes.find((item) => String(item.id) === cashboxId) ?? null
  const categoryValue = categoryId ?? (orderCategories[0] ? String(orderCategories[0].id) : "")
  /** The order remainder in the cashbox currency (current rates). */
  const remainderIn = (row: OrderDebtOrderRow) => {
    if (!cashbox || cashbox.currency === row.currency) return row.remaining
    return convertMoney(row.remaining, row.currency, cashbox.currency, rates, base)
  }
  const parse = (value: string) => {
    const parsed = Number(value.replace(/\s/g, "").replace(",", "."))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  const submit = async () => {
    if (!cashbox) return setError("Выберите кассу")
    const items = rows
      .map((row) => ({ orderId: row.orderId, currency: row.currency, amount: parse(amounts[row.key] ?? ""), comment: (comments[row.key] ?? "").trim() || undefined }))
      .filter((item) => item.amount > 0)
    if (!items.length) return setError("Укажите сумму")
    setBusy(true)
    setError("")
    const result = await cashMutate<GroupResult>("POST", "/api/order-debts/group-payment", {
      cashboxId: cashbox.id,
      date: date || undefined,
      branch: branch || undefined,
      categoryId: categoryValue ? Number(categoryValue) : undefined,
      responsibleId: responsibleId ? Number(responsibleId) : undefined,
      isVerified: verified,
      items,
    })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onSaved(result.data)
  }

  return (
    <PaymentModal title="Групповая оплата" onClose={onClose} width={980}>
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Label text="Касса">
            <select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} className={fieldClass} required>
              <option value="">{t("Выберите кассу")}</option>
              {(options?.cashboxes ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({currencyLabel(item.currency)})
                </option>
              ))}
            </select>
          </Label>
          <Label text="Дата оплаты">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} required />
          </Label>
          <Label text="Филиал">
            <select value={branch} onChange={(event) => setBranch(event.target.value)} className={fieldClass}>
              <option value="">{t("Не указано")}</option>
              {(options?.branches ?? []).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Категория прихода">
            <select value={categoryValue} onChange={(event) => setCategoryId(event.target.value)} className={fieldClass}>
              <option value="">{t("Не указано")}</option>
              {orderCategories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Ответственный персонал">
            <select value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)} className={fieldClass}>
              <option value="">{t("Не указано")}</option>
              {(options?.employees ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Label>
          <label className="flex items-center gap-2 pt-6 text-[14px] text-[#17233b]">
            <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Подтвержденный приход (Я получил деньги)")}
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <thead>
              <tr className="bg-[#edf2f7] text-left text-[#253653]">
                <th className="px-2 py-2">{t("Заказ")}</th>
                <th className="px-2 py-2">{t("Клиент")}</th>
                <th className="px-2 py-2">{t("Доставщик")}</th>
                <th className="px-2 py-2 text-right">{t("Сумма заказа")}</th>
                <th className="px-2 py-2 text-right">{t("Остаток")}</th>
                <th className="px-2 py-2">
                  {t("Сумма оплаты")}
                  {cashbox ? ` (${currencyLabel(cashbox.currency)})` : ""}
                </th>
                <th className="px-2 py-2">{t("Комментарий")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const fill = remainderIn(row)
                return (
                  <tr key={row.key} className="border-b border-[#e1e5eb]">
                    <td className="px-2 py-2">№{row.orderId}</td>
                    <td className="px-2 py-2">{row.client.name}</td>
                    <td className="px-2 py-2">{row.deliveryMan || t("Не указано")}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{money(row.total, row.currency)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{money(row.remaining, row.currency)}</td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-1">
                        <input
                          inputMode="decimal"
                          value={amounts[row.key] ?? ""}
                          onChange={(event) => setAmounts((current) => ({ ...current, [row.key]: event.target.value }))}
                          aria-label={`${t("Сумма оплаты")} №${row.orderId}`}
                          className={`${fieldClass} h-9 min-w-[110px]`}
                        />
                        <button
                          type="button"
                          disabled={fill === null}
                          title={t("Остаток")}
                          onClick={() => setAmounts((current) => ({ ...current, [row.key]: fill === null ? "" : String(roundMoney(fill)) }))}
                          className="h-9 whitespace-nowrap rounded-md border border-[#4f70e7] px-2 text-[12px] font-semibold text-[#4f70e7] disabled:opacity-40"
                        >
                          {t("Остаток")}
                        </button>
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        value={comments[row.key] ?? ""}
                        onChange={(event) => setComments((current) => ({ ...current, [row.key]: event.target.value }))}
                        aria-label={`${t("Комментарий")} №${row.orderId}`}
                        className={`${fieldClass} h-9 min-w-[140px]`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <ErrorLine error={error} />
        <div className="flex justify-end">
          <SaveButton busy={busy} disabled={!rows.length} />
        </div>
      </form>
    </PaymentModal>
  )
}
