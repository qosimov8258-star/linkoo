"use client"

import type { ReactNode } from "react"

import Link from "next/link"

import { useLanguage } from "@/lib/i18n/language-context"

// The draft order's card (the reference's #/draft/order/<id>): it takes its row's place in the «Интеграция» list,
// 15 px wider than the list on each side with a 20 px gap above and below. A 65 px title bar («Заказ №<номер>»; a click
// on it closes the card, the trash asks «Подтверждение отмены» and deletes the draft), then the draft's fields on the
// left (340 px) and its product lines on the right (№ / Товар / Количество / Сумма, then «Итого» = the draft's total).

export type DraftOrderLine = { id: number; productId: number | null; name: string; amount: string; totalPrice: string }

/** The draft fields the card prints (components/orders/draft-orders-view.tsx DraftOrder). */
export type DraftOrderCard = {
  id: number
  serviceId?: string | null
  market?: { id: number; name: string } | null
  deliveryMan?: string | null
  user?: string | null
  clientName: string
  createdAt: string
  delivererName: string
  deliveryDate: string
  total: string
  products?: DraftOrderLine[]
}

const DELETE_ICON = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
/** The reference's dotted row separator (a 2 px dotted image under every row of the table). */
const DOTTED = "relative flex items-center -mx-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

/** The link to the linked client: the Клиенты page searched by its name, in a new tab (the reference's target=_blank). */
export const clientHref = (market: { id: number; name: string }) => `/clients?${new URLSearchParams({ openShop: String(market.id), search: market.name })}`

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="relative flex w-full flex-wrap justify-between leading-[25px]">
      <span>{label}:</span>
      <span className="max-w-[50%] overflow-hidden text-ellipsis whitespace-nowrap text-right font-semibold">{children}</span>
    </li>
  )
}

export function DraftOrderDetail({ order, onClose, onDelete }: { order: DraftOrderCard; onClose: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  const cell = "px-2"
  return (
    <div className="-mx-[15px] bg-[#f2f5f8] py-[20px]">
      <div className="flex w-full flex-wrap border-b border-dotted border-[#eee] bg-white leading-[16.25px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div className="relative flex h-[65px] w-full items-center justify-between border-b border-[#efefef] px-[30px]">
          <div className="cursor-pointer text-[18px] font-semibold leading-[22.5px] text-[#333]">
            {t("Заказ")} №{order.serviceId ?? order.id}
          </div>
          <div role="button" tabIndex={-1} aria-label={t("Закрыть")} onClick={onClose} className="absolute inset-0 z-[1] cursor-pointer" />
          <div className="relative z-[3] flex justify-end">
            <button type="button" title={t("Удалить")} aria-label={t("Удалить")} onClick={onDelete} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]" aria-hidden>
                <path d={DELETE_ICON} />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex w-full">
          <div className="w-[340px] shrink-0 border-r border-[#efefef]">
            <div className="px-[30px] pb-[20px] pt-[15px]">
              <ul>
                <Field label={t("Клиент")}>
                  {order.market ? (
                    <Link href={clientHref(order.market)} target="_blank" className="font-semibold">
                      {order.market.name}
                    </Link>
                  ) : (
                    <strong className="font-semibold">{t("Не указано")}</strong>
                  )}{" "}
                  <br />
                  {order.clientName}
                </Field>
                <Field label={t("Дата создания")}>{order.createdAt}</Field>
                <Field label={t("Доставщик")}>
                  {order.deliveryMan || t("Не указано")} <br />
                  {order.delivererName}
                </Field>
                <Field label={t("Дата доставки")}>{order.deliveryDate === "Самовывоз" ? t(order.deliveryDate) : order.deliveryDate}</Field>
                <Field label={t("Агент")}>{order.user || t("Не указано")}</Field>
                <Field label={t("Сумма заказа")}>{order.total}</Field>
              </ul>
            </div>
          </div>
          <div className="min-w-0 flex-1 px-[30px] pb-[20px]">
            <div className={`${DOTTED} py-[20px]`}>
              <div className={`${cell} w-1/12`}>№</div>
              <div className={`${cell} w-5/12`}>{t("Товар")}</div>
              <div className={`${cell} w-3/12`}>{t("Количество")}</div>
              <div className={`${cell} w-3/12`}>{t("Сумма")}</div>
            </div>
            {(order.products ?? []).map((line, index) => (
              <div key={line.id} className={`${DOTTED} min-h-[60px] py-[5px]`}>
                <div className={`${cell} w-1/12`}>{index + 1}</div>
                <div className={`${cell} w-5/12`}>{line.name}</div>
                <div className={`${cell} w-3/12`}>{line.amount}</div>
                <div className={`${cell} w-3/12`}>{line.totalPrice}</div>
              </div>
            ))}
            <div className={`${DOTTED} py-[20px] font-semibold`}>
              <div className={`${cell} w-9/12`}>{t("Итого")}</div>
              <div className={`${cell} w-2/12`}>{order.total}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
