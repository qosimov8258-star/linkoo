"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

import { EDITABLE_STATUSES, FINAL_STATUSES, ORDER_STATUSES, RELEASED_STATUSES, canChangeStatus, type Order } from "./orders-data"

// The order card (Продажи → Заказы → a row). Every figure comes from the
// server: the order (warehouse, payment terms, deliverer, invoice details),
// its lines, its change log (order_logs), what was paid / remains
// (/api/cash/orders/:id) and the client's operative / actual debt (client
// ledger). Overlays are portaled to <body> so the sticky page header never
// covers them.

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type OrderLineItem = {
  id: number
  productId: number | null
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  discountPercent: number
  currency: string
  lineTotal: number
}

type OrderLog = { id: number; kind: string; status: string; comment: string; amount: string; createdBy: string; createdAt: string }

type OrderDetail = Order & {
  clientDebt?: { operative: string; actual: string; operativeNegative: boolean; actualNegative: boolean } | null
}

type OrderDue = { currencies: Array<{ currency: string; total: number; paid: number; remaining: number }> }

type ProductOption = { id: number; name: string; unit?: string; canSell?: boolean; deleted?: boolean }

export const ORDER_STATUS_OPTIONS: string[] = [...ORDER_STATUSES]

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

function localIso(date: Date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

/** "2026-10-21", "21 окт. 2026" or "21 октября 2026 г." → "2026-10-21" (today when unreadable). */
function toInputDate(value: string | undefined) {
  const text = value ?? ""
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const match = /(\d{1,2})\s+([А-Яа-я]+)\.?\s+(\d{4})/.exec(text)
  const date = new Date()
  if (match) {
    const month = MONTH_PREFIXES.findIndex((prefix) => match[2].toLowerCase().startsWith(prefix))
    if (month >= 0) date.setFullYear(Number(match[3]), month, Number(match[1]))
  }
  return localIso(date)
}

/** "2026-10-21" → "21 окт. 2026"; other texts unchanged. */
function displayDay(value: string | undefined | null) {
  const text = value ?? ""
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return match ? `${match[3]} ${RU_SHORT_MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}` : text
}

/** UTC "YYYY-MM-DD HH:MM:SS" or ISO → local "21 окт. 2026, 14:05". */
function displayMoment(value: string | undefined | null) {
  if (!value) return ""
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return value
  return `${formatRuDate(date)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function formatNumber(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

const PAYMENT_TYPE_LABELS: Record<string, string> = { cash: "Наличные", bank: "Перечисление" }
const DEAL_TYPE_LABELS: Record<string, string> = { standard: "Стандартная", consignment: "Консигнация" }

type ApiResult<T> = { ok: true; body: T } | { ok: false; error: string }

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
    if (!response.ok || body === null) return { ok: false, error: body?.error ?? "Не удалось сохранить изменения на сервере" }
    return { ok: true, body }
  } catch {
    return { ok: false, error: "Не удалось сохранить изменения на сервере" }
  }
}

function usePortal() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (node: ReactNode) => (mounted ? createPortal(node, document.body) : null)
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

function HeaderButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Mi d={icon} className="mb-1 h-[18px] w-[18px] fill-white" />
      <span className="pl-2 pr-4">{label}</span>
    </button>
  )
}

function MenuItem({ icon, color = "#666", label, onClick, disabled }: { icon: string; color?: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-12 w-full items-center gap-[10px] pl-[22px] pr-6 text-left text-[13px] text-[#333] hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
    >
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
  error,
}: {
  title: string
  onClose: () => void
  action: string
  onAction: () => void
  children: ReactNode
  disabled?: boolean
  error?: string
}) {
  const portal = usePortal()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return portal(
    <div data-order-overlay className="fixed inset-0 z-[130] flex items-center justify-center bg-black/[0.54] p-4 font-sans text-[13px] text-[#333]">
      <div className="w-[500px] max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between border-b border-[#e8e8e8] px-[30px] py-[22px]">
          <h3 className="text-[13px] font-bold uppercase leading-4 tracking-[0.2px]">{title}</h3>
          <button type="button" aria-label="close" onClick={onClose}>
            <Mi d={ICONS.close} className="h-6 w-6 fill-[#333]" />
          </button>
        </div>
        <div className="min-h-[120px] px-[30px] py-5">{children}</div>
        <div className="flex items-center justify-end gap-4 border-t border-[#e8e8e8] px-[30px] py-[18px]">
          {error && <span className="mr-auto text-[#e57373]">{error}</span>}
          <button type="button" disabled={disabled} onClick={onAction} className="text-[13px] font-semibold uppercase text-[#0a9ddb] disabled:opacity-40">
            {action}
          </button>
        </div>
      </div>
    </div>,
  )
}

function SheetShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const portal = usePortal()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  // Portaled to <body>: inside the list's sticky wrapper the page header
  // (sticky, z-40) painted over the close button.
  return portal(
    <div data-order-overlay className="fixed inset-0 z-[120] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[59px] shrink-0 items-center justify-between border-b border-[#efefef] px-[30px]">
        <h3 className="text-[13px] font-bold uppercase leading-4">{title}</h3>
        <button type="button" aria-label="close" onClick={onClose} className="flex h-10 w-10 items-center justify-center">
          <Mi d={ICONS.close} className="h-6 w-6 fill-[#333]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-[#efefef]">{footer}</div>}
    </div>,
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

function useNames(url: string, pick: (row: Record<string, unknown>) => string) {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    void api<unknown>(url).then((result) => {
      if (cancelled || !result.ok) return
      const rows = Array.isArray(result.body) ? result.body : ((result.body as { results?: unknown[]; rows?: unknown[] }).results ?? (result.body as { rows?: unknown[] }).rows ?? [])
      setNames([...new Set((rows as Record<string, unknown>[]).map(pick).filter(Boolean))])
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])
  return names
}

const employeeName = (row: Record<string, unknown>) => `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim() || String(row.name ?? "")
const plainName = (row: Record<string, unknown>) => String(row.name ?? "")

function useSellableProducts() {
  const [products, setProducts] = useState<ProductOption[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void api<ProductOption[]>("/api/products").then((result) => {
      if (!cancelled) setProducts(result.ok ? result.body.filter((row) => row.canSell !== false && !row.deleted) : [])
    })
    return () => {
      cancelled = true
    }
  }, [])
  return products
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

const TABS = ["Список товаров", "Серии", "Возврат", "Задействованные акции", "Логи"] as const
type DetailTab = (typeof TABS)[number]

type ReturnRow = { id: number; returnDate: string; status: string; warehouse: string; amount: number; currency: string; itemCount?: number }

export function OrderDetailCard({
  order,
  onUpdate,
  refreshOrder,
  onNavigate,
  onNotify,
}: {
  order: Order
  onUpdate: (id: number, patch: Partial<Order>) => Promise<boolean> | void
  refreshOrder: (id: number) => void
  onNavigate: (href: string) => void
  onNotify: (message: string) => void
}) {
  const { t } = useLanguage()
  const portal = usePortal()
  const [tab, setTab] = useState<DetailTab>("Список товаров")
  const [menu, setMenu] = useState<null | "status" | "edit" | "discount" | "return">(null)
  const [dialog, setDialog] = useState<null | "status" | "invoice" | "manualDiscount" | "recalc" | "cancelDiscount" | "fullReturn" | "cancelOrder" | "logDetails">(null)
  const [sheet, setSheet] = useState<null | "edit" | "quickEdit" | "quickReturn" | "print">(null)
  const [items, setItems] = useState<OrderLineItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [logs, setLogs] = useState<OrderLog[]>([])
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [due, setDue] = useState<OrderDue | null>(null)
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [statusTarget, setStatusTarget] = useState(order.status)
  const [dialogError, setDialogError] = useState("")

  const loadItems = useCallback(() => {
    setItemsLoading(true)
    return api<OrderLineItem[]>(`/api/orders/${order.id}/items`)
      .then((result) => setItems(result.ok ? result.body : []))
      .finally(() => setItemsLoading(false))
  }, [order.id])

  const loadExtras = useCallback(() => {
    void api<OrderLog[]>(`/api/orders/${order.id}/logs`).then((result) => setLogs(result.ok ? result.body : []))
    void api<OrderDetail>(`/api/orders/${order.id}`).then((result) => setDetail(result.ok ? result.body : null))
    void api<OrderDue>(`/api/cash/orders/${order.id}`).then((result) => setDue(result.ok ? result.body : null))
    void api<{ rows: ReturnRow[] }>(`/api/client-returns?orderId=${order.id}`).then((result) => setReturns(result.ok ? result.body.rows : []))
  }, [order.id])

  useEffect(() => {
    void loadItems()
    loadExtras()
    setTab("Список товаров")
    setMenu(null)
  }, [order.id, loadItems, loadExtras])

  // The list row changes (status, totals…) → reload what depends on it.
  useEffect(() => {
    loadExtras()
  }, [order.status, order.amount, loadExtras])

  const reloadAll = () => {
    void loadItems()
    loadExtras()
    refreshOrder(order.id)
  }

  const patchOrder = async (patch: Partial<Order>, message?: string) => {
    const ok = await onUpdate(order.id, patch)
    if (ok !== false) {
      loadExtras()
      if (message) onNotify(message)
    }
    return ok !== false
  }

  const status = order.status
  const editable = !(ORDER_STATUSES as readonly string[]).includes(status) || EDITABLE_STATUSES.includes(status)
  const final = FINAL_STATUSES.includes(status)
  const released = RELEASED_STATUSES.includes(status)
  const currency = order.currency || "SUM"
  const statusColor = status === "Доставлено" ? "text-[#81c784]" : status === "Отменен" ? "text-[#e57373]" : "text-[#f0ad4e]"
  const debt = detail?.clientDebt ?? null
  const deliverer = order.deliveryMan || (order.clientDeliverer && order.clientDeliverer !== "Не указано" ? order.clientDeliverer : "")
  const dueLine = (pick: "paid" | "remaining") =>
    due?.currencies.length ? due.currencies.map((entry) => `${formatNumber(entry[pick])} ${entry.currency}`).join(", ") : `0 ${currency}`

  const row = (label: string, value: ReactNode, valueClass = "") => (
    <li className="flex min-h-[25px] items-start justify-between gap-3 leading-[25px]">
      <span>{label}</span>
      <span className={`text-right font-semibold ${valueClass}`}>{value}</span>
    </li>
  )

  const tabIndex = TABS.indexOf(tab)
  const allowedTargets = STATUS_MENU.filter((item) => item.status !== status && canChangeStatus(status, item.status))

  return (
    <div className="relative bg-white font-sans text-[13px] leading-normal text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
      {/* header */}
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[18px] font-semibold leading-[22.5px]">
          {t("Заказ №")}
          {order.id}
        </h2>
        <div className="flex items-center gap-[18px]">
          <div className="relative">
            <HeaderButton icon={ICONS.edit} label={t("Изменить статус")} disabled={!allowedTargets.length} onClick={() => setMenu(menu === "status" ? null : "status")} />
            {menu === "status" && (
              <Menu onClose={() => setMenu(null)}>
                {allowedTargets.map((item) => (
                  <MenuItem
                    key={item.status}
                    icon={item.icon}
                    color={item.color}
                    label={t(item.label)}
                    onClick={() => {
                      setMenu(null)
                      setStatusTarget(item.status)
                      setDialogError("")
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
                <MenuItem icon={ICONS.edit} label={t("Изменить")} disabled={final} onClick={() => (setMenu(null), setSheet("edit"))} />
                <MenuItem icon={ICONS.edit} label={t("Быстрая правка")} disabled={!editable || !items.length} onClick={() => (setMenu(null), setSheet("quickEdit"))} />
                <MenuItem icon={ICONS.article} label={t("Изменить детали счет фактуры")} onClick={() => (setMenu(null), setDialogError(""), setDialog("invoice"))} />
              </Menu>
            )}
          </div>
          <div className="relative">
            <HeaderButton icon={ICONS.discount} label={t("Скидка")} disabled={!editable || !items.length} onClick={() => setMenu(menu === "discount" ? null : "discount")} />
            {menu === "discount" && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem icon={ICONS.discount} label={t("Ручная скидка")} onClick={() => (setMenu(null), setDialogError(""), setDialog("manualDiscount"))} />
                <MenuItem icon={ICONS.discount} label={t("Частичная скидка")} onClick={() => (setMenu(null), setSheet("quickEdit"))} />
                <MenuItem icon={ICONS.sync} label={t("Пересчитать")} onClick={() => (setMenu(null), setDialog("recalc"))} />
                <MenuItem icon={ICONS.trash} label={t("Отменить скидки")} onClick={() => (setMenu(null), setDialogError(""), setDialog("cancelDiscount"))} />
              </Menu>
            )}
          </div>
          <div className="relative">
            <HeaderButton icon={ICONS.undo} label={t("Возврат")} disabled={!released} onClick={() => setMenu(menu === "return" ? null : "return")} />
            {menu === "return" && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem icon={ICONS.money} label={t("Полный возврат")} onClick={() => (setMenu(null), setDialogError(""), setDialog("fullReturn"))} />
                <MenuItem icon={ICONS.edit} label={t("Быстрый возврат")} onClick={() => (setMenu(null), setSheet("quickReturn"))} />
                <MenuItem icon={ICONS.undo} label={t("Частичный возврат")} onClick={() => (setMenu(null), onNavigate(`/analytics/returns?o=${order.id}&openCreateDialog=true`))} />
              </Menu>
            )}
          </div>
          <HeaderButton icon={ICONS.print} label={t("Распечатать")} onClick={() => setSheet("print")} />
          <button
            type="button"
            title={t("Отменить")}
            aria-label={t("Отменить")}
            disabled={!canChangeStatus(status, "Отменен") || status === "Отменен"}
            onClick={() => (setDialogError(""), setDialog("cancelOrder"))}
            className="-ml-2 flex h-12 w-12 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
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
            {row(`${t("Телефон")}:`, order.clientPhone || t("Не указан"))}
            {row(`${t("Филиал")}:`, order.clientBranch || t("Не указан"))}
            {row(`${t("Зона")}:`, order.zone || t("Не указана"))}
            {row(`${t("Склад")}:`, order.warehouse || t("Не указан"), order.warehouse ? "" : "text-[#e57373]")}
            {row(`${t("Договор")}:`, order.contract || t("Не указан"))}
            {row(`${t("Счет фактура")}:`, order.invoiceActive ? t("Активный") : t("Не активный"), order.invoiceActive ? "text-[#81c784]" : "text-[#e57373]")}
            {row(`${t("Номер счет фактура")}:`, order.invoiceNumber || t("Не указан"))}
            {row(`${t("Дата счет фактуры")}:`, order.invoiceDate ? displayDay(order.invoiceDate) : t("Не указан"))}
          </ul>
        </div>
        <div className="min-h-[320px] w-1/3 border-r border-[#efefef] p-[15px]">
          <ul>
            {row(`${t("Прайс-лист")}:`, order.priceList || t("Не указан"))}
            {row(`${t("Организация")}:`, order.organization || t("Не указана"))}
            {row(`${t("Дата окончательной оплаты")}:`, order.paymentDate ? displayDay(order.paymentDate) : t("Не указана"))}
            {row(`${t("Тип оплаты")}:`, order.paymentType ? t(PAYMENT_TYPE_LABELS[order.paymentType] ?? order.paymentType) : t("Не указан"))}
            {row(t("Общая стоимость"), order.amount)}
            {order.discount && row(t("Скидка"), order.discount, "text-[#278549]")}
            {row(`${t("Оплачено")}:`, due ? dueLine("paid") : "…", "text-[#278549]")}
            {row(`${t("Остаток")}:`, due ? dueLine("remaining") : "…", due?.currencies.some((entry) => entry.remaining > 0) ? "text-[#e57373]" : "text-[#81c784]")}
            <li className="flex min-h-[25px] items-center justify-between gap-3 font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#4f71dc]" />
                {t("Оперативный долг клиента")}:
              </span>
              <span className={`text-right ${debt?.operativeNegative ? "text-[#e57373]" : "text-[#81c784]"}`}>{debt ? debt.operative || "0" : "…"}</span>
            </li>
            <li className="flex min-h-[25px] items-center justify-between gap-3 font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#4f71dc]" />
                {t("Фактический долг клиента")}:
              </span>
              <span className={`text-right ${debt?.actualNegative ? "text-[#e57373]" : "text-[#81c784]"}`}>{debt ? debt.actual || "0" : "…"}</span>
            </li>
          </ul>
        </div>
        <div className="min-h-[320px] w-1/3 px-[15px] pb-5 pt-[15px]">
          <ul>
            {row(`${t("Создал")}:`, order.createdBy || t("Не указано"))}
            {row(`${t("Агент")}:`, order.agent || t("Не указано"))}
            {row(`${t("Доставщик")}:`, deliverer || t("Не указано"))}
            {row(t("Дата создания"), order.createdAt ? displayMoment(order.createdAt) : order.created)}
            {row(`${t("Дата реализации")}:`, order.shippedAt ? displayMoment(order.shippedAt) : t("Не реализовано"))}
            {row(`${t("Текущий статус")}:`, t(status === "Доставлено" ? "Доставлен" : status), statusColor)}
            {row(`${t("Тип передачи")}:`, order.deliveryType ? t(order.deliveryType) : t("Не указано"))}
            {row(`${t("Дата доставки")}:`, displayDay(order.delivery) || t("Не указана"))}
            {row(`${t("Тип сделки")}:`, order.dealType ? t(DEAL_TYPE_LABELS[order.dealType] ?? order.dealType) : t("Не указано"))}
            {order.comment && row(`${t("Комментарий")}:`, order.comment)}
          </ul>
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

        {tab === "Список товаров" && <ItemsTable orderId={order.id} items={items} loading={itemsLoading} editable={editable} currency={currency} reload={reloadAll} onNotify={onNotify} />}
        {tab === "Серии" && <Robot text={t("По вашему запросу ничего не найдено")} />}
        {tab === "Возврат" &&
          (returns.length ? (
            <table className="mt-4 w-full text-left">
              <thead>
                <tr className="font-semibold">
                  <th className="py-2">№</th>
                  <th>{t("Дата возврата")}</th>
                  <th>{t("Склад")}</th>
                  <th>{t("Статус")}</th>
                  <th className="text-right">{t("Сумма возврата")}</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((entry) => (
                  <tr key={entry.id} className="border-t border-dotted border-[#d6d6d6]">
                    <td className="py-2">
                      <button type="button" onClick={() => onNavigate(`/analytics/returns?r=${entry.id}`)} className="text-[#4f71dc] hover:underline">
                        {entry.id}
                      </button>
                    </td>
                    <td>{displayDay(entry.returnDate)}</td>
                    <td>{entry.warehouse}</td>
                    <td>{t(entry.status === "accepted" ? "Принят" : entry.status === "cancelled" ? "Отменен" : "Ожидает")}</td>
                    <td className="text-right">
                      {formatNumber(entry.amount)} {entry.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Robot overlay text={t("В данном заказе нет возвратов")} />
          ))}
        {tab === "Задействованные акции" && <Robot overlay text={t("Для этого заказа нет акций")} />}
        {tab === "Логи" && (
          <div className="pt-[10px]">
            <div className="flex justify-end">
              <button type="button" onClick={() => setDialog("logDetails")} className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white">
                {t("Детали изменений заказа")}
              </button>
            </div>
            {logs.length === 0 ? (
              <Robot overlay text={t("Изменений пока нет")} />
            ) : (
              <div className="mt-5 space-y-[20px]">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-[10px] border border-[#e6e6e6] bg-[#fafafa] px-5 py-[18px]">
                    <div className="flex flex-wrap items-center gap-5">
                      <span className="flex items-center gap-2">
                        <b>{t("Заказ")}:</b>
                        <span className={`rounded-full border px-[10px] py-[2px] ${log.kind === "Создан" ? "border-[#48a34b] text-[#48a34b]" : "border-[#4fa8f0] text-[#4fa8f0]"}`}>{t(log.kind)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <b>{t("Статус")}:</b>
                        <StatusIcon status={log.status} />
                        {t(log.status === "Доставлено" ? "Доставлен" : log.status)}
                      </span>
                      <span className="ml-auto flex flex-wrap gap-5">
                        <span>
                          <b>{t("Кем")}:</b> {log.createdBy || "—"}
                        </span>
                        <span>
                          <b>{t("Когда")}:</b> {displayMoment(log.createdAt)}
                        </span>
                        <span>
                          <b>{t("Сумма")}:</b> {log.amount}
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
            )}
          </div>
        )}
      </div>

      {/* dialogs */}
      {dialog === "status" && (
        <StatusDialog
          orderId={order.id}
          current={status}
          initial={statusTarget}
          delivery={order.delivery}
          error={dialogError}
          onClose={() => setDialog(null)}
          onApply={async (next, deliveryDate) => {
            const ok = await patchOrder(deliveryDate ? { status: next, delivery: deliveryDate } : { status: next }, `${t("Статус заказа изменён:")} ${t(next)}`)
            if (ok) setDialog(null)
          }}
        />
      )}
      {dialog === "invoice" && (
        <InvoiceDialog
          order={order}
          onClose={() => setDialog(null)}
          onSave={async (invoice) => {
            if (await patchOrder(invoice, t("Детали счет фактуры сохранены"))) setDialog(null)
          }}
        />
      )}
      {dialog === "manualDiscount" && (
        <ManualDiscountDialog
          error={dialogError}
          onClose={() => setDialog(null)}
          onApply={async (percent) => {
            const error = await putDiscounts(order.id, items, percent)
            if (error) return setDialogError(t(error))
            await patchOrder({ discount: `${percent}%` })
            setDialog(null)
            reloadAll()
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
            reloadAll()
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
          error={dialogError}
          onAction={async () => {
            const error = await putDiscounts(order.id, items, 0)
            if (error) return setDialogError(t(error))
            await patchOrder({ discount: "" })
            setDialog(null)
            reloadAll()
          }}
        >
          <p className="pb-5 pt-1">{t("Вы уверены что хотите отменить эти данные?")}</p>
          <div className="-mx-[30px] bg-[#f1f4f7] px-[30px] py-5 font-semibold">{t("Отменить скидку")}</div>
        </DialogShell>
      )}
      {dialog === "fullReturn" && (
        <FullReturnDialog
          order={order}
          error={dialogError}
          onClose={() => setDialog(null)}
          onConfirm={async (returnDate) => {
            const result = await api<{ id: number }>("/api/client-returns", {
              method: "POST",
              body: { clientId: order.clientId ?? undefined, client: order.clientId ? undefined : order.client, orderId: order.id, warehouse: order.warehouse || undefined, returnDate, full: true },
            })
            if (!result.ok) return setDialogError(t(result.error))
            setDialog(null)
            loadExtras()
            onNotify(`${t("Возврат оформлен")}: №${result.body.id}. ${t("Примите его на склад в разделе «Возвраты»")}`)
          }}
        />
      )}
      {dialog === "cancelOrder" && (
        <DialogShell
          title={t("Подтверждение отмены")}
          onClose={() => setDialog(null)}
          action={t("Да")}
          onAction={async () => {
            if (await patchOrder({ status: "Отменен" }, `${t("Статус заказа изменён:")} ${t("Отменен")}`)) setDialog(null)
          }}
        >
          <p className="pb-5 pt-1">{t("Вы уверены что хотите отменить эти данные?")}</p>
          <div className="-mx-[30px] bg-[#f1f4f7] px-[30px] py-5 font-semibold">
            {t("Заказ №")}
            {order.id}
          </div>
        </DialogShell>
      )}
      {dialog === "logDetails" && (
        <DialogShell title={t("Детали изменений заказа")} onClose={() => setDialog(null)} action={t("Закрыть")} onAction={() => setDialog(null)}>
          {logs.length ? (
            <ul className="space-y-2">
              {logs.map((log) => (
                <li key={log.id}>
                  <b>{displayMoment(log.createdAt)}</b> — {t(log.kind)}: {log.comment || t(log.status)} ({log.createdBy || "—"})
                </li>
              ))}
            </ul>
          ) : (
            <p>{t("Изменений пока нет")}</p>
          )}
        </DialogShell>
      )}

      {/* full-screen sheets */}
      {sheet === "edit" && (
        <EditOrderSheet
          order={order}
          items={items}
          editable={editable}
          onClose={() => setSheet(null)}
          reloadItems={reloadAll}
          onQuickEdit={() => setSheet("quickEdit")}
          onSave={async (patch) => {
            if (await patchOrder(patch, t("Заказ обновлён"))) setSheet(null)
          }}
        />
      )}
      {sheet === "quickEdit" && (
        <QuickEditSheet
          order={order}
          items={items}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null)
            reloadAll()
            onNotify(t("Изменения сохранены"))
          }}
        />
      )}
      {sheet === "quickReturn" && (
        <QuickReturnSheet
          order={order}
          onClose={() => setSheet(null)}
          onSaved={(id) => {
            setSheet(null)
            loadExtras()
            onNotify(`${t("Возврат оформлен")}: №${id}. ${t("Примите его на склад в разделе «Возвраты»")}`)
          }}
        />
      )}
      {sheet === "print" && portal(<PrintSheet order={order} items={items} debt={debt} onClose={() => setSheet(null)} />)}
    </div>
  )
}

/** Sets one discount on every line; returns the first server error, if any. */
async function putDiscounts(orderId: number, items: OrderLineItem[], percent: number): Promise<string | null> {
  for (const item of items) {
    const result = await api(`/api/orders/${orderId}/items/${item.id}`, {
      method: "PUT",
      body: { productId: item.productId ?? undefined, productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: percent, currency: item.currency },
    })
    if (!result.ok) return result.error
  }
  return null
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

function ItemsTable({
  orderId,
  items,
  loading,
  editable,
  currency,
  reload,
  onNotify,
}: {
  orderId: number
  items: OrderLineItem[]
  loading: boolean
  editable: boolean
  currency: string
  reload: () => void
  onNotify: (message: string) => void
}) {
  const { t } = useLanguage()
  const products = useSellableProducts()
  const [addOpen, setAddOpen] = useState(false)
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [unitPrice, setUnitPrice] = useState("")
  const [error, setError] = useState("")

  async function addItem() {
    setError("")
    const parsedQuantity = Number(quantity)
    const parsedPrice = Number(unitPrice)
    if (!productId) return setError(t("Выберите товар"))
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !Number.isFinite(parsedPrice) || parsedPrice < 0) return setError(t("Проверьте количество и цену"))
    const result = await api(`/api/orders/${orderId}/items`, { method: "POST", body: { productId: Number(productId), quantity: parsedQuantity, unitPrice: parsedPrice, currency } })
    if (!result.ok) return setError(t(result.error))
    setProductId("")
    setQuantity("1")
    setUnitPrice("")
    setAddOpen(false)
    reload()
  }

  async function removeItem(itemId: number) {
    const result = await api(`/api/orders/${orderId}/items/${itemId}`, { method: "DELETE" })
    if (!result.ok) return onNotify(t(result.error))
    reload()
  }

  const totals = items.reduce(
    (sum, item) => ({
      quantity: sum.quantity + item.quantity,
      total: sum.total + item.lineTotal,
      discount: sum.discount + item.quantity * item.unitPrice - item.lineTotal,
    }),
    { quantity: 0, total: 0, discount: 0 },
  )
  const unitLabel = items[0]?.unit ?? ""
  const cell = "border-b border-r border-[#efefef] px-[17.5px] py-[10px] align-middle"

  return (
    <div className="border-l border-[#efefef]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-[50px] bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold text-[#374557]">№</th>
            <SortHead>{t("Товар")}</SortHead>
            <SortHead>{t("Количество")}</SortHead>
            <SortHead>{`${t("Цена")} ${currency}`}</SortHead>
            <SortHead>{`${t("Сумма")} ${currency}`}</SortHead>
            <SortHead>{`${t("Скидка")} (${currency})`}</SortHead>
            <th className="w-10 bg-[#f0f4f9]" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={7} className="p-6 text-center text-[#888]">
                {t("Загрузка...")}
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-6 text-center text-[#888]">
                {t("Товары не добавлены")}
              </td>
            </tr>
          ) : (
            items.map((item, index) => (
              <tr key={item.id}>
                <td className={cell}>{index + 1}</td>
                <td className={cell}>{item.productName}</td>
                <td className={cell}>
                  {formatNumber(item.quantity)} {item.unit}
                </td>
                <td className={cell}>{formatNumber(item.unitPrice)}</td>
                <td className={cell}>{formatNumber(item.lineTotal)}</td>
                <td className={cell}>{formatNumber(item.quantity * item.unitPrice - item.lineTotal)}</td>
                <td className="border-b border-r border-[#efefef] text-center">
                  {editable && (
                    <button type="button" onClick={() => removeItem(item.id)} aria-label={t("Удалить")} className="text-[#e57373] hover:text-red-700">
                      <X className="mx-auto h-4 w-4" />
                    </button>
                  )}
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
              <td className="border-b border-r border-[#efefef] px-[17.5px]">{formatNumber(totals.total)}</td>
              <td className="border-b border-r border-[#efefef] px-[17.5px]">{formatNumber(totals.discount)}</td>
              <td className="border-b border-r border-[#efefef]" />
            </tr>
          )}
        </tbody>
      </table>

      <div className="pt-4">
        {!editable ? (
          <p className="text-[13px] text-[#888]">{t("Товары этого заказа изменить нельзя (заказ отгружен или отменен)")}</p>
        ) : addOpen ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[#888]">
              {t("Товар")}
              <select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 block w-64 rounded border px-2 py-1.5 text-sm" autoFocus>
                <option value="">{products ? t("Выберите товар") : t("Загрузка...")}</option>
                {(products ?? []).map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#888]">
              {t("Количество")}
              <input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 block w-24 rounded border px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-[#888]">
              {`${t("Цена")} (${currency})`}
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
  current,
  initial,
  delivery,
  error,
  onClose,
  onApply,
}: {
  orderId: number
  current: string
  initial: string
  delivery: string
  error?: string
  onClose: () => void
  onApply: (status: string, deliveryDate?: string) => void
}) {
  const { t } = useLanguage()
  const [status, setStatus] = useState(initial)
  const [changeDelivery, setChangeDelivery] = useState(false)
  const [date, setDate] = useState(toInputDate(delivery))
  const options = ORDER_STATUS_OPTIONS.filter((value) => value === current || canChangeStatus(current, value))
  return (
    <DialogShell title={t("Изменение")} onClose={onClose} action={t("Изменить")} error={error} disabled={status === current && !changeDelivery} onAction={() => onApply(status, changeDelivery ? date : undefined)}>
      <p className="font-semibold">
        {t("Заказ №")} {orderId}
      </p>
      <Field label={t("Статус")}>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
          {options.map((value) => (
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
    </DialogShell>
  )
}

function InvoiceDialog({ order, onClose, onSave }: { order: Order; onClose: () => void; onSave: (value: Partial<Order>) => void }) {
  const { t } = useLanguage()
  const [number, setNumber] = useState(order.invoiceNumber ?? "")
  const [date, setDate] = useState(order.invoiceDate ?? "")
  const [contract, setContract] = useState(order.contract ?? "")
  const [active, setActive] = useState(order.invoiceActive ?? false)
  // The client's contracts (Финансы → Договоры).
  const contracts = useNames("/api/contracts?pageSize=0", (row) => {
    const clients = (row.clients as Array<{ id: number; name: string }> | undefined) ?? []
    const mine = clients.some((client) => (order.clientId ? client.id === order.clientId : client.name === order.client))
    return mine ? `№${String(row.fullNumber ?? row.id)}${row.officialName ? ` ${String(row.officialName)}` : ""}` : ""
  })
  const options = contract && !contracts.includes(contract) ? [contract, ...contracts] : contracts
  return (
    <DialogShell title={t("Изменить детали счет фактуры")} onClose={onClose} action={t("Сохранить")} onAction={() => onSave({ invoiceNumber: number.trim(), invoiceDate: date, contract, invoiceActive: active })}>
      <Field label={t("Номер счет фактуры")}>
        <input value={number} onChange={(event) => setNumber(event.target.value)} className={fieldClass} />
      </Field>
      <Field label={t("Дата счет фактуры")}>
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
      </Field>
      <Field label={t("Договор")}>
        <select value={contract} onChange={(event) => setContract(event.target.value)} className={fieldClass}>
          <option value="">{t("Не указан")}</option>
          {options.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </Field>
      <label className="mt-4 flex items-center gap-3 font-semibold">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-4 w-4" />
        {t("Активная счет фактура")}
      </label>
    </DialogShell>
  )
}

function ManualDiscountDialog({ onClose, onApply, error }: { onClose: () => void; onApply: (percent: number) => void; error?: string }) {
  const { t } = useLanguage()
  const [percent, setPercent] = useState("")
  return (
    <DialogShell title={t("Ручная скидка")} onClose={onClose} action={t("Применить")} error={error} disabled={!percent} onAction={() => onApply(Number(percent))}>
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

function FullReturnDialog({ order, onClose, onConfirm, error }: { order: Order; onClose: () => void; onConfirm: (returnDate: string) => void; error?: string }) {
  const { t } = useLanguage()
  const [date, setDate] = useState(localIso(new Date()))
  return (
    <DialogShell title={t("Выполнить")} onClose={onClose} action={t("Да")} error={error} onAction={() => onConfirm(date)}>
      <p className="pb-5 pt-1">{t("Подтверждение запроса")}</p>
      <div className="-mx-[30px] bg-[#f1f4f7] px-[30px] py-5">
        <p className="font-semibold">{t("Вы действительно хотите сделать полный возврат ?")}</p>
        <p className="font-semibold">
          {t("Заказ №")} {order.id} — {t("Склад")}: {order.warehouse || t("Не указан")}
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

/** Available quantity per stock key ("product:<id>") at a warehouse. */
function useAvailable(warehouse: string) {
  const [available, setAvailable] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    if (!warehouse) {
      setAvailable(new Map())
      return
    }
    let cancelled = false
    void api<{ rows: Array<{ key: string; available: number }> }>(`/api/stock/balances?warehouse=${encodeURIComponent(warehouse)}&pageSize=0`).then((result) => {
      if (!cancelled) setAvailable(new Map(result.ok ? result.body.rows.map((row) => [row.key, row.available] as [string, number]) : []))
    })
    return () => {
      cancelled = true
    }
  }, [warehouse])
  return available
}

function EditOrderSheet({
  order,
  items,
  editable,
  onClose,
  onSave,
  reloadItems,
  onQuickEdit,
}: {
  order: Order
  items: OrderLineItem[]
  editable: boolean
  onClose: () => void
  onSave: (patch: Partial<Order> & { clientId?: number }) => void
  reloadItems: () => void
  onQuickEdit: () => void
}) {
  const { t } = useLanguage()
  const shipped = RELEASED_STATUSES.includes(order.status)
  const [clients, setClients] = useState<Array<{ id: number; name: string }>>([])
  const employees = useNames("/api/employees", employeeName)
  const warehouses = useNames("/api/warehouses", (row) => (row.active === false ? "" : plainName(row)))
  const priceLists = useNames("/api/price-lists", plainName)
  const currencies = useNames("/api/currencies", (row) => String(row.code ?? ""))
  const [clientId, setClientId] = useState(order.clientId ? String(order.clientId) : "")
  const [paymentType, setPaymentType] = useState(order.paymentType ?? "")
  const [currency, setCurrency] = useState(order.currency ?? "")
  const [priceList, setPriceList] = useState(order.priceList ?? "")
  const [agent, setAgent] = useState(order.agent)
  const [payUntil, setPayUntil] = useState(order.paymentDate ?? "")
  const [deal, setDeal] = useState(order.dealType ?? "")
  const [warehouse, setWarehouse] = useState(order.warehouse ?? "")
  const [deliveryType, setDeliveryType] = useState(order.deliveryType ?? "")
  const [deliverer, setDeliverer] = useState(order.deliveryMan ?? "")
  const [deliveryDate, setDeliveryDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(order.delivery) ? order.delivery : order.delivery && order.delivery !== "—" ? toInputDate(order.delivery) : "")
  const [comment, setComment] = useState(order.comment ?? "")
  const confirmable = ["Не подтвержден", "В процессе", "Есть на складе"].includes(order.status)
  const [confirmed, setConfirmed] = useState(order.status !== "Не подтвержден")
  const [error, setError] = useState("")
  const available = useAvailable(warehouse)

  useEffect(() => {
    void api<Array<{ id: number; name: string }>>("/api/clients?balances=0").then((result) => setClients(result.ok ? result.body.map((row) => ({ id: row.id, name: row.name })) : []))
  }, [])

  async function removeItem(itemId: number) {
    const result = await api(`/api/orders/${order.id}/items/${itemId}`, { method: "DELETE" })
    if (!result.ok) return setError(t(result.error))
    reloadItems()
  }

  function save() {
    const patch: Partial<Order> & { clientId?: number } = {}
    if (clientId && Number(clientId) !== order.clientId) patch.clientId = Number(clientId)
    if (paymentType !== (order.paymentType ?? "")) patch.paymentType = paymentType
    if (currency && currency !== (order.currency ?? "")) patch.currency = currency
    if (priceList !== (order.priceList ?? "")) patch.priceList = priceList
    if (agent && agent !== order.agent) patch.agent = agent
    if (payUntil !== (order.paymentDate ?? "")) patch.paymentDate = payUntil
    if (deal !== (order.dealType ?? "")) patch.dealType = deal
    if (warehouse !== (order.warehouse ?? "")) patch.warehouse = warehouse
    if (deliveryType !== (order.deliveryType ?? "")) patch.deliveryType = deliveryType
    if (deliverer !== (order.deliveryMan ?? "")) patch.deliveryMan = deliverer
    if (deliveryDate && deliveryDate !== order.delivery) patch.delivery = deliveryDate
    if (comment !== (order.comment ?? "")) patch.comment = comment
    if (confirmable) {
      const nextStatus = confirmed ? (order.status === "Не подтвержден" ? "Есть на складе" : order.status) : "Не подтвержден"
      if (nextStatus !== order.status) patch.status = nextStatus
    }
    if (!Object.keys(patch).length) return onClose()
    onSave(patch)
  }

  const select = (value: string, onChange: (value: string) => void, options: string[], disabled?: boolean, empty = true) => (
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${fieldClass} disabled:opacity-60`}>
      {empty && <option value="">{t("Не указано")}</option>}
      {(value && !options.includes(value) ? [value, ...options] : options).map((option) => (
        <option key={option} value={option}>
          {t(option)}
        </option>
      ))}
    </select>
  )

  return (
    <SheetShell
      title={t("Изменение заказа")}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3 px-[30px] py-3">
          {error && <span className="mr-auto text-[#e57373]">{error}</span>}
          <GreenButton onClick={save}>{t("Сохранить")}</GreenButton>
        </div>
      }
    >
      <div className="flex min-h-full">
        <div className="w-[280px] shrink-0 overflow-auto border-r border-[#efefef] px-[30px] pb-6 pt-[22px]">
          <Field label={t("Название клиента")} required>
            <select value={clientId} disabled={shipped} onChange={(event) => setClientId(event.target.value)} className={`${fieldClass} disabled:opacity-60`}>
              {!order.clientId && <option value="">{order.client}</option>}
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </Field>
          <b className="mb-3 mt-6 block text-[13px]">{t("Оплата")}</b>
          <Field label={t("Тип оплаты")}>
            <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)} className={fieldClass}>
              <option value="">{t("Не указан")}</option>
              <option value="cash">{t("Наличные")}</option>
              <option value="bank">{t("Перечисление")}</option>
            </select>
          </Field>
          <Field label={t("Валюта")} required>
            {select(currency, setCurrency, currencies, items.length > 0 || shipped, false)}
          </Field>
          <Field label={t("Прайс лист")}>{select(priceList, setPriceList, priceLists)}</Field>
          <Field label={t("Агент")} required>
            {select(agent, setAgent, employees, false, false)}
          </Field>
          <Field label={t("Дата окончательной оплаты")}>
            <input type="date" value={payUntil} onChange={(event) => setPayUntil(event.target.value)} className={fieldClass} />
          </Field>
          <b className="mb-3 mt-6 block text-[13px]">{t("Условия договора")}</b>
          {(["standard", "consignment"] as const).map((value) => (
            <label key={value} className="mb-3 flex items-center gap-3">
              <input type="radio" name="deal" checked={deal === value} onChange={() => setDeal(value)} className="h-4 w-4" />
              {t(DEAL_TYPE_LABELS[value])}
            </label>
          ))}
          <Field label={t("Склад")} required>
            {select(warehouse, setWarehouse, warehouses, shipped)}
          </Field>
          <b className="mb-1 mt-6 block text-[13px]">{t("Условия доставки")}</b>
          <Field label={t("Тип доставки")}>{select(deliveryType, setDeliveryType, ["Доставка", "Самовывоз"])}</Field>
          <Field label={t("Доставщик")}>{select(deliverer, setDeliverer, employees)}</Field>
          <Field label={t("Дата доставки")}>
            <input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} className={fieldClass} />
          </Field>
          <Field label={t("Комментарий")}>
            <input value={comment} onChange={(event) => setComment(event.target.value)} className={fieldClass} />
          </Field>
          {confirmable && (
            <label className="mt-2 flex items-center gap-3 font-semibold">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="h-4 w-4" />
              {t("Подтвержденный")}
            </label>
          )}
        </div>
        <div className="min-w-0 flex-1 px-[30px] pt-[14px]">
          <div className="border-b-2 border-[#4f71dc] pb-[14px] text-center text-[13px] font-medium">{t("Товары")}</div>
          <table className="mt-8 w-full text-left">
            <thead>
              <tr className="font-semibold">
                <th className="px-[5px] py-2">{t("Наименование")}</th>
                <th className="py-2">{t("Кол-во")}</th>
                <th className="py-2">{t("На складе")}</th>
                <th className="py-2">{`${t("Цена")} (${order.currency || "SUM"})`}</th>
                <th className="py-2">{`${t("Всего")} (${order.currency || "SUM"})`}</th>
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
                  <td>{item.productId && warehouse ? `${formatNumber(available.get(`product:${item.productId}`) ?? 0)} ${item.unit}` : "—"}</td>
                  <td>{formatNumber(item.unitPrice)}</td>
                  <td>{formatNumber(item.lineTotal)}</td>
                  <td className="whitespace-nowrap text-right">
                    {editable && (
                      <>
                        <button type="button" onClick={onQuickEdit} aria-label={t("Изменить")} className="mr-5">
                          <Mi d={ICONS.edit} className="h-5 w-5 fill-[#666]" />
                        </button>
                        <button type="button" onClick={() => removeItem(item.id)} aria-label={t("Удалить")}>
                          <Mi d={ICONS.trash} className="h-5 w-5 fill-black/30" />
                        </button>
                      </>
                    )}
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

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
    setError("")
    for (const [index, line] of lines.entries()) {
      const quantity = Number(line.quantity)
      const price = Number(line.price)
      const discount = Number(line.discount || 0)
      if (!(quantity > 0) || !(price >= 0) || !(discount >= 0 && discount <= 100)) return setError(`${items[index]?.productName}: ${t("Проверьте количество и цену")}`)
    }
    setSaving(true)
    try {
      for (const [index, item] of items.entries()) {
        const line = lines[index]
        const result = await api(`/api/orders/${order.id}/items/${item.id}`, {
          method: "PUT",
          body: { productId: item.productId ?? undefined, productName: item.productName, unit: item.unit, quantity: Number(line.quantity), unitPrice: Number(line.price), discountPercent: Number(line.discount || 0), currency: item.currency },
        })
        if (!result.ok) return setError(`${item.productName}: ${t(result.error)}`)
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }, [items, lines, onSaved, order.id, t])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "Enter") void save()
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
          <div className="flex items-center gap-4">
            {error && <span className="text-[#e57373]">{error}</span>}
            <button type="button" onClick={onClose} className="h-9 rounded-[3px] border border-[#d9d9d9] px-5 text-[12px] font-semibold uppercase text-[#555]">
              {t("Отмена")}
            </button>
            <GreenButton onClick={save} disabled={saving}>
              {t("Сохранить")} (Alt + Enter)
            </GreenButton>
          </div>
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
        </div>
        <table className="mt-8 w-full text-left">
          <thead>
            <tr className="font-semibold">
              <th className="py-3">{t("Наименование")}</th>
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
      </div>
    </SheetShell>
  )
}

type Returnable = { orderItemId: number; productName: string; unit: string; ordered: number; returned: number; available: number; price: number; currency: string }

function QuickReturnSheet({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: (id: number) => void }) {
  const { t } = useLanguage()
  const warehouses = useNames("/api/warehouses", (row) => (row.active === false ? "" : plainName(row)))
  const [lines, setLines] = useState<Returnable[] | null>(null)
  const [warehouse, setWarehouse] = useState(order.warehouse ?? "")
  const [comment, setComment] = useState("")
  const [manualPrice, setManualPrice] = useState(false)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api<Returnable[]>(`/api/orders/${order.id}/returnable`).then((result) => setLines(result.ok ? result.body : []))
  }, [order.id])

  const priceOf = (line: Returnable) => (manualPrice && prices[line.orderItemId] !== undefined ? Number(prices[line.orderItemId]) || 0 : line.price)
  const total = (lines ?? []).reduce((sum, line) => sum + (Number(qty[line.orderItemId]) || 0) * priceOf(line), 0)

  async function save() {
    setError("")
    const chosen = (lines ?? []).filter((line) => (Number(qty[line.orderItemId]) || 0) > 0)
    if (!warehouse) return setError(t("Выберите склад"))
    if (!chosen.length) return setError(t("Укажите количество возврата"))
    const over = chosen.find((line) => Number(qty[line.orderItemId]) > line.available)
    if (over) return setError(`${over.productName}: ${t("Количество возврата больше доступного")}`)
    setSaving(true)
    const result = await api<{ id: number }>("/api/client-returns", {
      method: "POST",
      body: {
        clientId: order.clientId ?? undefined,
        client: order.clientId ? undefined : order.client,
        orderId: order.id,
        warehouse,
        comment: comment.trim() || undefined,
        items: chosen.map((line) => ({ orderItemId: line.orderItemId, quantity: Number(qty[line.orderItemId]), ...(manualPrice ? { price: priceOf(line) } : {}) })),
      },
    })
    setSaving(false)
    if (!result.ok) return setError(t(result.error))
    onSaved(result.body.id)
  }

  return (
    <SheetShell
      title={`${t("Быстрый возврат")} №${order.id}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-4 px-[10px] py-[10px]">
          <span className="mr-auto">
            {t("Сумма")}: <b>{formatNumber(total)} {order.currency || "SUM"}</b>
          </span>
          {error && <span className="text-[#e57373]">{error}</span>}
          <GreenButton onClick={save} disabled={saving}>
            {t("Сохранить")}
          </GreenButton>
        </div>
      }
    >
      <div className="px-[30px] pt-[30px]">
        <div className="flex items-end gap-4">
          <div className="w-[290px]">
            <Field label={t("Склад")} required>
              <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} className={fieldClass}>
                <option value="" />
                {(warehouse && !warehouses.includes(warehouse) ? [warehouse, ...warehouses] : warehouses).map((name) => (
                  <option key={name}>{name}</option>
                ))}
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
        {lines === null ? (
          <p className="py-8 text-center text-[#888]">{t("Загрузка...")}</p>
        ) : (
          <table className="mt-6 w-full text-left">
            <thead>
              <tr className="font-semibold">
                <th className="py-3">{t("Наименование")}</th>
                <th>{t("По заказу")}</th>
                <th>{t("Уже возвращено")}</th>
                <th>{t("Доступно")}</th>
                <th>{t("Кол-во возврата")}</th>
                <th>{t("Цена")}</th>
                <th>{t("Сумма")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.orderItemId} className="border-y border-dotted border-[#9ec9e8] bg-[#f1f4f7]">
                  <td className="py-[14px]">{line.productName}</td>
                  <td>{formatNumber(line.ordered)}</td>
                  <td>{formatNumber(line.returned)}</td>
                  <td>{formatNumber(line.available)}</td>
                  <td className="w-[200px] pr-6">
                    <input
                      type="number"
                      min="0"
                      max={line.available}
                      step="any"
                      disabled={line.available <= 0}
                      value={qty[line.orderItemId] ?? ""}
                      onChange={(event) => setQty((current) => ({ ...current, [line.orderItemId]: event.target.value }))}
                      className="w-full border-b-2 border-[#374557] bg-transparent py-1 outline-none disabled:opacity-40"
                    />
                  </td>
                  <td className="w-[200px] pr-6">
                    <input
                      disabled={!manualPrice}
                      value={manualPrice ? (prices[line.orderItemId] ?? String(line.price)) : String(line.price)}
                      onChange={(event) => setPrices((current) => ({ ...current, [line.orderItemId]: event.target.value }))}
                      className="w-full border-b border-dotted border-[#374557] bg-transparent py-1 font-bold outline-none"
                    />
                  </td>
                  <td>{formatNumber((Number(qty[line.orderItemId]) || 0) * priceOf(line))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SheetShell>
  )
}

function PrintSheet({ order, items, debt, onClose }: { order: Order; items: OrderLineItem[]; debt: OrderDetail["clientDebt"] | null; onClose: () => void }) {
  const { t } = useLanguage()
  const organizations = useNames("/api/organizations", plainName)
  const [agentPhone, setAgentPhone] = useState("")
  useEffect(() => {
    void api<Array<Record<string, unknown>>>("/api/employees").then((result) => {
      if (!result.ok) return
      const agent = result.body.find((row) => employeeName(row) === order.agent)
      setAgentPhone(String(agent?.phone ?? ""))
    })
  }, [order.agent])
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const qty = items.reduce((sum, item) => sum + item.quantity, 0)
  const currency = order.currency || "SUM"
  // The company on the invoice: the order's organization, else the first organization.
  const company = order.organization || organizations[0] || ""
  const counted = order.status !== "Отменен" && order.status !== "Не подтвержден"
  const endBalance = debt?.operative || `0 ${currency}`
  // Balance before this order = end balance + this order's total (same currency) when the order counts.
  const beforeBalance = (() => {
    if (!counted || !debt) return endBalance
    const parts = (debt.operative || "").split(/,\s+/).filter(Boolean)
    let found = false
    const next = parts.map((part) => {
      const match = /^(-?[\d\s .,]+)\s+([A-Za-z]+)$/.exec(part.trim())
      if (!match || match[2] !== currency) return part
      found = true
      const value = Number(match[1].replace(/[\s ]/g, "").replace(",", ".")) + total
      return `${formatNumber(value)} ${currency}`
    })
    if (!found) next.push(`${formatNumber(total)} ${currency}`)
    return next.join(", ")
  })()

  const block = (
    <div className="mb-6">
      <table className="w-full border-collapse text-center text-[13px]">
        <thead>
          <tr className="font-semibold">
            <th className="border border-black px-2 py-[3px]">№</th>
            <th className="border border-black px-2 py-[3px]">{t("Наименование")}</th>
            <th className="border border-black px-2 py-[3px]">{t("Количество")}</th>
            <th className="border border-black px-2 py-[3px]">{`${t("Цена")} (${currency})`}</th>
            <th className="border border-black px-2 py-[3px]">{`${t("Сумма")} (${currency})`}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.id}>
              <td className="border border-black px-2 py-[3px] font-bold">{index + 1}</td>
              <td className="border border-black px-2 py-[3px] font-bold">{item.productName}</td>
              <td className="border border-black px-2 py-[3px]">
                {formatNumber(item.quantity)} {item.unit}
              </td>
              <td className="border border-black px-2 py-[3px]">{formatNumber(item.unitPrice)}</td>
              <td className="border border-black px-2 py-[3px]">{formatNumber(item.lineTotal)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={2} className="border border-black px-2 py-[3px] text-left">
              {t("Итого")}:
            </td>
            <td className="border border-black px-2 py-[3px]">{formatNumber(qty)}</td>
            <td className="border border-black px-2 py-[3px]" />
            <td className="border border-black px-2 py-[3px]">
              {formatNumber(total)} {currency}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-6 flex justify-between font-bold">
        <span>
          {t("Баланс на конец")}: {endBalance}
        </span>
        <span>
          {t("Организация")}: {company || t("Не указана")}
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
        <h2 className="absolute left-1/2 -translate-x-1/2 text-[18px] font-semibold uppercase">{company}</h2>
        <div className="flex items-start gap-5">
          <span className="text-[11px] font-semibold text-[#666]">
            {t("Добавлено")}: {order.createdAt ? displayMoment(order.createdAt) : order.created}
          </span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="print:hidden">
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
            <b>{t("Номер телефона агента")}:</b> {agentPhone || t("Не указан")}
          </p>
          <p>
            <b>{t("Склад")}:</b> {order.warehouse || t("Не указан")}
          </p>
          <p>
            <b>{t("Комментарии")}:</b> {order.comment || "—"}
          </p>
          <p>
            <b>{t("Баланс клиента до")}:</b> {beforeBalance}
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
            <b>{t("Телефон")}:</b> {order.clientPhone || t("Не указан")}
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
