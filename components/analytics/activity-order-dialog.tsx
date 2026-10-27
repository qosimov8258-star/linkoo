"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { LOG_ACTIONS, LOG_STATUS, LogDetailsSheet, StatusIcon, formatLogDate, type ApiOrderLog, type OrderLineItem } from "@/components/orders/order-detail"
import type { Order } from "@/components/orders/orders-data"
import { ORDER_STATUS_REF_LABEL } from "@/components/orders/orders-data"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"

// The read-only order card the reference opens from an order of the activity feed (?orderDetails=ID): a 340px info column and
// the tabs "Список товаров" / "Возврат" / "Логи".
const TABS = ["Список товаров", "Возврат", "Логи"] as const
const num = (value: number | undefined, digits = 2) => (value ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: digits })
const day = (value?: string) => (value ? refDate(value.slice(0, 10)) : "")

function Row({ label, children, green, colon = true }: { label: string; children: React.ReactNode; green?: boolean; colon?: boolean }) {
  return (
    <li className="flex h-[25px] items-center justify-between text-[13px]">
      <span>{label}{colon ? " :" : ""}</span>
      <span className="font-semibold" style={green ? { color: "#81c784" } : undefined}>{children}</span>
    </li>
  )
}

function Section({ title, last, children }: { title?: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`px-[30px] pt-[15px] ${last ? "pb-[20px]" : "border-b border-[#efefef] pb-[15px]"}`}>
      {title && <div className="mb-[10px] text-[13px] font-semibold leading-[16.3px] uppercase">{title}</div>}
      {children}
    </div>
  )
}

