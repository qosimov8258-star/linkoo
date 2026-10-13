"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronDown, X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

import type { Order } from "./orders-data"

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type OrderLineItem = {
  id: number
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  discountPercent: number
  currency: string
  lineTotal: number
}

type OrderLog = {
  kind: "Обновленный" | "Создан"
  status: string
  by: string
  at: string
  sum: string
  comment?: string
}

type InvoiceDetails = { number: string; date: string; contract: string; active: boolean }

type OrderExtras = { invoice?: InvoiceDetails; logs?: OrderLog[] }

export const ORDER_STATUS_OPTIONS = ["Не подтвержден", "В процессе", "Есть на складе", "В пути", "Доставлено", "Отменен"]

const STATUS_MENU: { status: string; label: string; icon: string; color: string }[] = [
  { status: "Не подтвержден", label: "Не подтвержденный", icon: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z", color: "#757575" },
  {
    status: "В процессе",
    label: "В процессе",
    icon: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
    color: "#f0ad4e",
  },
  { status: "Есть на складе", label: "Есть на складе", icon: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z", color: "#f0ad4e" },
  {
    status: "В пути",
    label: "Передан доставщику",
    icon: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
    color: "#f0ad4e",
  },
  {
    status: "Доставлено",
    label: "Доставлен",
    icon: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    color: "#71ce87",
  },
  {
    status: "Отменен",
    label: "Отменен",
    icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z",
    color: "#e57373",
  },
]

const ICONS = {
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  discount:
    "M12.5 6.9c1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-.53.12-1.03.3-1.48.54l1.47 1.47c.41-.17.91-.27 1.51-.27zM5.33 4.06 4.06 5.33 7.5 8.77c0 2.08 1.56 3.21 3.91 3.91l3.51 3.51c-.34.48-1.05.91-2.42.91-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c.96-.18 1.82-.55 2.45-1.12l2.22 2.22 1.27-1.27L5.33 4.06z",
  undo: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  print: "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  sync: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z",
  article:
    "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  clock:
    "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  money:
    "M2 7h20v10H2V7zm10 2a3 3 0 100 6 3 3 0 000-6zM5 9v2a2 2 0 002-2H5zm14 0a2 2 0 002 2V9h-2zM5 15a2 2 0 012 2H5v-2zm14 2a2 2 0 012-2v2h-2z",
  check:
    "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
}

const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const MONTH_PREFIXES = ["янв", "фев", "мар", "апр", "ма", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

function formatRuDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${RU_SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function toInputDate(value: string) {
  const match = /(\d{1,2})\s+([А-Яа-я]+)\.?\s+(\d{4})/.exec(value)
  const date = new Date()
  if (match) {
    const month = MONTH_PREFIXES.findIndex((prefix) => match[2].toLowerCase().startsWith(prefix))
    if (month >= 0) date.setFullYear(Number(match[3]), month, Number(match[1]))
  }
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function fromInputDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : formatRuDate(date)
}

function formatNumber(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

function nowStamp() {
  const date = new Date()
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  return `${formatRuDate(date)}, ${hh}:${mm}`
}

/* ------------------------------------------------------------------ */
/* Persisted extras (invoice details + change log)                    */
/* ------------------------------------------------------------------ */

const EXTRAS_KEY = "linko-order-extras-v1"

function readExtras(orderId: number): OrderExtras {
  try {
    const all = JSON.parse(window.localStorage.getItem(EXTRAS_KEY) ?? "{}") as Record<string, OrderExtras>
    return all[orderId] ?? {}
  } catch {
    return {}
  }
}

function writeExtras(orderId: number, extras: OrderExtras) {
  try {
    const all = JSON.parse(window.localStorage.getItem(EXTRAS_KEY) ?? "{}") as Record<string, OrderExtras>
    all[orderId] = extras
    window.localStorage.setItem(EXTRAS_KEY, JSON.stringify(all))
  } catch {
    // storage is optional
  }
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Mi({ d, className = "h-[18px] w-[18px] fill-white" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={d} />
    </svg>
  )
}

function HeaderButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95"
    >
      <Mi d={icon} className="mb-1 h-[18px] w-[18px] fill-white" />
      <span className="pl-2 pr-4">{label}</span>
    </button>
  )
}

function MenuItem({ icon, color = "#666", label, onClick }: { icon: string; color?: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-12 w-full items-center gap-[10px] pl-[22px] pr-6 text-left text-[13px] text-[#333] hover:bg-[#f5f5f5]">
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden>
        <path d={icon} fill={color} />
      </svg>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}

function Menu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <>
      <button type="button" data-order-overlay aria-label="close" onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
      <div className="absolute right-0 top-[30px] z-[115] min-w-[224px] rounded-[2px] bg-white py-[5px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">{children}</div>
    </>
  )
}

function DialogShell({
  title,
  onClose,
  action,
  onAction,
  children,
  disabled,
}: {
  title: string
  onClose: () => void
  action: string
  onAction: () => void
  children: ReactNode
  disabled?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div data-order-overlay className="fixed inset-0 z-[130] flex items-center justify-center bg-black/[0.54] p-4 font-sans text-[13px] text-[#333]">
      <div className="w-[500px] max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between border-b border-[#e8e8e8] px-[30px] py-[22px]">
          <h3 className="text-[13px] font-bold uppercase leading-4 tracking-[0.2px]">{title}</h3>
          <button type="button" aria-label="close" onClick={onClose}>
            <Mi d={ICONS.close} className="h-6 w-6 fill-[#333]" />
          </button>
        </div>
        <div className="min-h-[120px] px-[30px] py-5">{children}</div>
        <div className="flex justify-end border-t border-[#e8e8e8] px-[30px] py-[18px]">
          <button type="button" disabled={disabled} onClick={onAction} className="text-[13px] font-semibold uppercase text-[#0a9ddb] disabled:opacity-40">
            {action}
          </button>
        </div>
      </div>
    </div>
  )
}

function SheetShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div data-order-overlay className="fixed inset-0 z-[120] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[59px] shrink-0 items-center justify-between border-b border-[#efefef] px-[30px]">
        <h3 className="text-[13px] font-bold uppercase leading-4">{title}</h3>
        <button type="button" aria-label="close" onClick={onClose}>
          <Mi d={ICONS.close} className="h-6 w-6 fill-[#333]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-[#efefef]">{footer}</div>}
    </div>
  )
}

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="mb-[14px] block">
      <span className="block text-[10px] font-bold leading-3">
        {label}
        {required && <span className="text-[#e57373]"> *</span>}
      </span>
      {children}
    </label>
  )
}

const fieldClass = "mt-[6px] block w-full border-b border-[#d9d9d9] bg-transparent pb-[6px] text-[13px] font-semibold outline-none focus:border-[#4f71dc]"