export function ActivityOrderDialog({ order, clientId, onClose, onClient }: { order: Order; clientId: number | null; onClose: () => void; onClient: (id: number) => void }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<(typeof TABS)[number]>("Список товаров")
  const [items, setItems] = useState<OrderLineItem[]>([])
  const [logs, setLogs] = useState<ApiOrderLog[]>([])
  const [details, setDetails] = useState(false)
  useEffect(() => {
    fetch(`/api/orders/${order.id}/items`).then((r) => (r.ok ? r.json() : [])).then(setItems).catch(() => {})
    fetch(`/api/orders/${order.id}/logs`).then((r) => (r.ok ? r.json() : [])).then(setLogs).catch(() => {})
  }, [order.id])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const status = ORDER_STATUS_REF_LABEL[order.status] ?? order.status
  const delivered = order.status === "Доставлено"
  const sum = items.reduce((s, i) => s + i.lineTotal, 0)
  const qty = items.reduce((s, i) => s + i.quantity, 0)
  const unit = items[0]?.unit || "ШТ"
  const debts = (order.balance ?? "").startsWith("0 ")
  return createPortal(
    <div className="fixed inset-0 z-[1200] bg-black/[0.54] font-sans text-[13px] text-[#333]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="absolute left-1/2 top-[32px] h-[708px] w-[1400px] -translate-x-1/2 bg-white" style={{ boxShadow: "0 14px 45px rgba(0,0,0,0.25), 0 10px 18px rgba(0,0,0,0.22)" }}>
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <div className="text-[13px] font-bold uppercase">{t("Заказ")} № {order.id}</div>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>
        <div className="flex h-[648px]">
          <div className="w-[340px] shrink-0 overflow-y-auto">
            <Section>
              <ul>
                <li className="flex h-[25px] items-center justify-between text-[13px]">
                  <span>{t("Клиент")} :</span>
                  <span onClick={() => clientId && onClient(clientId)} className="max-w-[150px] cursor-pointer truncate font-semibold text-[#129fdd]">{order.marketName || order.client}</span>
                </li>
                <Row label={t("Инициатор")}>{order.agent}</Row>
                <Row colon={false} label={t("Дата создания")}>{day(order.createdAt)}</Row>
                <Row label={t("Организация")}>{order.product || order.organization}</Row>
                <Row label={t("Номер договора")}>{order.invoiceContract || t("Не указан")}</Row>
              </ul>
            </Section>
            <Section title={t("Баланс")}>
              <ul>
                <Row label={t("Прайс-лист")}>{order.priceList}</Row>
                <Row label={t("Дата окончательной оплаты")}>{day(order.dueDate)}</Row>
                <Row label={t("Тип оплаты")}>{order.payTypeName === "bank" ? t("Перечислением") : t("Наличными")}</Row>
                <Row colon={false} label={t("Общая стоимость")}>{num(order.totalPrice)} SUM</Row>
                <Row label={t("Оплачено")}>{num(Math.min(order.paidAmount ?? 0, order.totalPrice ?? order.paidAmount ?? 0))} SUM</Row>
                <Row label={t("Остаток")} green={debts}>{order.balance}</Row>
                <Row label={t("Общий долг клиента")} green={!order.actualDebt}>{num(order.actualDebt)} SUM</Row>
              </ul>
            </Section>
            <Section title={t("Комментарии")}>
              <div className="text-[13px] leading-[16.3px]">{logs.find((l) => l.comment && l.action === "created")?.comment ?? ""}</div>
            </Section>
            <Section title={t("Исполнение")} last>
              <ul>
                <Row label={t("Дата реализации")}>{day(order.acceptedDate || order.createdAt)}</Row>
                <Row label={t("Текущий статус")} green={delivered}>{t(status)}</Row>
                <Row label={t("Доставщик")}>{order.deliveryMan}</Row>
                <Row label={t("Тип передачи")}>{order.deliveryType === "self" ? t("Самовывоз") : t("Доставка")}</Row>
                <Row label={t("Дата доставки")}>{order.delivery}</Row>
              </ul>
            </Section>
          </div>
          <div className="min-w-0 flex-1 border-l border-[#efefef] px-[30px] pb-[20px]">
            <div className="relative flex h-[49px] border-b border-[#f2f5f8]">
              {TABS.map((name) => (
                <button key={name} type="button" onClick={() => setTab(name)} className="flex h-12 w-[150px] items-center justify-center rounded-[5px] text-[13px] font-medium text-black">{t(name)}</button>
              ))}
              <span className="absolute bottom-[-1px] h-[2px] w-[150px] bg-[#4f71dc] transition-transform duration-300" style={{ transform: `translateX(${TABS.indexOf(tab) * 150}px)` }} />
            </div>
            {tab === "Список товаров" && (
              <div className="pr-[30px]">
                <div className="-mx-[8px] flex h-[60px] items-center border-b-2 border-dotted border-[#e0e0e0] pl-[5px] font-semibold">
                  <div className="w-1/3 px-[8px]">{t("Товар")}</div>
                  <div className="w-1/6 px-[8px]">{t("Количество")}</div>
                  <div className="w-1/6 px-[8px]">{t("Цена")} ({order.amount.split(" ").pop()})</div>
                  <div className="w-1/6 px-[8px]">{t("Сумма")} ({order.amount.split(" ").pop()})</div>
                  <div className="w-1/6 px-[8px]">{t("Скидка")} ({order.amount.split(" ").pop()})</div>
                </div>
                {items.map((item) => (
                  <div key={item.id} className="-mx-[8px] flex h-[60px] items-center border-b-2 border-dotted border-[#e0e0e0] pl-[5px]">
                    <div className="w-1/3 px-[8px]">{item.productName}{order.stockName ? <strong> ({order.stockName})</strong> : null}</div>
                    <div className="w-1/6 px-[8px]">{num(item.quantity)}{item.unit}</div>
                    <div className="w-1/6 px-[8px]">{num(item.unitPrice)}</div>
                    <div className="w-1/6 px-[8px]">{num(item.lineTotal)}</div>
                    <div className="w-1/6 px-[8px]">{num(item.discountPercent)}</div>
                  </div>
                ))}
                <div className="-mx-[8px] mt-[20px] flex pl-[5px] font-semibold">
                  <div className="w-1/3 px-[8px]">{t("Итого")} :</div>
                  <div className="w-1/6 px-[8px]">{num(qty)}{unit}</div>
                  <div className="w-1/6 px-[8px]" />
                  <div className="w-1/6 px-[8px]">{num(sum)}</div>
                  <div className="w-1/6 px-[8px]">0</div>
                </div>
              </div>
            )}
            {tab === "Возврат" && (
              <div className="flex flex-col items-center pt-[20px] text-[#999]">
                <Image src="/robot-empty.png" alt="" width={120} height={124} className="h-[124px] w-[120px] object-contain" />
                <p className="mt-[-10px] text-[13px]">{t("В данном заказе нет возвратов")}</p>
              </div>
            )}
            {tab === "Логи" && (
              <div>
                <div className="mt-[10px] flex justify-end">
                  <button type="button" onClick={() => setDetails(true)} className="mr-2 flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white">{t("Детали изменений заказа")}</button>
                </div>
                <div className="flex flex-col pt-[15px]">
                  {logs.map((log) => {
                    const action = LOG_ACTIONS[log.action]
                    const st = LOG_STATUS[log.status]
                    const tone = action?.tone === "begin" ? "border-[#64b5f6] text-[#64b5f6]" : action?.tone === "error" ? "border-[#e57373] text-[#e57373]" : "border-[#81c784] text-[#81c784]"
                    return (
                      <div key={log.id} className="mb-5 grid grid-cols-2 gap-y-[7px] rounded-[10px] border border-[#e5e8f1] bg-[#fbfbfb] p-5 [&_p]:leading-[26px]">
                        <div className="flex">
                          <div className="flex items-center">
                            <span className="font-semibold">{t("Заказ")}:</span>
                            {action ? <span className={`ml-[5px] whitespace-nowrap rounded-[15px] border px-[7px] py-px ${tone}`}>{t(action.label)}</span> : t("Не установлен")}
                          </div>
                          {st && (
                            <div className="ml-[10px] flex items-center">
                              <span className="font-semibold">{t("Статус")}:</span>
                              <span className="flex h-[33px] w-[33px] items-center justify-center"><StatusIcon status={st.status} color={st.color} size={23} /></span>
                              <span>{t(st.label)}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center">
                          <p><span className="font-semibold">{t("Кем")}:</span> {log.createdBy}</p>
                          <div className="ml-5 flex items-center"><span className="font-semibold">{t("Когда")}:</span><p className="ml-[5px]">{formatLogDate(log.createdAt)}</p></div>
                          <div className="ml-[10px] flex items-center"><span className="mr-[5px] font-semibold">{t("Сумма")}:</span> {num(log.totalPrice)} {log.currency}</div>
                        </div>
                        {log.comment && <div className="col-span-full flex items-center"><span className="mr-[5px] font-semibold">{t("Комментарий")}:</span><p>{t(log.comment)}</p></div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {details && <LogDetailsSheet orderId={order.id} logs={logs} onClose={() => setDetails(false)} />}
    </div>,
    document.body,
  )
}