function Robot({ text, overlay }: { text: string; overlay?: boolean }) {
  return (
    <div className={`flex flex-col items-center ${overlay ? "pb-[56px] pt-[40px]" : "pb-[40px] pt-[70px]"} text-[#666]`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[150px]" />
      <span className={overlay ? "-mt-[40px]" : "mt-[20px]"}>{text}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

const TABS = ["Список товаров", "Серии", "Возврат", "Задействованные акции", "Логи"] as const
type DetailTab = (typeof TABS)[number]

export function OrderDetailCard({
  order,
  onUpdate,
  refreshOrder,
  onNavigate,
  onNotify,
}: {
  order: Order
  onUpdate: (id: number, patch: Partial<Order>) => void
  refreshOrder: (id: number) => void
  onNavigate: (href: string) => void
  onNotify: (message: string) => void
}) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<DetailTab>("Список товаров")
  const [menu, setMenu] = useState<null | "status" | "edit" | "discount" | "return">(null)
  const [dialog, setDialog] = useState<
    null | "status" | "invoice" | "manualDiscount" | "recalc" | "cancelDiscount" | "fullReturn" | "cancelOrder" | "logDetails"
  >(null)
  const [sheet, setSheet] = useState<null | "edit" | "quickEdit" | "quickReturn" | "print">(null)
  const [items, setItems] = useState<OrderLineItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [extras, setExtras] = useState<OrderExtras>({})
  const [statusTarget, setStatusTarget] = useState(order.status)

  const loadItems = useCallback(() => {
    setItemsLoading(true)
    return fetch(`/api/orders/${order.id}/items`)
      .then(async (response) => (response.ok ? ((await response.json()) as OrderLineItem[]) : []))
      .then(setItems)
      .finally(() => setItemsLoading(false))
  }, [order.id])

  useEffect(() => {
    loadItems()
    setExtras(readExtras(order.id))
    setTab("Список товаров")
    setMenu(null)
  }, [order.id, loadItems])

  const saveExtras = (next: OrderExtras) => {
    setExtras(next)
    writeExtras(order.id, next)
  }

  const addLog = (entry: Omit<OrderLog, "by" | "at" | "sum">) => {
    const log: OrderLog = { ...entry, by: "Admin Ritm", at: nowStamp(), sum: order.amount }
    saveExtras({ ...extras, logs: [log, ...(extras.logs ?? [])] })
  }

  const changeStatus = (status: string) => {
    if (status === order.status) return
    onUpdate(order.id, { status })
    addLog({ kind: "Обновленный", status, comment: `${t("Изменен статус:")} ${t(order.status)} - ${t(status)}` })
    onNotify(`${t("Статус заказа изменён:")} ${t(status)}`)
  }

  const logs: OrderLog[] = [
    ...(extras.logs ?? []),
    {
      kind: "Обновленный",
      status: order.status,
      by: "Admin Ritm",
      at: `${formatRuDate(new Date())}, 20:03`,
      sum: order.amount,
      comment: `${t("Изменен статус:")} ${t("Не подтвержден")} - ${t(order.status)}`,
    },
    { kind: "Создан", status: "Не подтвержден", by: "Admin Ritm", at: `${order.created}`, sum: order.amount },
  ]

  const invoiceActive = extras.invoice?.active ?? false
  const statusColor =
    order.status === "Доставлено" ? "text-[#81c784]" : order.status === "Отменен" ? "text-[#e57373]" : "text-[#f0ad4e]"
  const operativeDebt = order.negative ? order.balance : "12 047 000 SUM"

  const row = (label: string, value: ReactNode, valueClass = "") => (
    <li className="flex min-h-[25px] items-start justify-between leading-[25px]">
      <span>{label}</span>
      <span className={`text-right font-semibold ${valueClass}`}>{value}</span>
    </li>
  )

  const tabIndex = TABS.indexOf(tab)

  return (
    <div className="relative bg-white font-sans text-[13px] leading-normal text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
      {/* header */}
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[18px] font-semibold leading-[22.5px]">
          {t("Заказ №")}
          {order.id}
        </h2>
        <div className="flex items-center gap-[18px]">
          {tab === "Серии" && (
            <>
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                <path d={ICONS.clock} />
              </svg>
              <HeaderButton icon={ICONS.edit} label={t("Изменит серии")} onClick={() => onNotify(t("Серии для этого заказа не найдены"))} />
            </>
          )}
          <div className="relative">
            <HeaderButton icon={ICONS.edit} label={t("Изменить статус")} onClick={() => setMenu(menu === "status" ? null : "status")} />
            {menu === "status" && (
              <Menu onClose={() => setMenu(null)}>
                {STATUS_MENU.map((item) => (
                  <MenuItem
                    key={item.status}
                    icon={item.icon}
                    color={item.color}
                    label={t(item.label)}
                    onClick={() => {
                      setMenu(null)
                      setStatusTarget(item.status)
                      setDialog("status")
                    }}
                  />
                ))}
              </Menu>
            )}
          </div>
          <div className="relative">
            <HeaderButton icon={ICONS.edit} label={t("Изменить")} onClick={() => setMenu(menu === "edit" ? null : "edit")} />
            {menu === "edit" && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem icon={ICONS.edit} label={t("Изменить")} onClick={() => (setMenu(null), setSheet("edit"))} />
                <MenuItem icon={ICONS.edit} label={t("Быстрая правка")} onClick={() => (setMenu(null), setSheet("quickEdit"))} />
                <MenuItem icon={ICONS.article} label={t("Изменить детали счет фактуры")} onClick={() => (setMenu(null), setDialog("invoice"))} />
              </Menu>
            )}
          </div>
          <div className="relative">
            <HeaderButton icon={ICONS.discount} label={t("Скидка")} onClick={() => setMenu(menu === "discount" ? null : "discount")} />
            {menu === "discount" && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem icon={ICONS.discount} label={t("Скидка")} onClick={() => (setMenu(null), setDialog("manualDiscount"))} />
                <MenuItem icon={ICONS.discount} label={t("Частичная скидка")} onClick={() => (setMenu(null), setSheet("quickEdit"))} />
                <MenuItem icon={ICONS.discount} label={t("Ручная скидка")} onClick={() => (setMenu(null), setDialog("manualDiscount"))} />
                <MenuItem icon={ICONS.sync} label={t("Пересчитать")} onClick={() => (setMenu(null), setDialog("recalc"))} />
                <MenuItem icon={ICONS.trash} label={t("Отменить скидки")} onClick={() => (setMenu(null), setDialog("cancelDiscount"))} />
              </Menu>
            )}
          </div>
          <div className="relative">
            <HeaderButton icon={ICONS.undo} label={t("Возврат")} onClick={() => setMenu(menu === "return" ? null : "return")} />
            {menu === "return" && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem icon={ICONS.money} label={t("Полный возврат")} onClick={() => (setMenu(null), setDialog("fullReturn"))} />
                <MenuItem icon={ICONS.edit} label={t("Быстрый возврат")} onClick={() => (setMenu(null), setSheet("quickReturn"))} />
                <MenuItem
                  icon={ICONS.undo}
                  label={t("Частичный возврат")}
                  onClick={() => (setMenu(null), onNavigate(`/analytics/returns?o=${order.id}&openCreateDialog=true`))}
                />
              </Menu>
            )}
          </div>
          <HeaderButton icon={ICONS.print} label={t("Распечатать")} onClick={() => setSheet("print")} />
          <button
            type="button"
            title={t("Отменить")}
            aria-label={t("Отменить")}
            onClick={() => setDialog("cancelOrder")}
            className="-ml-2 flex h-12 w-12 items-center justify-center"
          >
            <Mi d={ICONS.trash} className="h-5 w-5 fill-black/30 hover:fill-black/60" />
          </button>
        </div>
      </div>

      {/* info columns */}
      <div className="flex border-b border-[#efefef] px-[15px]">
        <div className="min-h-[320px] w-1/3 border-r border-[#efefef] p-[15px]">
          <ul>
            {row(
              `${t("Клиент")}:`,
              <button type="button" onClick={() => onNavigate(`/clients?openClient=${encodeURIComponent(order.client)}`)} className="font-semibold text-[#5869f0] hover:underline">
                {order.client}
              </button>,
            )}
            {row(`${t("Транспорт")}:`, t("Не указан"))}
            {row(`${t("Филиал")}:`, order.zone || "ddr")}
            {row(`${t("Склад")}:`, "toshkent")}
            {row(`${t("Договор")}:`, extras.invoice?.contract || t("Не указан"))}
            {row(`${t("Счет фактура")}:`, invoiceActive ? t("Активный") : t("Не активный"), invoiceActive ? "text-[#81c784]" : "text-[#e57373]")}
            {row(`${t("Номер счет фактура")}:`, extras.invoice?.number || t("Не указан"))}
            {row(`${t("Дата счет фактуры")}:`, extras.invoice?.date ? fromInputDate(extras.invoice.date) : t("Не указан"))}
          </ul>
        </div>
        <div className="min-h-[320px] w-1/3 border-r border-[#efefef] p-[15px]">
          <ul>
            {row(`${t("Прайс-лист")}:`, "donalik")}
            {row(`${t("Организация")}:`, order.product)}
            {row(`${t("Дата окончательной оплаты")}:`, order.delivery)}
            {row(`${t("Тип оплаты")}:`, t("Перечисление"))}
            {row(t("Общая стоимость"), order.amount)}
            {order.discount && row(t("Скидка"), order.discount, "text-[#278549]")}
            {row(`${t("Оплачено")}:`, "0 SUM")}
            {row(`${t("Остаток")}:`, order.balance, order.negative ? "text-[#e57373]" : "text-[#e57373]")}
            <li className="flex min-h-[25px] items-center justify-between font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#4f71dc]" />
                {t("Оперативный долг клиента")}:
              </span>
              <span className={order.negative ? "text-[#e57373]" : "text-[#81c784]"}>{operativeDebt}</span>
            </li>
            <li className="flex min-h-[25px] items-center justify-between font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#4f71dc]" />
                {t("Фактический долг клиента")}:
              </span>
              <span className="text-[#81c784]">{order.negative ? order.balance : "12 048 000 SUM"}</span>
            </li>
          </ul>
        </div>
        <div className="min-h-[320px] w-1/3 px-[15px] pb-5 pt-[15px]">
          <ul>
            {row(`${t("Создал")}:`, order.agent)}
            {row(`${t("Доставщик")}:`, order.agent)}
            {row(`${t("Экспедитор")}:`, t("Не указано"))}
            {row(t("Дата создания"), order.created)}
            {row(`${t("Дата реализации")}:`, order.status === "Доставлено" ? order.delivery : t("Не реализовано"))}
            {row(`${t("Текущий статус")}:`, t(order.status === "Доставлено" ? "Доставлен" : order.status), statusColor)}
            {row(`${t("Тип передачи")}:`, t("Доставка"))}
            {row(`${t("Дата доставки")}:`, order.delivery)}
            {row(`${t("Тип сделки")}:`, order.status === "Доставлено" ? t("Стандартная") : t("Консигнация"))}
          </ul>
          <div>
            <b className="block leading-[25px] text-[#e57373]">{t("У этого клиента остаток, требуется перасчет")}</b>
            <button
              type="button"
              onClick={() => onNavigate("/analytics/client-debts")}
              className="mt-[5px] flex h-[30px] w-full items-center justify-center rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95"
            >
              {t("Пересчитать")}
            </button>
          </div>
        </div>
      </div>

      {/* tabs */}
      <div className="px-[30px] pb-5">
        <div className="relative grid grid-cols-5 border-b border-[#f2f5f8]">
          {TABS.map((label) => (
            <button key={label} type="button" onClick={() => setTab(label)} className="h-12 text-center text-[13px] font-medium text-black">
              {t(label)}
            </button>
          ))}
          <span className="absolute -bottom-[1px] left-0 h-[2px] w-1/5 bg-[#4f71dc] transition-transform duration-300" style={{ transform: `translateX(${tabIndex * 100}%)` }} />
        </div>

        {tab === "Список товаров" && (
          <ItemsTable
            orderId={order.id}
            items={items}
            loading={itemsLoading}
            reload={() => {
              loadItems()
              refreshOrder(order.id)
            }}
          />
        )}
        {tab === "Серии" && <Robot text={t("По вашему запросу ничего не найдено")} />}
        {tab === "Возврат" && <Robot overlay text={t("В данном заказе нет возвратов")} />}
        {tab === "Задействованные акции" && <Robot overlay text={t("Для этого заказа нет акций")} />}
        {tab === "Логи" && (
          <div className="pt-[10px]">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDialog("logDetails")}
                className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white"
              >
                {t("Детали изменений заказа")}
              </button>
            </div>
            <div className="mt-5 space-y-[20px]">
              {logs.map((log, index) => (
                <div key={index} className="rounded-[10px] border border-[#e6e6e6] bg-[#fafafa] px-5 py-[18px]">
                  <div className="flex items-center gap-5">
                    <span className="flex items-center gap-2">
                      <b>{t("Заказ")}:</b>
                      <span className={`rounded-full border px-[10px] py-[2px] ${log.kind === "Создан" ? "border-[#48a34b] text-[#48a34b]" : "border-[#4fa8f0] text-[#4fa8f0]"}`}>
                        {t(log.kind)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <b>{t("Статус")}:</b>
                      <StatusIcon status={log.status} />
                      {t(log.status === "Доставлено" ? "Доставлен" : log.status)}
                    </span>
                    <span className="ml-auto flex gap-5">
                      <span>
                        <b>{t("Кем")}:</b> {log.by}
                      </span>
                      <span>
                        <b>{t("Когда")}:</b> {log.at}
                      </span>
                      <span>
                        <b>{t("Сумма")}:</b> {log.sum}
                      </span>
                    </span>
                  </div>
                  {log.comment && (
                    <p className="mt-4">
                      <b>{t("Комментарий")}:</b> {log.comment}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* dialogs */}
      {dialog === "status" && (
        <StatusDialog
          orderId={order.id}
          initial={statusTarget}
          onClose={() => setDialog(null)}
          onApply={(status, deliveryDate) => {
            setDialog(null)
            if (deliveryDate) onUpdate(order.id, { status, delivery: fromInputDate(deliveryDate) })
            else changeStatus(status)
            if (deliveryDate) addLog({ kind: "Обновленный", status, comment: `${t("Изменен статус:")} ${t(order.status)} - ${t(status)}` })
          }}
        />
      )}
      {dialog === "invoice" && (
        <InvoiceDialog
          initial={extras.invoice}
          onClose={() => setDialog(null)}
          onSave={(invoice) => {
            saveExtras({ ...extras, invoice })
            setDialog(null)
            onNotify(t("Детали счет фактуры сохранены"))
          }}
        />
      )}
      {dialog === "manualDiscount" && (
        <ManualDiscountDialog
          onClose={() => setDialog(null)}
          onApply={async (percent) => {
            await Promise.all(
              items.map((item) =>
                fetch(`/api/orders/${order.id}/items/${item.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: percent, currency: item.currency }),
                }),
              ),
            )
            onUpdate(order.id, { discount: `${percent}%` })
            addLog({ kind: "Обновленный", status: order.status, comment: `${t("Ручная скидка")}: ${percent}%` })
            setDialog(null)
            loadItems()
            refreshOrder(order.id)
          }}
        />
      )}
      {dialog === "recalc" && (
        <DialogShell
          title={t("Пересчитать скидочные акции")}
          onClose={() => setDialog(null)}
          action={t("Да")}
          onAction={() => {
            setDialog(null)
            refreshOrder(order.id)
            onNotify(t("Скидочные акции пересчитаны"))
          }}
        >
          <p className="pb-5 pt-1">{t("Подтверждение запроса")}</p>
          <div className="-mx-[30px] bg-[#f1f4f7] px-[30px] py-5">
            <b>{t("Выбранные заказы:")}</b> №{order.id}
          </div>
        </DialogShell>
      )}
      {dialog === "cancelDiscount" && (
        <DialogShell
          title={t("Подтверждение отмены")}
          onClose={() => setDialog(null)}
          action={t("Да")}
          onAction={async () => {
            await Promise.all(
              items.map((item) =>
                fetch(`/api/orders/${order.id}/items/${item.id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: 0, currency: item.currency }),
                }),
              ),
            )
            onUpdate(order.id, { discount: "" })
            addLog({ kind: "Обновленный", status: order.status, comment: t("Скидки отменены") })
            setDialog(null)
            loadItems()
            refreshOrder(order.id)
          }}
        >
          <p className="pb-5 pt-1">{t("Вы уверены что хотите отменить эти данные?")}</p>
          <div className="-mx-[30px] bg-[#f1f4f7] px-[30px] py-5 font-semibold">{t("Отменить скидку")}</div>
        </DialogShell>
      )}
      {dialog === "fullReturn" && (
        <FullReturnDialog
          orderId={order.id}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            addLog({ kind: "Обновленный", status: order.status, comment: t("Оформлен полный возврат") })
            setDialog(null)
            onNotify(t("Полный возврат оформлен"))
          }}
        />
      )}
      {dialog === "cancelOrder" && (
        <DialogShell
          title={t("Подтверждение отмены")}
          onClose={() => setDialog(null)}
          action={t("Да")}
          onAction={() => {
            setDialog(null)
            changeStatus("Отменен")
          }}
        >
          <p className="pb-5 pt-1">{t("Вы уверены что хотите отменить эти данные?")}</p>
          <div className="-mx-[30px] bg-[#f1f4f7] px-[30px] py-5 font-semibold">{t("Заказ №")}{order.id}</div>
        </DialogShell>
      )}
      {dialog === "logDetails" && (
        <DialogShell title={t("Детали изменений заказа")} onClose={() => setDialog(null)} action={t("Закрыть")} onAction={() => setDialog(null)}>
          <ul className="space-y-2">
            {logs.map((log, index) => (
              <li key={index}>
                <b>{log.at}</b> — {t(log.kind)}: {log.comment ?? t(log.status)}
              </li>
            ))}
          </ul>
        </DialogShell>
      )}

      {/* full-screen sheets */}
      {sheet === "edit" && (
        <EditOrderSheet
          order={order}
          items={items}
          onClose={() => setSheet(null)}
          reloadItems={() => {
            loadItems()
            refreshOrder(order.id)
          }}
          onQuickEdit={() => setSheet("quickEdit")}
          onSave={(patch) => {
            onUpdate(order.id, patch)
            addLog({ kind: "Обновленный", status: order.status, comment: t("Заказ изменён") })
            setSheet(null)
            onNotify(t("Заказ обновлён"))
          }}
        />
      )}
      {sheet === "quickEdit" && (
        <QuickEditSheet
          order={order}
          items={items}
          onClose={() => setSheet(null)}
          onSaved={() => {
            addLog({ kind: "Обновленный", status: order.status, comment: t("Быстрая правка") })
            setSheet(null)
            loadItems()
            refreshOrder(order.id)
            onNotify(t("Изменения сохранены"))
          }}
        />
      )}
      {sheet === "quickReturn" && (
        <QuickReturnSheet
          order={order}
          items={items}
          onClose={() => setSheet(null)}
          onSaved={() => {
            addLog({ kind: "Обновленный", status: order.status, comment: t("Оформлен быстрый возврат") })
            setSheet(null)
            onNotify(t("Возврат оформлен"))
          }}
        />
      )}
      {sheet === "print" && <PrintSheet order={order} items={items} onClose={() => setSheet(null)} />}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  const item = STATUS_MENU.find((entry) => entry.status === status) ?? STATUS_MENU[0]
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path d={item.icon} fill={item.color} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Items table                                                         */
/* ------------------------------------------------------------------ */

function SortHead({ children }: { children: ReactNode }) {
  return (
    <th className="whitespace-nowrap bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold text-[#374557]">
      <span className="flex items-center">
        {children}
        <span className="ml-[5px] flex flex-col text-[#888]">
          <ChevronDown className="-mb-[5px] h-[15px] w-[15px] rotate-180" />
          <ChevronDown className="-mt-[5px] h-[15px] w-[15px]" />
        </span>
      </span>
    </th>
  )
}

function ItemsTable({ orderId, items, loading, reload }: { orderId: number; items: OrderLineItem[]; loading: boolean; reload: () => void }) {
  const { t } = useLanguage()
  const [addOpen, setAddOpen] = useState(false)
  const [productName, setProductName] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [unit, setUnit] = useState("шт.")
  const [unitPrice, setUnitPrice] = useState("")
  const [error, setError] = useState("")

  async function addItem() {
    setError("")
    const parsedQuantity = Number(quantity)
    const parsedPrice = Number(unitPrice)
    if (!productName.trim()) return setError(t("Наименование товара обязательно"))
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !Number.isFinite(parsedPrice) || parsedPrice < 0) return setError(t("Проверьте количество и цену"))
    const response = await fetch(`/api/orders/${orderId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: productName.trim(), unit: unit.trim() || "шт.", quantity: parsedQuantity, unitPrice: parsedPrice }),
    })
    if (!response.ok) return setError(t("Не удалось добавить товар"))
    setProductName("")
    setQuantity("1")
    setUnitPrice("")
    setAddOpen(false)
    reload()
  }

  async function removeItem(itemId: number) {
    const response = await fetch(`/api/orders/${orderId}/items/${itemId}`, { method: "DELETE" })
    if (response.ok) reload()
  }

  const totals = items.reduce(
    (sum, item) => ({
      quantity: sum.quantity + item.quantity,
      total: sum.total + item.lineTotal,
      discount: sum.discount + item.quantity * item.unitPrice - item.lineTotal,
    }),
    { quantity: 0, total: 0, discount: 0 },
  )
  const unitLabel = items[0]?.unit ?? "dona"

  const cell = "border-b border-r border-[#efefef] px-[17.5px] py-[10px] align-middle"

  return (
    <div className="border-l border-[#efefef]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-[50px] bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold text-[#374557]">№</th>
            <SortHead>{t("Товар")}</SortHead>
            <SortHead>{t("Количество")}</SortHead>
            <SortHead>{t("Блок")}</SortHead>
            <SortHead>{t("Кг.")}</SortHead>
            <SortHead>{t("Возврат")}</SortHead>
            <SortHead>{`${t("Цена")} SUM`}</SortHead>
            <SortHead>{`${t("Сумма")} SUM`}</SortHead>
            <SortHead>{`${t("Скидка")} (SUM)`}</SortHead>
            <th className="w-10 bg-[#f0f4f9]" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={10} className="p-6 text-center text-[#888]">
                {t("Загрузка...")}
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={10} className="p-6 text-center text-[#888]">
                {t("Товары не добавлены")}
              </td>
            </tr>
          ) : (
            items.map((item, index) => (
              <tr key={item.id}>
                <td className={cell}>{index + 1}</td>
                <td className={cell}>
                  {item.productName}
                  <span className="block text-[#4f71dc]">{1000 + item.id}</span>
                </td>
                <td className={cell}>
                  {formatNumber(item.quantity)} {item.unit}
                </td>
                <td className={cell}>0</td>
                <td className={cell}>0</td>
                <td className={cell}>0 {item.unit}</td>
                <td className={cell}>{formatNumber(item.unitPrice)}</td>
                <td className={cell}>{formatNumber(item.lineTotal)}</td>
                <td className={cell}>{formatNumber(item.quantity * item.unitPrice - item.lineTotal)}</td>
                <td className="border-b border-r border-[#efefef] text-center">
                  <button type="button" onClick={() => removeItem(item.id)} aria-label={t("Удалить")} className="text-[#e57373] hover:text-red-700">
                    <X className="mx-auto h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
          {!loading && items.length > 0 && (
            <tr className="text-[16px] font-semibold">
              <td colSpan={2} className="border-b border-r border-[#efefef] px-[17.5px] py-[14px]">
                {t("Итого")}:
              </td>
              <td className="border-b border-r border-[#efefef] px-[17.5px] py-[14px]">
                {formatNumber(totals.quantity)} {unitLabel}
              </td>
              <td className="border-b border-r border-[#efefef]" />
              <td className="border-b border-r border-[#efefef] px-[17.5px]">0</td>
              <td className="border-b border-r border-[#efefef] px-[17.5px]">0 {unitLabel}</td>
              <td className="border-b border-r border-[#efefef]" />
              <td className="border-b border-r border-[#efefef] px-[17.5px]">{formatNumber(totals.total)}</td>
              <td className="border-b border-r border-[#efefef] px-[17.5px]">{formatNumber(totals.discount)}</td>
              <td className="border-b border-r border-[#efefef]" />
            </tr>
          )}
        </tbody>
      </table>

      <div className="pt-4">
        {addOpen ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[#888]">
              {t("Товар")}
              <input value={productName} onChange={(event) => setProductName(event.target.value)} className="mt-1 block w-48 rounded border px-2 py-1.5 text-sm" autoFocus />
            </label>
            <label className="text-xs text-[#888]">
              {t("Количество")}
              <input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 block w-24 rounded border px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-[#888]">
              {t("Ед. измерения")}
              <input value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1 block w-20 rounded border px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-[#888]">
              {t("Цена")}
              <input type="number" min="0" step="any" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="mt-1 block w-28 rounded border px-2 py-1.5 text-sm" />
            </label>
            <button type="button" onClick={addItem} className="rounded bg-[#4f71dc] px-4 py-1.5 text-sm font-semibold text-white">
              {t("Добавить")}
            </button>
            <button type="button" onClick={() => setAddOpen(false)} className="rounded border px-4 py-1.5 text-sm">
              {t("Отмена")}
            </button>
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>
        ) : (
          <button type="button" onClick={() => setAddOpen(true)} className="text-[13px] font-medium text-[#4f71dc]">
            + {t("Добавить товар")}
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

function StatusDialog({
  orderId,
  initial,
  onClose,
  onApply,
}: {
  orderId: number
  initial: string
  onClose: () => void
  onApply: (status: string, deliveryDate?: string) => void
}) {
  const { t } = useLanguage()
  const [status, setStatus] = useState(initial)
  const [changeDelivery, setChangeDelivery] = useState(false)
  const [changeTransfer, setChangeTransfer] = useState(false)
  const [date, setDate] = useState(toInputDate(""))
  return (
    <DialogShell title={t("Изменение")} onClose={onClose} action={t("Изменить")} onAction={() => onApply(status, changeDelivery ? date : undefined)}>
      <p className="font-semibold">
        {t("Заказ №")} {orderId}
      </p>
      <Field label={t("Статус")}>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
          {ORDER_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {t(value === "Доставлено" ? "Доставлен" : value)}
            </option>
          ))}
        </select>
      </Field>
      <label className="mt-5 flex items-center gap-3 font-semibold">
        <input type="checkbox" checked={changeDelivery} onChange={(event) => setChangeDelivery(event.target.checked)} className="h-4 w-4" />
        {t("Изменить дата доставки")}
      </label>
      {changeDelivery && <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${fieldClass} mb-2`} />}
      <label className="mt-5 flex items-center gap-3 font-semibold">
        <input type="checkbox" checked={changeTransfer} onChange={(event) => setChangeTransfer(event.target.checked)} className="h-4 w-4" />
        {t("Изменить дату передачи")}
      </label>
    </DialogShell>
  )
}

function InvoiceDialog({ initial, onClose, onSave }: { initial?: InvoiceDetails; onClose: () => void; onSave: (value: InvoiceDetails) => void }) {
  const { t } = useLanguage()
  const [number, setNumber] = useState(initial?.number ?? "")
  const [date, setDate] = useState(initial?.date ?? "")
  const [contract, setContract] = useState(initial?.contract ?? "")
  const [active, setActive] = useState(initial?.active ?? false)
  return (
    <DialogShell title={t("Изменить детали счет фактуры")} onClose={onClose} action={t("Сохранить")} onAction={() => onSave({ number: number.trim(), date, contract, active })}>
      <Field label={t("Номер счет фактуры")}>
        <input value={number} onChange={(event) => setNumber(event.target.value)} className={fieldClass} />
      </Field>
      <Field label={t("Дата счет фактуры")}>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
      </Field>
      <Field label={t("Договор")}>
        <select value={contract} onChange={(event) => setContract(event.target.value)} className={fieldClass}>
          <option value="">{t("Не указан")}</option>
          <option value="Договор №1">Договор №1</option>
          <option value="Договор №2">Договор №2</option>
        </select>
      </Field>
      <label className="mt-4 flex items-center gap-3 font-semibold">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-4 w-4" />
        {t("Активная счет фактура")}
      </label>
    </DialogShell>
  )
}

function ManualDiscountDialog({ onClose, onApply }: { onClose: () => void; onApply: (percent: number) => void }) {
  const { t } = useLanguage()
  const [percent, setPercent] = useState("")
  return (
    <DialogShell title={t("Ручная скидка")} onClose={onClose} action={t("Применить")} disabled={!percent} onAction={() => onApply(Number(percent))}>
      <Field label={t("Акция")}>
        <select value={percent} onChange={(event) => setPercent(event.target.value)} className={fieldClass}>
          <option value="" />
          {[5, 10, 15, 20, 25, 30].map((value) => (
            <option key={value} value={value}>
              {t("Скидка")} {value}%
            </option>
          ))}
        </select>
      </Field>
    </DialogShell>
  )
}

function FullReturnDialog({ orderId, onClose, onConfirm }: { orderId: number; onClose: () => void; onConfirm: () => void }) {
  const { t } = useLanguage()
  const today = new Date()
  const [date, setDate] = useState(new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10))
  return (
    <DialogShell title={t("Выполнить")} onClose={onClose} action={t("Да")} onAction={onConfirm}>
      <p className="pb-5 pt-1">{t("Подтверждение запроса")}</p>
      <div className="-mx-[30px] bg-[#f1f4f7] px-[30px] py-5">
        <p className="font-semibold">{t("Вы действительно хотите сделать полный возврат ?")}</p>
        <p className="font-semibold">
          {t("Заказ №")} {orderId}
        </p>
        <Field label={t("Дата")}>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
        </Field>
      </div>
    </DialogShell>
  )
}

/* ------------------------------------------------------------------ */
/* Full screen sheets                                                  */
/* ------------------------------------------------------------------ */

function GreenButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="h-9 rounded-[3px] bg-[#71ce87] px-5 text-[12px] font-semibold uppercase text-white disabled:opacity-50">
      {children}
    </button>
  )
}

function EditOrderSheet({
  order,
  items,
  onClose,
  onSave,
  reloadItems,
  onQuickEdit,
}: {
  order: Order
  items: OrderLineItem[]
  onClose: () => void
  onSave: (patch: Partial<Order>) => void
  reloadItems: () => void
  onQuickEdit: () => void
}) {
  const { t } = useLanguage()
  const [created, setCreated] = useState(toInputDate(order.created))
  const [client, setClient] = useState(order.client)
  const [paymentType, setPaymentType] = useState("Перечисление")
  const [prize, setPrize] = useState(false)
  const [currency, setCurrency] = useState("SUM")
  const [priceList, setPriceList] = useState("donalik")
  const [agent, setAgent] = useState(order.agent)
  const [payUntil, setPayUntil] = useState(toInputDate(order.delivery))
  const [deal, setDeal] = useState<"standard" | "consignment">("standard")
  const [warehouse, setWarehouse] = useState("toshkent")
  const [deliveryType, setDeliveryType] = useState("Доставка")
  const [deliverer, setDeliverer] = useState(order.agent)
  const [deliveryDate, setDeliveryDate] = useState(toInputDate(order.delivery))
  const [confirmed, setConfirmed] = useState(true)

  async function removeItem(itemId: number) {
    const response = await fetch(`/api/orders/${order.id}/items/${itemId}`, { method: "DELETE" })
    if (response.ok) reloadItems()
  }

  return (
    <SheetShell
      title={t("Изменение заказа")}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3 px-[30px] py-3">
          <GreenButton
            onClick={() =>
              onSave({
                client: client.trim() || order.client,
                agent: agent.trim() || order.agent,
                delivery: fromInputDate(deliveryDate),
                status: confirmed ? (order.status === "Не подтвержден" ? "Есть на складе" : order.status) : "Не подтвержден",
              })
            }
          >
            {t("Сохранить")}
          </GreenButton>
        </div>
      }
    >
      <div className="flex min-h-full">
        <div className="w-[280px] shrink-0 overflow-auto border-r border-[#efefef] px-[30px] pb-6 pt-[22px]">
          <div className="mb-[2px] flex items-center justify-between">
            <b className="text-[13px]">{t("Выбор клиента")}</b>
            <span className="text-[13px] text-[#4f71dc]">+ {t("добавить")}</span>
          </div>
          <Field label={t("Дата создания")} required>
            <input type="date" value={created} onChange={(event) => setCreated(event.target.value)} className={fieldClass} />
          </Field>
          <Field label={t("Название клиента")} required>
            <input value={client} onChange={(event) => setClient(event.target.value)} className={fieldClass} />
          </Field>
          <b className="mb-3 mt-6 block text-[13px]">{t("Оплата")}</b>
          <label className="mb-4 flex items-center gap-3 font-semibold">
            <input type="checkbox" checked={prize} onChange={(event) => setPrize(event.target.checked)} className="h-4 w-4" />
            {t("Призовой заказ за балл")}
          </label>
          <Field label={t("Тип оплаты")}>
            <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)} className={fieldClass}>
              {["Перечисление", "Наличные", "Банковский счет", "Терминал"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Валюта")} required>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={fieldClass}>
              {["SUM", "USD", "EUR"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Прайс лист")} required>
            <select value={priceList} onChange={(event) => setPriceList(event.target.value)} className={fieldClass}>
              {["donalik", "optom"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Агент")} required>
            <input value={agent} onChange={(event) => setAgent(event.target.value)} className={fieldClass} />
          </Field>
          <Field label={t("Дата окончательной оплаты")} required>
            <input type="date" value={payUntil} onChange={(event) => setPayUntil(event.target.value)} className={fieldClass} />
          </Field>
          <b className="mb-3 mt-6 block text-[13px]">{t("Условия договора")}</b>
          {(["standard", "consignment"] as const).map((value) => (
            <label key={value} className="mb-3 flex items-center gap-3">
              <input type="radio" name="deal" checked={deal === value} onChange={() => setDeal(value)} className="h-4 w-4" />
              {value === "standard" ? t("Стандартная") : t("Консигнация")}
            </label>
          ))}
          <Field label={t("Склад")} required>
            <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} className={fieldClass}>
              {["toshkent", "Andijon skladi"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <b className="mb-1 mt-6 block text-[13px]">{t("Условия доставки")}</b>
          <Field label={t("Тип доставки")} required>
            <select value={deliveryType} onChange={(event) => setDeliveryType(event.target.value)} className={fieldClass}>
              {["Доставка", "Самовывоз"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Доставщик")}>
            <input value={deliverer} onChange={(event) => setDeliverer(event.target.value)} className={fieldClass} />
          </Field>
          <Field label={t("Дата доставки")}>
            <input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} className={fieldClass} />
          </Field>
          <label className="mt-2 flex items-center gap-3 font-semibold">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="h-4 w-4" />
            {t("Подтвержденный")}
          </label>
        </div>
        <div className="min-w-0 flex-1 px-[30px] pt-[14px]">
          <div className="border-b-2 border-[#4f71dc] pb-[14px] text-center text-[13px] font-medium">{t("Товары")}</div>
          <div className="flex items-center justify-between pt-8 text-[13px]">
            <b>{t("Список товаров")}</b>
            <span className="flex gap-8 text-[#4f71dc]">
              <span>{t("добавить из списка")}</span>
              <span>{t("импортировать с excel")}</span>
            </span>
          </div>
          <table className="mt-8 w-full text-left">
            <thead>
              <tr className="font-semibold">
                <th className="px-[5px] py-2">{t("Наименование")}</th>
                <th className="py-2">{t("Кол-во")}</th>
                <th className="py-2">{t("На складе")}</th>
                <th className="py-2">{t("Цена")}(SUM)</th>
                <th className="py-2">{t("Всего")}(SUM)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id}>
                  <td className="px-[5px] py-4">
                    <b className="mr-2">{index + 1}.</b>
                    {item.productName}
                  </td>
                  <td>
                    {formatNumber(item.quantity)} {item.unit}
                  </td>
                  <td>209 {item.unit}</td>
                  <td>{formatNumber(item.unitPrice)}</td>
                  <td>{formatNumber(item.lineTotal)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button type="button" onClick={onQuickEdit} aria-label={t("Изменить")} className="mr-5">
                      <Mi d={ICONS.edit} className="h-5 w-5 fill-[#666]" />
                    </button>
                    <button type="button" onClick={() => removeItem(item.id)} aria-label={t("Удалить")}>
                      <Mi d={ICONS.trash} className="h-5 w-5 fill-black/30" />
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#888]">
                    {t("Товары не добавлены")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </SheetShell>
  )
}

function QuickEditSheet({ order, items, onClose, onSaved }: { order: Order; items: OrderLineItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [lines, setLines] = useState(() => items.map((item) => ({ id: item.id, quantity: String(item.quantity), price: String(item.unitPrice), discount: item.discountPercent ? String(item.discountPercent) : "" })))
  const [confirmed, setConfirmed] = useState(true)
  const [saving, setSaving] = useState(false)

  const calc = useMemo(
    () =>
      items.map((item, index) => {
        const line = lines[index]
        const quantity = Number(line?.quantity) || 0
        const price = Number(line?.price) || 0
        const discount = Number(line?.discount) || 0
        const gross = quantity * price
        return { gross, net: gross * (1 - discount / 100), newPrice: price * (1 - discount / 100) }
      }),
    [items, lines],
  )
  const grossTotal = calc.reduce((sum, line) => sum + line.gross, 0)
  const netTotal = calc.reduce((sum, line) => sum + line.net, 0)

  const update = (index: number, patch: Partial<(typeof lines)[number]>) => setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await Promise.all(
        items.map((item, index) => {
          const line = lines[index]
          const quantity = Number(line.quantity)
          const price = Number(line.price)
          if (!(quantity > 0) || !(price >= 0)) return Promise.resolve()
          return fetch(`/api/orders/${order.id}/items/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productName: item.productName, unit: item.unit, quantity, unitPrice: price, discountPercent: Math.min(100, Math.max(0, Number(line.discount) || 0)), currency: item.currency }),
          })
        }),
      )
      onSaved()
    } finally {
      setSaving(false)
    }
  }, [items, lines, onSaved, order.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "Enter") void save()
      if (event.altKey && event.key === "1") setConfirmed((value) => !value)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [save])

  const inputClass = "w-full border-b border-[#d9d9d9] bg-transparent py-1 text-[13px] outline-none focus:border-[#374557]"

  return (
    <SheetShell
      title={`${t("Быстрая правка")} №${order.id}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between px-[10px] py-[10px]">
          <div className="flex gap-8 text-[13px]">
            <span>
              {t("Сумма без скидка")}: <b className="text-[16px] font-semibold text-[#0a9ddb]">{formatNumber(grossTotal)}</b> ,
            </span>
            <span>
              {t("Скидка / накидка")}: <b className="text-[16px] font-semibold text-[#0a9ddb]">{formatNumber(grossTotal - netTotal)}</b> ,
            </span>
            <span>
              {t("Итого")}: <b className="text-[16px] font-semibold text-[#0a9ddb]">{formatNumber(netTotal)}</b>
            </span>
          </div>
          <GreenButton onClick={save} disabled={saving}>
            {t("Сохранить")} (Alt + Enter)
          </GreenButton>
        </div>
      }
    >
      <div className="px-[30px] pt-10">
        <div className="flex items-center gap-10">
          <span>
            {t("Клиент")}: <b className="ml-6 font-semibold text-[#0a9ddb]">{order.client}</b>
          </span>
          <span>
            {t("Инициатор")}: <b className="ml-12 font-semibold">{order.agent}</b>
          </span>
          <label className="flex items-center gap-3 font-semibold">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="h-4 w-4" />
            {t("Подтвердить заказ")} (Alt + 1)
          </label>
        </div>
        <table className="mt-8 w-full text-left">
          <thead>
            <tr className="font-semibold">
              <th className="py-3">{t("Наименование")}</th>
              <th>{t("Группа")}</th>
              <th>{t("Изначальный кол-во")}</th>
              <th>{t("Кол-во")}</th>
              <th>{t("Цена")}</th>
              <th>{t("Сумма")}</th>
              <th>{t("Скидка")} (%)</th>
              <th>{t("Новая цена")}</th>
              <th className="text-right">{t("Новая сумма")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id} className="border-y border-dotted border-[#cfd8dc] bg-[#f1f4f7]">
                <td className="py-[14px]">{item.productName}</td>
                <td className="w-[100px] pr-6">
                  <b>0</b>
                </td>
                <td>{formatNumber(item.quantity)}</td>
                <td className="w-[110px] pr-6">
                  <input value={lines[index]?.quantity ?? ""} onChange={(event) => update(index, { quantity: event.target.value })} className={`${inputClass} font-semibold`} />
                </td>
                <td className="w-[110px] pr-6">
                  <input value={lines[index]?.price ?? ""} onChange={(event) => update(index, { price: event.target.value })} className={`${inputClass} font-bold`} />
                </td>
                <td>{formatNumber(calc[index]?.gross ?? 0)}</td>
                <td className="w-[110px] pr-6">
                  <input value={lines[index]?.discount ?? ""} onChange={(event) => update(index, { discount: event.target.value })} className={inputClass} />
                </td>
                <td>{formatNumber(calc[index]?.newPrice ?? 0)}</td>
                <td className="text-right">{formatNumber(calc[index]?.net ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-5 bg-[#f1f4f7] px-[10px] py-[10px] text-[#888]">{t("Бонусные товары")}</div>
      </div>
    </SheetShell>
  )
}

function QuickReturnSheet({ order, items, onClose, onSaved }: { order: Order; items: OrderLineItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [paymentType, setPaymentType] = useState("Банковский счет")
  const [warehouse, setWarehouse] = useState("")
  const [comment, setComment] = useState("")
  const [manualPrice, setManualPrice] = useState(false)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [error, setError] = useState("")

  const total = items.reduce((sum, item) => sum + (Number(qty[item.id]) || 0) * (Number(prices[item.id] ?? item.unitPrice) || 0), 0)

  return (
    <SheetShell
      title={`${t("Быстрый возврат")} №${order.id}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-4 px-[10px] py-[10px]">
          {error && <span className="text-[#e57373]">{error}</span>}
          <GreenButton
            onClick={() => {
              const invalid = items.some((item) => (Number(qty[item.id]) || 0) > item.quantity)
              if (invalid) return setError(t("Количество возврата больше доступного"))
              if (total <= 0) return setError(t("Укажите количество возврата"))
              onSaved()
            }}
          >
            {t("Сохранить")}
          </GreenButton>
        </div>
      }
    >
      <div className="px-[30px] pt-[30px]">
        <div className="flex items-end gap-4">
          <div className="w-[290px]">
            <Field label={t("Тип оплаты")}>
              <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)} className={fieldClass}>
                {["Банковский счет", "Наличные", "Перечисление"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="w-[290px]">
            <Field label={t("Склад")}>
              <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} className={fieldClass}>
                <option value="" />
                <option>toshkent</option>
                <option>Andijon skladi</option>
              </select>
            </Field>
          </div>
          <div className="w-[290px]">
            <Field label={t("Комментарий")}>
              <input value={comment} onChange={(event) => setComment(event.target.value)} className={fieldClass} />
            </Field>
          </div>
          <label className="mb-4 ml-auto flex items-center gap-3 font-semibold">
            <input type="checkbox" checked={manualPrice} onChange={(event) => setManualPrice(event.target.checked)} className="h-4 w-4" />
            {t("Изменение цены вручную")}
          </label>
        </div>
        <table className="mt-6 w-full text-left">
          <thead>
            <tr className="font-semibold">
              <th className="py-3">№</th>
              <th>{t("Наименование")}</th>
              <th>{t("По заказу")}</th>
              <th>{t("Доступно")}</th>
              <th>{t("Кол-во возврата")}</th>
              <th>{t("Цена")}</th>
              <th>{t("Сумма")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-y border-dotted border-[#9ec9e8] bg-[#f1f4f7]">
                <td className="py-[14px]">{1000 + item.id}</td>
                <td>{item.productName}</td>
                <td>{formatNumber(item.quantity)}</td>
                <td>{formatNumber(item.quantity)}</td>
                <td className="w-[200px] pr-6">
                  <input value={qty[item.id] ?? ""} onChange={(event) => setQty((current) => ({ ...current, [item.id]: event.target.value }))} className="w-full border-b-2 border-[#374557] bg-transparent py-1 outline-none" />
                </td>
                <td className="w-[200px] pr-6">
                  <input
                    disabled={!manualPrice}
                    value={prices[item.id] ?? String(item.unitPrice)}
                    onChange={(event) => setPrices((current) => ({ ...current, [item.id]: event.target.value }))}
                    className="w-full border-b border-dotted border-[#374557] bg-transparent py-1 font-bold outline-none"
                  />
                </td>
                <td>{formatNumber((Number(qty[item.id]) || 0) * (Number(prices[item.id] ?? item.unitPrice) || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SheetShell>
  )
}

function PrintSheet({ order, items, onClose }: { order: Order; items: OrderLineItem[]; onClose: () => void }) {
  const { t } = useLanguage()
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const qty = items.reduce((sum, item) => sum + item.quantity, 0)

  const block = (
    <div className="mb-6">
      <table className="w-full border-collapse text-center text-[13px]">
        <thead>
          <tr className="font-semibold">
            <th className="border border-black px-2 py-[3px]">№</th>
            <th className="border border-black px-2 py-[3px]">{t("Наименование")}</th>
            <th className="border border-black px-2 py-[3px]">{t("Блок")}</th>
            <th className="border border-black px-2 py-[3px]">{t("Количество")}</th>
            <th className="border border-black px-2 py-[3px]">{t("Сумма")} (SUM)</th>
            <th className="border border-black px-2 py-[3px]" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id}>
              <td className="border border-black px-2 py-[3px] font-bold">{index + 1}</td>
              <td className="border border-black px-2 py-[3px] font-bold">{item.productName}</td>
              <td className="border border-black px-2 py-[3px]">-</td>
              <td className="border border-black px-2 py-[3px]">
                {formatNumber(item.quantity)} {item.unit}
              </td>
              <td className="border border-black px-2 py-[3px]">{formatNumber(item.unitPrice)}</td>
              <td className="border border-black px-2 py-[3px]">{formatNumber(item.lineTotal)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={3} className="border border-black px-2 py-[3px] text-left">
              {t("Итого")}:
            </td>
            <td className="border border-black px-2 py-[3px]">{formatNumber(qty)}</td>
            <td className="border border-black px-2 py-[3px]" />
            <td className="border border-black px-2 py-[3px]">{formatNumber(total)} SUM</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-6 flex justify-between font-bold">
        <span>
          {t("Баланс на конец")}: {order.balance}
        </span>
        <span>
          {t("Организация")}: {order.product}
        </span>
      </div>
      <div className="mt-6 flex justify-between">
        <span>{t("Товар отпустил")} : ____________________</span>
        <span>{t("Подпись клиента")} : ____________________</span>
      </div>
    </div>
  )

  return (
    <div data-order-overlay className="fixed inset-0 z-[140] overflow-auto bg-white px-[30px] pb-10 pt-[22px] font-sans text-[13px] text-[#333]">
      <div className="relative mb-4 flex items-start justify-between">
        <h2 className="text-[18px] font-bold">
          {t("Заказ №")} {order.id}
        </h2>
        <h2 className="absolute left-1/2 -translate-x-1/2 text-[18px] font-semibold uppercase">HILOL</h2>
        <div className="flex items-start gap-5">
          <span className="text-[11px] font-semibold text-[#666]">
            {t("Добавлено")}: {order.created}
          </span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <Mi d={ICONS.close} className="h-6 w-6 fill-[#333]" />
          </button>
        </div>
      </div>
      <div className="mb-2 flex justify-between leading-[25px]">
        <div>
          <p>
            <b>{t("Агент")}:</b> {order.agent}
          </p>
          <p>
            <b>{t("Номер телефона агента")}:</b> None
          </p>
          <p>
            <b>{t("Супервайзер")}:</b> +998 50 079 54 23
          </p>
          <p>
            <b>{t("Комментарии")}:</b> None
          </p>
          <p>
            <b>{t("Баланс клиента до")}:</b> {order.balance}
          </p>
        </div>
        <div>
          <p>
            <b>{t("Клиент")}:</b> {order.client}
          </p>
          <p>
            <b>{t("Зона")}:</b> {order.zone || "—"}
          </p>
          <p>
            <b>{t("Телефон")}:</b> +998 90 000 00 00
          </p>
        </div>
      </div>
      {block}
      {block}
      <div className="mt-6 flex justify-center gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="h-9 rounded-[3px] bg-[#4f71dc] px-5 text-[12px] font-semibold uppercase text-white">
          {t("Распечатать")}
        </button>
      </div>
    </div>
  )
}
