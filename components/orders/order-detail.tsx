"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { formatUnitTotals } from "@/components/analytics/internal-transfers-picker"
import { ClientDrawer } from "@/components/clients/clients-view"
import { amountDigits } from "@/lib/amount-precision"
import { parseAnyDay, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { strictNumber } from "@/lib/strict-number"

import { AddOrderDialog, OrganizationMoveHint } from "./add-order-dialog"
import { RefCheck, RefDate, RefSelect, RefText } from "./order-ref-fields"
import { OrderPaymentsDialog } from "./order-returns-tab"
import { OrderSeriesControls, OrderSeriesTab } from "./order-series"
import { PrintMenu } from "./print-menu"
import { EDITABLE_STATUSES, FINAL_STATUSES, ORDER_STATUSES, canChangeStatus, orderApiErrorText, orderOrganization, type AgentLimitExceeded, type Order, type ProductRestrictionRefusal } from "./orders-data"

// The order card (Продажи → Заказы → a row). Every figure comes from the
// server: the order (warehouse, payment terms, deliverer, invoice details),
// its lines, its change log (order_logs), what was paid / remains
// (/api/cash/orders/:id) and the client's operative / actual debt (client
// ledger). Overlays are portaled to <body> so the sticky page header never
// covers them.

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

export type OrderLineItem = {
  id: number
  productId: number | null
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  discountPercent: number
  currency: string
  lineTotal: number
  article?: string
  boxAmount?: number
  boxUnit?: string
  returnQuantity?: number
  /** A bonus line of a Linko promotion (green «(бонус)» after the name). */
  isBonus?: boolean
  /** The line's Linko id on a copied order (the quick return's «№»). */
  linkoId?: number
}

export type ApiOrderLog = {
  id: number
  action: string
  status: string
  comment: string
  totalPrice: number
  currency: string
  payType: string
  createdBy: string
  createdAt: string
  market: string
  products: { productId: number | null; name: string; amount: number; price: number; total: number }[]
}

/** GET /api/orders/[id]: the client's operative / actual debt from the client ledger (one line per currency). */
type OrderDetail = Order & {
  clientDebt?: { operative: string; actual: string; operativeNegative: boolean; actualNegative: boolean } | null
}

/** GET /api/cash/orders/[id]: paid / remaining per currency. */
type OrderDue = { currencies: Array<{ currency: string; total: number; paid: number; remaining: number }> }

/** A client return of the order (Продажи → Возвраты, /api/client-returns?orderId=). */
type ReturnRow = { id: number; returnDate: string; status: string; warehouse: string; amount: number; currency: string; comment?: string; itemCount?: number }

/** Reference action codes -> badge label and colour of the "Логи" tab. */
export const LOG_ACTIONS: Record<string, { label: string; tone: "success" | "begin" | "error" }> = {
  created: { label: "Создан", tone: "success" },
  updated: { label: "Обновленный", tone: "begin" },
  given: { label: "Передан доставщику", tone: "begin" },
  cancel_given: { label: "Отменил передачу", tone: "error" },
  delivered: { label: "Доставлен", tone: "success" },
  undelivered: { label: "Отменена доставки", tone: "error" },
  add_discount: { label: "Добавление ручной скидки", tone: "success" },
  cancel_discount: { label: "Добавление ручной скидки отменено", tone: "error" },
  add_bonus: { label: "Добавлен бонус", tone: "success" },
  canceled: { label: "Заказ отменен", tone: "error" },
  fiscal_check: { label: "Создан фискальный чек", tone: "success" },
}

/** Reference status codes of a log entry -> the order status label used by STATUS_MENU, and the label the log prints. */
export const LOG_STATUS: Record<string, { status: string; label: string; color: string }> = {
  "0": { status: "В процессе", label: "В процессе", color: "#f0ad4e" },
  "1": { status: "Есть на складе", label: "Есть на складе", color: "#f0ad4e" },
  "2": { status: "В пути", label: "Передан доставщику", color: "#f0ad4e" },
  "3": { status: "Доставлено", label: "Доставлен", color: "#81c784" },
  "4": { status: "Отменен", label: "Заказ отменен", color: "#e57373" },
  "5": { status: "Не подтвержден", label: "Не подтвержден", color: "#999" },
}
const STATUS_CODE_OF: Record<string, string> = { "В процессе": "0", "Есть на складе": "1", "В пути": "2", "Доставлено": "3", "Отменен": "4", "Не подтвержден": "5" }

/** "2026-08-17T13:47:59" -> "17 авг. 2026, 13:47" */
export function formatLogDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${formatRuDate(date)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

export const ORDER_STATUS_OPTIONS: string[] = [...ORDER_STATUSES]

const STATUS_MENU: { status: string; label: string; icon: string; color: string }[] = [
  { status: "Не подтвержден", label: "Не подтвержденный", icon: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z", color: "#999" },
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
    icon: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z",
    color: "#81c784",
  },
  {
    status: "Отменен",
    label: "Отменен",
    icon: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM4 12c0-4.4 3.6-8 8-8 1.8 0 3.5.6 4.9 1.7L5.7 16.9C4.6 15.5 4 13.8 4 12zm8 8c-1.8 0-3.5-.6-4.9-1.7L18.3 7.1C19.4 8.5 20 10.2 20 12c0 4.4-3.6 8-8 8z",
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
  sync: "M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z",
  receipt:
    "M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z",
  editMode: "M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z",
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

function formatRuDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${RU_SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** "2026-10-21" → "21 окт. 2026"; other texts unchanged. */
function displayDay(value: string | undefined | null) {
  const text = value ?? ""
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  return match ? `${match[3]} ${RU_SHORT_MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}` : text
}

function fromInputDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : formatRuDate(date)
}

/** UTC "YYYY-MM-DD HH:MM:SS" or ISO → local "21 окт. 2026, 14:05". */
function displayMoment(value: string | undefined | null) {
  if (!value) return ""
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return value
  return `${formatRuDate(date)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function formatNumber(value: number) {
  // Linko's numberFormat: the decimals of Настройки → Округление сумм override the precision of the call.
  return value.toLocaleString("ru-RU", { maximumFractionDigits: amountDigits(2) })
}

const PAYMENT_TYPE_LABELS: Record<string, string> = { cash: "Наличные", bank: "Перечисление" }

type ApiResult<T> = { ok: true; body: T } | { ok: false; error: string; agentLimit?: AgentLimitExceeded; productRestriction?: ProductRestrictionRefusal }

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const body = (await response.json().catch(() => null)) as (T & { error?: string; agentLimit?: AgentLimitExceeded; productRestriction?: ProductRestrictionRefusal }) | null
    if (!response.ok || body === null) {
      return { ok: false, error: body?.error ?? "Не удалось сохранить изменения на сервере", agentLimit: body?.agentLimit, productRestriction: body?.productRestriction }
    }
    return { ok: true, body }
  } catch {
    return { ok: false, error: "Не удалось сохранить изменения на сервере" }
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

function HeaderButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[30px] items-center rounded-[5px] bg-[#1E4A9A] pl-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Mi d={icon} className="mb-1 h-[18px] w-[18px] fill-white" />
      <span className="pl-2 pr-4">{label}</span>
    </button>
  )
}

const MONEY_BILLS_PATH =
  "M32.72,34.72,27.64,46.06c12.92,9.33,32.17,15,45.57,8-11.46,21.62-38,21.61-55.7,14.55L12.33,80.23,0,47.39,32.72,34.72ZM49,0l73.92,17.59L112.28,60,38.36,42.42,49,0Zm34.8,17.53a12.86,12.86,0,1,1-15.6,9.37,12.86,12.86,0,0,1,15.6-9.37ZM61,9.86l46.57,10.76a6.47,6.47,0,0,0,4.71,7.83l-4.18,16.78a6.46,6.46,0,0,0-7.83,4.7L53.67,39.17A6.47,6.47,0,0,0,49,31.34l4.18-16.77A6.47,6.47,0,0,0,61,9.86Z"

/**
 * A row of the header drop-down menus. "status" rows carry a coloured 24px icon; "action" rows keep the reference's
 * 48px icon button (20px grey icon inside) before the label.
 */
function MenuItem({
  icon,
  color = "#666",
  label,
  onClick,
  kind = "action",
  iconNode,
  disabled,
}: {
  icon?: string
  color?: string
  label: string
  onClick: () => void
  kind?: "status" | "action"
  iconNode?: ReactNode
  disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex h-12 w-full cursor-pointer items-center pl-5 pr-4 text-left text-[13px] text-[#333] hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40">
      {kind === "status" ? (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" aria-hidden>
          <path d={icon} fill={color} />
        </svg>
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center">
          {iconNode ?? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill={color} aria-hidden>
              <path d={icon} />
              {icon === ICONS.editMode && <path d="M0 20h24v4H0z" fillOpacity=".36" />}
            </svg>
          )}
        </span>
      )}
      <span className="whitespace-nowrap pl-[5px]">{label}</span>
    </button>
  )
}

function Menu({ children, onClose, width = 224 }: { children: ReactNode; onClose: () => void; width?: number }) {
  const { t } = useLanguage()
  return (
    <>
      <button type="button" data-order-overlay aria-label={t("Закрыть")} onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
      <div
        style={{ width }}
        className="absolute right-0 top-[30px] z-[115] overflow-hidden rounded-[8px] bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
      >
        {children}
      </div>
    </>
  )
}

/** Escape closes whichever dialog/sheet is mounted last, like the reference. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
}

/**
 * The reference's Material dialog: title 21.4px from the top, 48px close button 10px from the right, flat blue
 * action pinned 10px above the bottom edge. `height` / `top` fix the geometry of dialogs the reference sizes that way.
 */
export function DialogShell({
  title,
  onClose,
  action,
  onAction,
  children,
  disabled,
  width = 500,
  height,
  top,
  inset,
  closeRight = 10,
  error,
}: {
  title: string
  onClose: () => void
  action: string
  onAction: () => void
  children: ReactNode
  disabled?: boolean
  width?: number
  height?: number
  top?: number
  /** The line above the action stops 30px short of the edges (the status dialog) instead of spanning the dialog. */
  inset?: boolean
  /** Distance of the 48px close button from the right edge (the reference uses 15px in a few dialogs). */
  closeRight?: number
  /** Server error shown at the bottom-left of the footer. */
  error?: string
}) {
  const { t } = useLanguage()
  useEscape(onClose)
  return createPortal(
    <div
      data-order-overlay
      className={`fixed inset-0 z-[1500] flex justify-center bg-black/[0.54] font-sans text-[13px] text-[#333] ${top === undefined ? "items-center" : "items-start"}`}
    >
      <div style={{ width, minHeight: height, marginTop: top }} className="relative max-w-full bg-white pb-[56px] pt-[60px] shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{title}</span>
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} style={{ right: closeRight }} className="absolute top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
          <Mi d={ICONS.close} className="h-6 w-6 fill-[#333]" />
        </button>
        <span className="absolute inset-x-0 top-[59.3px] h-px bg-[#efefef]" />
        <span className={`absolute bottom-[56px] h-px bg-[#efefef] ${inset ? "inset-x-[30px]" : "inset-x-0"}`} />
        <div className="px-[30px]">{children}</div>
        {error && <span className="absolute bottom-[19px] left-[30px] right-[120px] text-[#e57373]">{error}</span>}
        <button type="button" disabled={disabled} onClick={onAction} className="absolute bottom-[10px] right-[10px] h-9 min-w-[88px] cursor-pointer text-center disabled:cursor-default disabled:opacity-40">
          <span className="inline-block px-[16px] py-[9px] text-[13px] font-semibold uppercase leading-[18px] text-[#129fdd]">{action}</span>
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** Full-screen sheet; rendered in a portal so it covers the navbar like the reference (z-index 1001+). */
function SheetShell({ title, onClose, children, footer, z = 1301 }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; z?: number }) {
  const { t } = useLanguage()
  useEscape(onClose)
  return createPortal(
    <div data-order-overlay style={{ zIndex: z }} className="fixed inset-0 flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="relative h-[59px] shrink-0 border-b border-[#efefef]">
        <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{title}</span>
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[10px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
          <Mi d={ICONS.close} className="h-6 w-6 fill-[#333]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer && <div className="shrink-0 border-t border-[#efefef]">{footer}</div>}
    </div>,
    document.body,
  )
}

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

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

const TABS = ["Список товаров", "Серии", "Возврат", "Задействованные акции", "Логи"] as const
/** The reference's tab widths (px): the "Возврат" tab is 15px wider than the others. */
const TAB_COLUMNS = [279.8, 279.8, 294.8, 279.8, 279.8]
type DetailTab = (typeof TABS)[number]
/** Linko's ?tab= value of each tab (#/order/<id>?tab=logs): written once a tab is picked. */
const TAB_KEYS: Record<DetailTab, string> = { "Список товаров": "productList", Серии: "expireDate", Возврат: "return", "Задействованные акции": "promotions", Логи: "logs" }

/** A promotion the order used (GET /api/orders/[id]/promotions): Linko's «Задействованные акции». */
type OrderPromotion = { id: number; name: string; type: string }

/** Linko's dotted list rows of the «Возврат» tab (xs 3 / 3 / 2 / 3 / 1 of 12; text right-aligned unless set left). */
const DOTTED_ROW = "grid min-h-[60px] grid-cols-[3fr_3fr_2fr_3fr_1fr] items-center border-b-2 border-dotted border-[#d9e0e5] px-[5px] text-right text-[13px] text-[#333] [&>*]:pr-[22px]"
/** The same rows of «Задействованные акции» (xs 2 / 6 / 4). */
// Linko's «Тип акции» ends at the card's inner edge: no padding after the last column.
const DOTTED_ROW_PROMO = "grid min-h-[60px] grid-cols-[2fr_6fr_4fr] items-center border-b-2 border-dotted border-[#d9e0e5] pl-[5px] text-right text-[13px] text-[#333] [&>*]:pr-[22px] [&>*:last-child]:pr-0"

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
  const [tab, setTab] = useState<DetailTab>("Список товаров")
  // Linko writes ?tab= only once a tab is picked (or the address named one).
  const [tabInUrl, setTabInUrl] = useState(false)
  const [menu, setMenu] = useState<null | "status" | "edit" | "discount" | "discountSize" | "return" | "print">(null)
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const [dialog, setDialog] = useState<
    null | "status" | "invoice" | "manualDiscount" | "recalc" | "cancelDiscount" | "fullReturn" | "cancelOrder" | "logDetails"
  >(null)
  const [sheet, setSheet] = useState<null | "edit" | "quickEdit" | "quickReturn" | "printPreview">(null)
  const [printCopies, setPrintCopies] = useState(1)
  // Linko's client link opens the shop card over the order page (?openShopDetail=<shop id>).
  const [shopId, setShopId] = useState<number | null>(null)
  // Linko's X leaves drawer=drawer_agent_visit&openShopDetail=0 (0: closed) and keeps the drawer's tab parameters.
  const closeShop = useCallback(() => setShopId(0), [])
  const [items, setItems] = useState<OrderLineItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [logs, setLogs] = useState<ApiOrderLog[]>([])
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [due, setDue] = useState<OrderDue | null>(null)
  const [returns, setReturns] = useState<ReturnRow[]>([])
  const [promotions, setPromotions] = useState<OrderPromotion[] | null>(null)
  const [statusTarget, setStatusTarget] = useState(order.status)
  const [dialogError, setDialogError] = useState("")

  const status = order.status
  const editable = !(ORDER_STATUSES as readonly string[]).includes(status) || EDITABLE_STATUSES.includes(status)
  const final = FINAL_STATUSES.includes(status)
  /**
   * Linko lists all six statuses in «Изменить статус» (the current one too: its dialog can move the delivery date).
   * Mezon keeps the server's transition rule (lib/orders-repo.ts updateOrder → canChangeStatus: a shipped order's stock
   * and a delivered / cancelled order's client ledger are not unwound by a status change), so a status the server
   * refuses is listed greyed; the current one stays open while the order is not final.
   */
  const canPickStatus = (target: string) => (target === status ? !final : canChangeStatus(status, target))

  // Linko keeps the card's tab and dialogs in the query string: ?tab=logs, ?openUpdateDialog=true, ?openQuickEdit=true,
  // ?openInvoiceDialog=true, ?openQuickReturn=true, ?openManualDiscountDialog=true, ?openTransactionsDialog=true,
  // ?openShopDetail=<shop>, ?detailStatus=<code>&openChangeStatus=true.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const flag = (name: string) => params.get(name) === "true"
    const fromUrl = TABS.find((label) => TAB_KEYS[label] === params.get("tab"))
    if (fromUrl) {
      setTab(fromUrl)
      setTabInUrl(true)
    }
    if (flag("openUpdateDialog")) setSheet("edit")
    else if (flag("openQuickEdit")) setSheet("quickEdit")
    else if (flag("openQuickReturn")) setSheet("quickReturn")
    const target = LOG_STATUS[params.get("detailStatus") ?? ""]?.status
    if (flag("openInvoiceDialog")) setDialog("invoice")
    else if (flag("openManualDiscountDialog")) setDialog("manualDiscount")
    else if (flag("openChangeStatus") && target && canPickStatus(target)) {
      setStatusTarget(target)
      setDialog("status")
    }
    if (flag("openTransactionsDialog")) setPaymentsOpen(true)
    const shop = Number(params.get("openShopDetail"))
    if (Number.isSafeInteger(shop) && shop > 0) setShopId(shop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const urlState = JSON.stringify({
    tab: tabInUrl ? TAB_KEYS[tab] : null,
    openUpdateDialog: sheet === "edit" ? "true" : null,
    openQuickEdit: sheet === "quickEdit" ? "true" : null,
    openQuickReturn: sheet === "quickReturn" ? "true" : null,
    openInvoiceDialog: dialog === "invoice" ? "true" : null,
    openManualDiscountDialog: dialog === "manualDiscount" ? "true" : null,
    openChangeStatus: dialog === "status" ? "true" : null,
    detailStatus: dialog === "status" ? (STATUS_CODE_OF[statusTarget] ?? null) : null,
    openTransactionsDialog: paymentsOpen ? "true" : null,
    openShopDetail: shopId ? String(shopId) : shopId === 0 ? "0" : null,
    drawer: shopId === 0 ? "drawer_agent_visit" : null,
  })
  const urlReady = useRef(false)
  useEffect(() => {
    if (!urlReady.current) {
      urlReady.current = true
      return
    }
    const url = new URL(window.location.href)
    for (const [name, value] of Object.entries(JSON.parse(urlState) as Record<string, string | null>)) {
      if (value === null) url.searchParams.delete(name)
      else url.searchParams.set(name, value)
    }
    url.searchParams.sort()
    const next = url.pathname + url.search
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next)
  }, [urlState])

  const loadItems = useCallback(() => {
    setItemsLoading(true)
    return api<OrderLineItem[]>(`/api/orders/${order.id}/items`)
      .then((result) => setItems(result.ok ? result.body : []))
      .finally(() => setItemsLoading(false))
  }, [order.id])

  useEffect(() => {
    void loadItems()
    setMenu(null)
  }, [order.id, loadItems])

  // Another order in the same card: back to its first tab (the first mount keeps the tab the address named).
  const shownOrder = useRef(order.id)
  useEffect(() => {
    if (shownOrder.current === order.id) return
    shownOrder.current = order.id
    setTab("Список товаров")
    setTabInUrl(false)
  }, [order.id])

  // «Задействованные акции»: the promotions Linko applied to the order.
  useEffect(() => {
    let cancelled = false
    setPromotions(null)
    void api<OrderPromotion[]>(`/api/orders/${order.id}/promotions`).then((result) => {
      if (!cancelled) setPromotions(result.ok && Array.isArray(result.body) ? result.body : [])
    })
    return () => {
      cancelled = true
    }
  }, [order.id])

  const loadLogs = useCallback(() => {
    fetch(`/api/orders/${order.id}/logs`)
      .then(async (response) => (response.ok ? ((await response.json()) as ApiOrderLog[]) : []))
      .then(setLogs)
      .catch(() => setLogs([]))
  }, [order.id])

  useEffect(() => {
    loadLogs()
  }, [loadLogs, order.status])

  // Every figure of the card comes from the server: the client's ledger debt, what was paid / remains, the client returns.
  const loadExtras = useCallback(() => {
    void api<OrderDetail>(`/api/orders/${order.id}`).then((result) => setDetail(result.ok ? result.body : null))
    void api<OrderDue>(`/api/cash/orders/${order.id}`).then((result) => setDue(result.ok ? result.body : null))
    void api<{ rows: ReturnRow[] }>(`/api/client-returns?orderId=${order.id}`).then((result) => setReturns(result.ok ? result.body.rows : []))
  }, [order.id])

  // The list row changes (status, totals…) → reload what depends on it.
  useEffect(() => {
    loadExtras()
  }, [order.status, order.amount, loadExtras])

  // The status change itself is logged by the API; every other action posts its own entry.
  const addLog = (action: string, comment = "") => {
    void fetch(`/api/orders/${order.id}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, status: STATUS_CODE_OF[order.status] ?? "", comment }),
    }).then(loadLogs)
  }

  const reloadAll = () => {
    void loadItems()
    loadLogs()
    loadExtras()
    refreshOrder(order.id)
  }

  /** Saves a patch through the list's updater; false (and no message) when the server refused it. */
  const patchOrder = async (patch: Partial<Order>, message?: string) => {
    const ok = await onUpdate(order.id, patch)
    if (ok !== false) {
      loadLogs()
      loadExtras()
      if (message) onNotify(message)
    }
    return ok !== false
  }

  /** The reference only offers returns once the goods left the warehouse (delivered / handed to the courier). */
  const canReturn = order.status === "Доставлено" || order.status === "В пути"

  /** One discount on every line; returns the first server error (nothing is logged then). */
  async function applyDiscountPercent(percent: number): Promise<string | null> {
    const error = await putDiscounts(order.id, items, percent)
    if (error) return error
    await patchOrder({ discount: percent ? `${percent}%` : "" })
    // Linko logs these without a comment (sales/order_logs add_discount / cancel_discount).
    addLog(percent ? "add_discount" : "cancel_discount")
    reloadAll()
    return null
  }

  const invoiceActive = order.invoiceActive ?? false
  const invoiceNumber = order.invoiceNumber ?? ""
  const invoiceDate = order.invoiceDate ?? ""
  const invoiceContract = order.invoiceContract ?? ""
  const statusColor =
    status === "Доставлено" ? "text-[#81c784]" : status === "Отменен" ? "text-[#e57373]" : status === "Не подтвержден" ? "text-[#999]" : "text-[#f0ad4e]"
  // The order currency (every line is in it); older rows only carry it in the amount text.
  const currency = order.currency || order.amount.trim().split(/\s+/).pop() || ""
  // created_at is UTC: the creation day is its Tashkent day.
  const createdDay = order.createdAt ? parseAnyDay(order.createdAt, true) : null
  const createdDate = createdDay ? fromInputDate(createdDay) : /^\d{1,2}\s+\S+\s+\d{4}/.test(order.created) ? order.created.replace(/\s+\d{1,2}:\d{2}$/, "") : `${order.created.replace(/\s+\d{1,2}:\d{2}$/, "")} ${new Date().getFullYear()}`
  // The client's debt from the client ledger (one line per currency, never a guessed currency).
  const debt = detail?.clientDebt ?? null
  // Linko prints the order's own delivery man (never the shop's), else «Не указан».
  const deliverer = order.deliveryMan || ""
  const dueLine = (pick: "paid" | "remaining") => (due?.currencies.length ? due.currencies.map((entry) => `${formatNumber(entry[pick])} ${entry.currency}`).join(", ") : `0 ${currency}`.trim())
  const paid = due?.currencies.some((entry) => entry.paid > 0) ?? false
  /** Debt lines of the ledger text ("-120 SUM, 5 USD"; a decimal comma has no space after it), red when negative. */
  const debtLines = (text: string | undefined) =>
    (text || "0")
      .split(/,\s+/)
      .filter(Boolean)
      .map((line) => (
        <span key={line} className={`block ${line.trim().startsWith("-") ? "text-[#e57373]" : "text-[#81c784]"}`}>
          {line}
        </span>
      ))
  const payDay = order.paymentDate || order.dueDate || ""
  // Linko prints the name of the order's payment type as it is stored (custom_payment_type.name: «cash», «Наличные»…);
  // an order without one shows the label of its cash / bank kind.
  const paymentTypeLabel = order.payTypeName || (order.paymentType ? PAYMENT_TYPE_LABELS[order.paymentType] ?? order.paymentType : order.payMethod === "bank" ? "Перечисление" : order.payMethod ? "Наличные" : "")
  // Linko: deal_type "0" is «Стандартная», anything else (an empty value too) «Консигнация»; the app's own orders store
  // "standard" / "consignment".
  const dealLabel = order.dealType === "0" || order.dealType === "standard" ? "Стандартная" : "Консигнация"
  const deliveryTypeLabel = order.deliveryType === "self" ? "Самовывоз" : order.deliveryType === "delivery" ? "Доставка" : order.deliveryType || ""
  // «Дата реализации»: the day Linko accepted the order (accepted_time, a date only); the app's own orders are realized
  // the day they leave the warehouse (shipped_at).
  const realizedDay = order.acceptedDate || (order.shippedAt ? parseAnyDay(order.shippedAt, true) : null) || ""
  // The order's effective discount as Linko's «Скидка» popover hints it: 100 × discount / (total + discount).
  const grossTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const discountTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice - item.lineTotal, 0)
  const discountShare = grossTotal > 0 ? (100 * discountTotal) / grossTotal : 0

  const row = (label: string, value: ReactNode, valueClass = "") => (
    <li className="flex min-h-[25px] items-start justify-between gap-3 leading-[25px]">
      <span>{label}</span>
      <span className={`max-w-[50%] text-right font-semibold ${valueClass}`}>{value}</span>
    </li>
  )

  const tabIndex = TABS.indexOf(tab)
  // Linko greys the trash (cancel) of a cancelled order and of one that left the warehouse.
  const canCancel = !(status === "Отменен" || status === "В пути" || status === "Доставлено") && canChangeStatus(status, "Отменен")

  return (
    <div className="relative bg-white font-sans text-[13px] leading-normal text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      {/* header */}
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[18px] font-semibold leading-[22.5px]">
          {t("Заказ №")}
          {order.id}
        </h2>
        <div className="flex items-center gap-[18px]">
          {/* «Серии» tab: Linko's av_timer and «Изменит серии» (the editor's deep link opens on every tab). */}
          <OrderSeriesControls orderId={order.id} warehouse={order.warehouse || order.stockName || ""} buttons={tab === "Серии"} onNotify={onNotify} />
          <div className="relative">
            <HeaderButton icon={ICONS.edit} label={t("Изменить статус")} onClick={() => setMenu(menu === "status" ? null : "status")} />
            {menu === "status" && (
              <Menu onClose={() => setMenu(null)}>
                {STATUS_MENU.map((item) => (
                  <MenuItem
                    key={item.status}
                    kind="status"
                    icon={item.icon}
                    color={item.color}
                    label={t(item.label)}
                    disabled={!canPickStatus(item.status)}
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
              <Menu onClose={() => setMenu(null)} width={336}>
                <MenuItem icon={ICONS.edit} label={t("Изменить")} disabled={final} onClick={() => (setMenu(null), setSheet("edit"))} />
                <MenuItem icon={ICONS.editMode} label={t("Быстрая правка")} disabled={!editable || !items.length} onClick={() => (setMenu(null), setSheet("quickEdit"))} />
                <MenuItem icon={ICONS.receipt} label={t("Изменить детали счет фактуры")} onClick={() => (setMenu(null), setDialogError(""), setDialog("invoice"))} />
              </Menu>
            )}
          </div>
          <div className="relative">
            <HeaderButton icon={ICONS.discount} label={t("Скидка")} disabled={!editable || !items.length} onClick={() => setMenu(menu === "discount" ? null : "discount")} />
            {menu === "discount" && (
              <Menu onClose={() => setMenu(null)}>
                <MenuItem icon={ICONS.discount} label={t("Скидка")} onClick={() => setMenu("discountSize")} />
                <MenuItem icon={ICONS.discount} label={t("Частичная скидка")} onClick={() => (setMenu(null), setSheet("quickEdit"))} />
                <MenuItem icon={ICONS.discount} label={t("Ручная скидка")} onClick={() => (setMenu(null), setDialogError(""), setDialog("manualDiscount"))} />
                <MenuItem icon={ICONS.sync} label={t("Пересчитать")} onClick={() => (setMenu(null), setDialog("recalc"))} />
                <MenuItem icon={ICONS.trash} label={t("Отменить скидки")} onClick={() => (setMenu(null), setDialogError(""), setDialog("cancelDiscount"))} />
              </Menu>
            )}
            {menu === "discountSize" && (
              <DiscountSizePopover
                percent={discountShare}
                hasReturn={items.some((item) => (item.returnQuantity ?? 0) > 0)}
                onClose={() => setMenu(null)}
                onApply={(percent) => {
                  setMenu(null)
                  // Linko's «Отменить скидку» asks first (zeroDiscountDialog), like the menu's «Отменить скидки».
                  if (!percent) {
                    setDialogError("")
                    setDialog("cancelDiscount")
                    return
                  }
                  void applyDiscountPercent(percent).then((error) => error && onNotify(t(error)))
                }}
              />
            )}
          </div>
          <div className="relative">
            <HeaderButton icon={ICONS.undo} label={t("Возврат")} onClick={() => setMenu(menu === "return" ? null : "return")} />
            {menu === "return" &&
              (canReturn ? (
                <Menu onClose={() => setMenu(null)}>
                  <MenuItem
                    label={t("Полный возврат")}
                    onClick={() => (setMenu(null), setDialogError(""), setDialog("fullReturn"))}
                    iconNode={
                      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
                        <svg viewBox="0 0 122.88 80.23" y="4.2" width="24" height="15.7">
                          <path fill="#666" d={MONEY_BILLS_PATH} />
                        </svg>
                      </svg>
                    }
                  />
                  <MenuItem icon={ICONS.editMode} label={t("Быстрый возврат")} onClick={() => (setMenu(null), setSheet("quickReturn"))} />
                  <MenuItem
                    icon={ICONS.undo}
                    label={t("Частичный возврат")}
                    onClick={() => {
                      setMenu(null)
                      void partialReturnHref(order).then(onNavigate)
                    }}
                  />
                </Menu>
              ) : (
                <ReturnNotice onClose={() => setMenu(null)} />
              ))}
          </div>
          {/* Linko greys «Распечатать» of a cancelled order; its tooltip, 13 px to the left of the button, says «Распечатать»
              or «Заказ отменен вы не можете распечатать». */}
          <div className="group/print relative">
            <HeaderButton icon={ICONS.print} label={t("Распечатать")} disabled={status === "Отменен"} onClick={() => setMenu(menu === "print" ? null : "print")} />
            {menu !== "print" && (
              <span className="pointer-events-none absolute right-[calc(100%+13px)] top-[-2px] z-[120] hidden whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-normal leading-[16.9px] text-white opacity-90 group-hover/print:block">
                {t(status === "Отменен" ? "Заказ отменен вы не можете распечатать" : "Распечатать")}
              </span>
            )}
            {menu === "print" && (
              <PrintMenu
                onClose={() => setMenu(null)}
                onPick={(copies) => {
                  setMenu(null)
                  setPrintCopies(copies)
                  setSheet("printPreview")
                }}
              />
            )}
          </div>
          <button
            type="button"
            aria-label={t("Отменить")}
            disabled={!canCancel}
            onClick={() => (setDialogError(""), setDialog("cancelOrder"))}
            className="group relative flex h-12 w-12 items-center justify-center disabled:cursor-not-allowed"
          >
            {/* Linko: a dark #666 bin while it can cancel, a pale one when greyed. */}
            <Mi d={ICONS.trash} className={`h-5 w-5 ${canCancel ? "fill-[#666]" : "fill-black/[0.26]"}`} />
            <span className="pointer-events-none absolute right-[-27px] top-[58px] z-[120] hidden whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-normal leading-[16.9px] text-white opacity-90 group-hover:block">{t("Отменить")}</span>
          </button>
        </div>
      </div>

      {/* info columns */}
      <div className="flex border-b border-[#efefef] px-[15px]">
        <div className="w-1/3 border-r border-[#efefef] p-[15px]">
          <ul>
            {/* Linko: the shop name with the client's name in a tooltip; a click opens the shop card over the order. */}
            <li className="group/client relative flex min-h-[25px] items-start justify-between gap-3 leading-[25px]">
              <span>{t("Клиент")}:</span>
              <button
                type="button"
                disabled={!order.clientId}
                onClick={() => order.clientId && setShopId(order.clientId)}
                className="max-w-[50%] cursor-pointer text-right font-semibold text-[#1E4A9A] disabled:cursor-default"
              >
                {order.marketName || order.client}
              </button>
              <span className="pointer-events-none absolute left-[177px] top-[-14px] z-[20] hidden whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-semibold leading-[16.9px] text-white opacity-90 group-hover/client:block">
                {order.client}
              </span>
            </li>
            {row(`${t("Транспорт")}:`, order.transportNumber || t("Не указан"))}
            {row(`${t("Филиал")}:`, order.branchName || order.clientBranch || t("Не указан"))}
            {row(`${t("Склад")}:`, order.warehouse || order.stockName || t("Не указан"), order.warehouse || order.stockName ? "" : "text-[#e57373]")}
            {row(`${t("Договор")}:`, order.contract || invoiceContract || t("Не указан"))}
            {row(`${t("Счет фактура")}:`, invoiceActive ? t("Активный") : t("Не активный"), invoiceActive ? "text-[#81c784]" : "text-[#e57373]")}
            {row(`${t("Номер счет фактура")}:`, invoiceNumber || t("Не указан"))}
            {row(`${t("Дата счет фактуры")}:`, invoiceDate ? t(displayDay(invoiceDate)) : t("Не указан"))}
          </ul>
        </div>
        <div className="w-1/3 border-r border-[#efefef] p-[15px]">
          <ul>
            {row(`${t("Прайс-лист")}:`, order.priceList || t("Не указан"))}
            {/* Linko's DIVISIONS setting (on for this account): the order's division, only when it has one. Linko leaves
                «Дата окончательной оплаты» blank without a date. */}
            {orderOrganization(order) && row(`${t("Организация")}:`, orderOrganization(order))}
            {row(`${t("Дата окончательной оплаты")}:`, payDay ? t(displayDay(payDay)) : "")}
            {row(`${t("Тип оплаты")}:`, paymentTypeLabel ? t(paymentTypeLabel) : t("Не указан"))}
            {/* Linko's total_price: the exact sum of the lines (0,37093 USD), not the list's 2-decimal amount text. */}
            {row(t("Общая стоимость"), items.length ? `${formatNumber(items.reduce((sum, item) => sum + item.lineTotal, 0))} ${currency}` : order.linesTotal !== undefined ? `${formatNumber(order.linesTotal)} ${currency}` : order.amount)}
            {order.discount && row(t("Скидка"), order.discount, "text-[#278549]")}
            {row(
              `${t("Оплачено")}:`,
              !due ? (
                "…"
              ) : paid ? (
                <button type="button" onClick={() => setPaymentsOpen(true)} className="cursor-pointer border-b border-dashed border-[#1E4A9A] font-semibold text-[#1E4A9A]">
                  {dueLine("paid")}
                </button>
              ) : (
                dueLine("paid")
              ),
            )}
            {/* Linko: red while something remains, green once nothing does. */}
            {row(`${t("Остаток")}:`, due ? dueLine("remaining") : "…", !due ? "" : due.currencies.some((entry) => entry.remaining > 0) ? "text-[#e57373]" : "text-[#81c784]")}
            <li className="flex min-h-[25px] items-center justify-between gap-3 font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#1E4A9A]" />
                {t("Оперативный долг клиента")}:
              </span>
              <span className="text-right">{detail ? debtLines(debt?.operative) : "…"}</span>
            </li>
            <li className="flex min-h-[25px] items-center justify-between gap-3 font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#1E4A9A]" />
                {t("Фактический долг клиента")}:
              </span>
              <span className="text-right">{detail ? debtLines(debt?.actual) : "…"}</span>
            </li>
          </ul>
        </div>
        <div className="w-1/3 px-[15px] pb-5 pt-[15px]">
          <ul>
            {/* Linko's «Создал» is the order's user, who is its agent (no separate «Агент» row); the name also shows in a tooltip. */}
            {/* Linko: the tooltip sits 12 px to the left of the name, centred on it. */}
            <li className="flex min-h-[25px] items-start justify-between gap-3 leading-[25px]">
              <span>{t("Создал")}:</span>
              <span className="group/author relative max-w-[50%] text-right font-semibold">
                {order.agent || order.createdBy || t("Не указано")}
                {(order.agent || order.createdBy) && (
                  <span className="pointer-events-none absolute right-[calc(100%+12px)] top-1/2 z-[20] hidden -translate-y-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-semibold leading-[16.9px] text-white opacity-90 group-hover/author:block">
                    {order.agent || order.createdBy}
                  </span>
                )}
              </span>
            </li>
            {row(`${t("Доставщик")}:`, deliverer || t("Не указан"))}
            {row(`${t("Экспедитор")}:`, order.expeditor || t("Не указано"))}
            {row(t("Дата создания"), t(createdDate))}
            {row(`${t("Дата реализации")}:`, realizedDay ? t(fromInputDate(realizedDay)) : t("Не реализовано"))}
            {row(`${t("Текущий статус")}:`, t(status === "Доставлено" ? "Доставлен" : status === "В пути" ? "Передан доставщику" : status), statusColor)}
            {row(`${t("Тип передачи")}:`, deliveryTypeLabel ? t(deliveryTypeLabel) : t("Не указано"))}
            {/* Linko shows «Дата доставки» only when the order has one. */}
            {order.delivery && row(`${t("Дата доставки")}:`, t(displayDay(order.delivery)))}
            {row(`${t("Тип сделки")}:`, t(dealLabel))}
            {invoiceActive && invoiceNumber && row(`${t("Статус отправки")}:`, t("Заполнено"))}
            {order.comment && row(`${t("Комментарий")}:`, order.comment)}
          </ul>
          {order.wrongDebt && (
          <div>
            <b className="block leading-[25px] text-[#e57373]">{t("У этого клиента остаток, требуется перасчет")}</b>
            <button
              type="button"
              onClick={() => onNavigate("/analytics/client-debts")}
              className="mt-[5px] flex h-[30px] w-full items-center justify-center rounded-[5px] bg-[#1E4A9A] text-[13px] font-semibold text-white hover:brightness-95"
            >
              {t("Пересчитать")}
            </button>
          </div>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="px-[30px] pb-5">
        <div className="relative grid border-b border-[#f2f5f8]" style={{ gridTemplateColumns: TAB_COLUMNS.map((width) => `${width}fr`).join(" ") }}>
          {TABS.map((label, index) => (
            <button key={label} type="button" onClick={() => label !== tab && (setTab(label), setTabInUrl(true))} className="h-12 text-left text-[13px] font-medium text-black">
              <span className="block text-center" style={{ width: `${(TAB_COLUMNS[0] / TAB_COLUMNS[index]) * 100}%` }}>
                {t(label)}
              </span>
            </button>
          ))}
          <span
            className="absolute -bottom-[1px] h-[2px] bg-[#1E4A9A] transition-all duration-300"
            style={{ left: `${tabIndex * 20}%`, width: "20%" }}
          />
        </div>

        {tab === "Список товаров" && (
          <>
            {/* Linko's «Список товаров» has no add row: lines are added in «Изменить». */}
            <ItemsTable items={items} loading={itemsLoading} />
          </>
        )}
        {tab === "Серии" && <OrderSeriesTab orderId={order.id} refreshKey={items.map((item) => [item.id, item.quantity])} />}
        {/* Linko's «Возврат» tab: Причина возврата (the return's comment) | Склад | Дата возврата | Сумма (<currency>) |
            status; a row opens the return in a new tab. */}
        {tab === "Возврат" &&
          (returns.length ? (
            <div className="pb-[10px]">
              <div className={`${DOTTED_ROW} font-semibold`}>
                <span className="text-left">{t("Причина возврата")}</span>
                <span className="text-left">{t("Склад")}</span>
                <span>{t("Дата возврата")}</span>
                <span>{`${t("Сумма")} (${currency})`}</span>
                <span />
              </div>
              {returns.map((entry) => (
                <a key={entry.id} href={`/analytics/returns/${entry.id}?search=${entry.id}`} target="_blank" rel="noopener noreferrer" className={`${DOTTED_ROW} hover:bg-[#fafafa]`}>
                  <span className="truncate text-left">{entry.comment ?? ""}</span>
                  <span className="truncate text-left">{entry.warehouse}</span>
                  <span>{t(displayDay(entry.returnDate.slice(0, 10)))}</span>
                  <span>{formatNumber(entry.amount)}</span>
                  <span className={entry.status === "accepted" ? "text-[#81c784]" : entry.status === "cancelled" ? "text-[#e57373]" : "text-[#f0ad4e]"}>
                    {t(entry.status === "accepted" ? "Принят" : entry.status === "cancelled" ? "Отменен" : "Ожидает")}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <Robot overlay text={t("В данном заказе нет возвратов")} />
          ))}
        {/* Linko's «Задействованные акции»: № акции | Наименование | Тип акции; a row opens the promotion in a new tab. */}
        {tab === "Задействованные акции" &&
          (promotions === null ? (
            <div className="h-[120px]" />
          ) : promotions.length ? (
            <div className="pb-[10px]">
              <div className={`${DOTTED_ROW_PROMO} font-semibold`}>
                <span className="text-left">{t("№ акции")}</span>
                <span className="text-left">{t("Наименование")}</span>
                <span>{t("Тип акции")}</span>
              </div>
              {promotions.map((promotion) => (
                <a
                  key={promotion.id}
                  href={`/analytics/marketing-campaigns?search=${encodeURIComponent(promotion.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${DOTTED_ROW_PROMO} hover:bg-[#fafafa]`}
                >
                  <span className="text-left">№ {promotion.id}</span>
                  <span className="truncate text-left">{promotion.name}</span>
                  <span>{promotion.type ? t(promotion.type) : t("Не указано")}</span>
                </a>
              ))}
            </div>
          ) : (
            <Robot overlay text={t("Для этого заказа нет акций")} />
          ))}
        {tab === "Логи" && (
          <div>
            <div className="mt-[10px] flex w-full items-end justify-end">
              <button
                type="button"
                onClick={() => setDialog("logDetails")}
                className="mr-2 flex h-[30px] items-center rounded-[5px] bg-[#1E4A9A] px-4 text-[13px] font-semibold text-white"
              >
                {t("Детали изменений заказа")}
              </button>
            </div>
            <div className="flex flex-col pt-[15px]">
              {logs.map((log) => {
                const action = LOG_ACTIONS[log.action]
                const status = LOG_STATUS[log.status]
                const tone = action?.tone === "begin" ? "border-[#64b5f6] text-[#64b5f6]" : action?.tone === "error" ? "border-[#e57373] text-[#e57373]" : "border-[#81c784] text-[#81c784]"
                return (
                  <div key={log.id} className="mb-5 grid grid-cols-2 gap-y-[7px] rounded-[10px] border border-[#e5e8f1] bg-[#fbfbfb] p-5 [&_p]:leading-[26px]">
                    <div className="flex">
                      <div className="flex items-center">
                        <span className="font-semibold">{t("Заказ")}:</span>
                        {action ? (
                          <span className="whitespace-nowrap rounded-[15px] px-[7px] py-px">
                            <span className={`whitespace-nowrap rounded-[15px] border px-[7px] py-px ${tone}`}>{t(action.label)}</span>
                          </span>
                        ) : (
                          t("Не установлен")
                        )}
                      </div>
                      {status && (
                        <div className="ml-[10px] flex items-center">
                          <span className="font-semibold">{t("Статус")}:</span>
                          <div>
                            <div className="flex items-center">
                              <span className="flex h-[33px] w-[33px] items-center justify-center">
                                <StatusIcon status={status.status} color={status.color} size={23} />
                              </span>
                              <span>{t(status.label)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-start">
                      <p>
                        <span className="font-semibold">{t("Кем")}:</span> {log.createdBy}
                      </p>
                      <div className="ml-5 flex items-center">
                        <span className="font-semibold">{t("Когда")}:</span>
                        <p className="ml-[5px]">{t(formatLogDate(log.createdAt))}</p>
                      </div>
                      <div className="ml-[10px] flex items-center">
                        <span className="mr-[5px] font-semibold">{t("Сумма")}:</span> {formatNumber(log.totalPrice)} {log.currency}
                      </div>
                    </div>
                    {log.comment && (
                      <div className="col-span-full flex items-center">
                        <span className="mr-[5px] font-semibold">{t("Комментарий")}:</span>
                        <p>{t(log.comment)}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* dialogs */}
      {dialog === "status" && (
        <StatusDialog
          orderId={order.id}
          current={status}
          initial={statusTarget}
          error={dialogError}
          onClose={() => setDialog(null)}
          onApply={async (next, deliveryDate, transferDate) => {
            const ok = await patchOrder(
              { status: next, ...(deliveryDate ? { delivery: deliveryDate } : {}), ...(transferDate ? { acceptedDate: transferDate } : {}) },
              `${t("Статус заказа изменён:")} ${t(next)}`,
            )
            if (ok) setDialog(null)
          }}
        />
      )}
      {dialog === "invoice" && (
        <InvoiceDialog
          order={order}
          onClose={() => setDialog(null)}
          onSave={async (patch) => {
            if (await patchOrder(patch, t("Детали счет фактуры сохранены"))) {
              addLog("updated")
              setDialog(null)
            }
          }}
        />
      )}
      {dialog === "manualDiscount" && (
        <ManualDiscountDialog
          orderId={order.id}
          error={dialogError}
          onClose={() => setDialog(null)}
          onApply={async (promotion) => {
            // The promotion's own percents: per listed product, else its one discount on every line.
            const percents = new Map(promotion.products.map((entry) => [entry.productId, entry.percent]))
            const lines = items
              .map((item) => ({ item, percent: promotion.products.length ? (item.productId !== null ? percents.get(item.productId) : undefined) : promotion.discount }))
              .filter((line): line is { item: OrderLineItem; percent: number } => line.percent !== undefined)
            if (!lines.length) return setDialogError(t("В заказе нет товаров этой акции"))
            for (const line of lines) {
              const error = await putDiscounts(order.id, [line.item], line.percent)
              if (error) return setDialogError(t(error))
            }
            addLog("add_discount")
            reloadAll()
            setDialog(null)
          }}
        />
      )}
      {dialog === "recalc" && (
        <DialogShell
          title={t("Пересчитать скидочные акции")}
          height={327}
          onClose={() => setDialog(null)}
          action={t("Да")}
          onAction={() => {
            setDialog(null)
            reloadAll()
            onNotify(t("Скидочные акции пересчитаны"))
          }}
        >
          <ConfirmText>{t("Подтверждение запроса")}</ConfirmText>
          <ConfirmStrip>
            {t("Выбранные заказы:")} №{order.id}
          </ConfirmStrip>
        </DialogShell>
      )}
      {dialog === "cancelDiscount" && (
        <DialogShell
          title={t("Подтверждение отмены")}
          height={327}
          onClose={() => setDialog(null)}
          action={t("Да")}
          error={dialogError}
          onAction={async () => {
            const error = await applyDiscountPercent(0)
            if (error) return setDialogError(t(error))
            setDialog(null)
          }}
        >
          <ConfirmText>{t("Вы уверены что хотите отменить эти данные?")}</ConfirmText>
          <ConfirmStrip>{t("Отменить скидку")}</ConfirmStrip>
        </DialogShell>
      )}
      {dialog === "fullReturn" && (
        <FullReturnDialog
          order={order}
          error={dialogError}
          onClose={() => setDialog(null)}
          onConfirm={async (returnDate) => {
            // Every line not returned yet goes back as one client return (Продажи → Возвраты): the stock and
            // the client balance change when it is accepted into the warehouse.
            const result = await api<{ id: number }>("/api/client-returns", {
              method: "POST",
              body: { clientId: order.clientId ?? undefined, client: order.clientId ? undefined : order.client, orderId: order.id, warehouse: order.warehouse || undefined, returnDate, full: true },
            })
            if (!result.ok) return setDialogError(t(result.error))
            setDialog(null)
            addLog("updated", "Оформлен полный возврат")
            loadExtras()
            onNotify(`${t("Возврат оформлен")}: №${result.body.id}. ${t("Примите его на склад в разделе «Возвраты»")}`)
          }}
        />
      )}
      {dialog === "cancelOrder" && (
        <DialogShell
          title={t("Подтверждение отмены")}
          height={327}
          onClose={() => setDialog(null)}
          action={t("Да")}
          onAction={async () => {
            if (await patchOrder({ status: "Отменен" }, `${t("Статус заказа изменён:")} ${t("Отменен")}`)) setDialog(null)
          }}
        >
          <ConfirmText>{t("Вы уверены что хотите отменить эти данные?")}</ConfirmText>
          <ConfirmStrip>
            {t("Заказ")}№ {order.id}
          </ConfirmStrip>
        </DialogShell>
      )}
      {paymentsOpen && <OrderPaymentsDialog orderId={order.id} onClose={() => setPaymentsOpen(false)} />}
      {dialog === "logDetails" && <LogDetailsSheet orderId={order.id} logs={logs} onClose={() => setDialog(null)} />}

      {/* full-screen sheets */}
      {sheet === "edit" && !itemsLoading && (
        <AddOrderDialog
          edit={{
            order,
            items: items.map((item) => ({ id: item.id, productId: item.productId ?? undefined, productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent, boxAmount: item.boxAmount, boxUnit: item.boxUnit })),
          }}
          onClose={() => setSheet(null)}
          onCreated={() => setSheet(null)}
          onSaved={() => {
            // The form saved the order and its lines itself (the server checked every change).
            addLog("updated")
            setSheet(null)
            void loadItems()
            loadExtras()
            refreshOrder(order.id)
            onNotify(t("Заказ обновлён"))
          }}
        />
      )}
      {sheet === "quickEdit" && !itemsLoading && (
        <QuickEditSheet
          order={order}
          items={items}
          onClose={() => setSheet(null)}
          onSaved={() => {
            addLog("updated")
            setSheet(null)
            reloadAll()
            onNotify(t("Изменения сохранены"))
          }}
        />
      )}
      {sheet === "quickReturn" && (
        <QuickReturnSheet
          order={order}
          items={items}
          onClose={() => setSheet(null)}
          onSaved={(id) => {
            addLog("updated", "Оформлен быстрый возврат")
            setSheet(null)
            loadExtras()
            onNotify(`${t("Возврат оформлен")}: №${id}. ${t("Примите его на склад в разделе «Возвраты»")}`)
          }}
        />
      )}
      {sheet === "printPreview" && createPortal(<PrintSheet order={order} items={items} debt={debt} copies={printCopies} onClose={() => setSheet(null)} />, document.body)}
      {!!shopId &&
        createPortal(<ClientDrawer key={shopId} clientId={shopId} onClose={closeShop} editHref={`/clients?openShop=${shopId}&openUpdateDialog=true`} />, document.body)}
    </div>
  )
}

/**
 * «Частичный возврат» → Linko's #/return?c=<client>&m=<shop>&o=<order>&s=<warehouse>&d=<delivery man>&openCreateDialog=true:
 * the returns page opens «Добавление возврата» for the order with its warehouse and delivery man already chosen.
 * Here the client and the shop are one record; the warehouse and the delivery man are found by the order's names.
 */
async function partialReturnHref(order: Order): Promise<string> {
  const params = new URLSearchParams()
  if (order.clientId) {
    params.set("c", String(order.clientId))
    params.set("m", String(order.clientId))
  }
  params.set("o", String(order.id))
  params.set("openCreateDialog", "true")
  const same = (a: unknown, b: string) => String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase()
  const warehouse = order.warehouse || order.stockName || ""
  const [stocks, people] = await Promise.all([
    warehouse ? api<Array<{ id: number; name: string }>>("/api/warehouses") : null,
    order.deliveryMan ? api<Array<Record<string, unknown>>>("/api/employees") : null,
  ])
  const stock = stocks?.ok && Array.isArray(stocks.body) ? stocks.body.find((row) => same(row.name, warehouse)) : undefined
  if (stock) params.set("s", String(stock.id))
  const man = people?.ok && Array.isArray(people.body) ? people.body.find((row) => same(employeeName(row), order.deliveryMan ?? "")) : undefined
  if (man && typeof man.id === "number") params.set("d", String(man.id))
  params.sort()
  return `/analytics/returns?${params}`
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

export function StatusIcon({ status, color, size = 20 }: { status: string; color?: string; size?: number }) {
  const item = STATUS_MENU.find((entry) => entry.status === status) ?? STATUS_MENU[0]
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} aria-hidden>
      <path d={item.icon} fill={color ?? item.color} />
    </svg>
  )
}

/** "Детали изменений заказа": one column per log entry that changed products, one block per product. */
export function LogDetailsSheet({ orderId, logs, onClose }: { orderId: number; logs: ApiOrderLog[]; onClose: () => void }) {
  const { t } = useLanguage()
  const [show, setShow] = useState({ amount: true, price: true, total: true })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const columns = logs.filter((log) => log.products.length > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const products: { key: string; name: string }[] = []
  for (const log of columns) {
    for (const product of log.products) {
      const key = String(product.productId ?? product.name)
      if (!products.some((entry) => entry.key === key)) products.push({ key, name: product.name })
    }
  }
  const lineOf = (log: ApiOrderLog, key: string) => log.products.find((product) => String(product.productId ?? product.name) === key)
  const rows = [
    { key: "amount" as const, label: "Кол-во", color: "", value: (line: NonNullable<ReturnType<typeof lineOf>>) => `${formatNumber(line.amount)} ${t("шт.")}` },
    { key: "price" as const, label: "Цена", color: "#129fdd", value: (line: NonNullable<ReturnType<typeof lineOf>>, log: ApiOrderLog) => `${formatNumber(line.price)} ${log.currency}` },
    { key: "total" as const, label: "Сумма", color: "#48a34b", value: (line: NonNullable<ReturnType<typeof lineOf>>, log: ApiOrderLog) => `${formatNumber(line.total)} ${log.currency}` },
  ].filter((row) => show[row.key])
  const cellClass = "border border-[#e8eaf6] px-[10px] py-[14px] text-center"

  return (
    <div data-order-overlay className="fixed inset-x-0 bottom-0 top-[50px] z-[120] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[59px] shrink-0 items-center border-b border-[#efefef] px-[30px]">
        <h3 className="text-[13px] font-bold uppercase leading-4">
          {t("Детали изменений заказа")} № {orderId}
        </h3>
        <div className="ml-[430px] flex items-center gap-[30px]">
          {([["amount", "Количество"], ["price", "Цена"], ["total", "Сумма"]] as const).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold uppercase">
              <input type="checkbox" checked={show[key]} onChange={() => setShow((current) => ({ ...current, [key]: !current[key] }))} className="h-[18px] w-[18px] accent-[#5d6474]" />
              {t(label)}
            </label>
          ))}
        </div>
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="ml-auto">
          <Mi d={ICONS.close} className="h-6 w-6 fill-[#666]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {columns.length === 0 || products.length === 0 ? (
          <div className="pt-[60px] text-center text-[#666]">{t("Нет данных по истории")}...</div>
        ) : (
          <table className="border-collapse" style={{ tableLayout: "fixed", width: 450 + columns.length * 200 }}>
            <colgroup>
              <col style={{ width: 50 }} />
              <col style={{ width: 250 }} />
              <col style={{ width: 150 }} />
              {columns.map((log) => <col key={log.id} style={{ width: 200 }} />)}
            </colgroup>
            <thead>
              <tr className="bg-[#fafafa] font-semibold">
                <th colSpan={3} className={`${cellClass} font-normal`}>{t("Время изменений")}</th>
                {columns.map((log) => <th key={log.id} className={`${cellClass} font-normal`}>{t(formatLogDate(log.createdAt))}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                ["Клиент", (log: ApiOrderLog) => log.market],
                ["Изменил", (log: ApiOrderLog) => log.createdBy],
                ["Тип оплаты", (log: ApiOrderLog) => log.payType],
                ["Статус", (log: ApiOrderLog) => {
                  const status = LOG_STATUS[log.status]
                  return status ? <span style={{ color: status.color, fontWeight: 600 }}>{t(status.label)}</span> : null
                }],
              ] as const).map(([label, value], index) => (
                <tr key={label} className={index % 2 === 0 ? "bg-[#fafafa]" : ""}>
                  <td colSpan={3} className={`${cellClass} font-semibold`}>{t(label)}</td>
                  {columns.map((log) => <td key={log.id} className={cellClass}>{value(log)}</td>)}
                </tr>
              ))}
              <tr className="bg-[#fafafa] font-semibold">
                <td colSpan={3} className={cellClass}>{t("Продукты")}</td>
                <td colSpan={columns.length} className={cellClass} />
              </tr>
            </tbody>
            {rows.length > 0 &&
              products.map((product, index) => (
                <tbody key={product.key} className={index % 2 === 0 ? "" : "bg-[#fafafa]"}>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.key}>
                      {rowIndex === 0 && <td rowSpan={rows.length} className={cellClass}>{index + 1}</td>}
                      {rowIndex === 0 && <td rowSpan={rows.length} className={`${cellClass} font-semibold`}>{product.name}</td>}
                      <td className="border border-[#e8eaf6] px-[10px] py-[6px] text-left font-semibold">{t(row.label)}</td>
                      {columns.map((log) => {
                        const line = lineOf(log, product.key)
                        return (
                          <td key={log.id} className="border border-[#e8eaf6] px-[10px] py-[6px] text-right">
                            {line ? <span style={{ fontWeight: 600, color: row.color }}>{row.value(line, log)}</span> : ""}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
          </table>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Items table                                                         */
/* ------------------------------------------------------------------ */

/** The items table's sortable columns (Linko's ordering keys). */
type ItemSortKey = "productName" | "amount" | "total" | "totalWeight" | "returnAmount" | "price" | "productTotal" | "discount"
type ItemSort = { key: ItemSortKey; desc: boolean } | null

/** A sortable header: both arrows while unsorted, only the active one once the column orders the rows (Linko). */
function SortHead({ children, width, name, sort, onSort }: { children: ReactNode; width?: string; name: ItemSortKey; sort: ItemSort; onSort: (key: ItemSortKey) => void }) {
  const active = sort?.key === name ? sort : null
  return (
    <th style={width ? { width } : undefined} onClick={() => onSort(name)} className="cursor-pointer select-none whitespace-nowrap bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold text-[#374557]">
      <span className="flex items-center">
        {children}
        <span className="flex h-5 w-5 flex-col justify-center">
          {(!active || !active.desc) && <svg viewBox="0 0 24 24" className={`ml-[5px] h-[15px] w-[15px] fill-[#888] ${active ? "" : "-mb-[5px]"}`}><path d="M7 14l5-5 5 5z" /></svg>}
          {(!active || active.desc) && <svg viewBox="0 0 24 24" className={`ml-[5px] h-[15px] w-[15px] fill-[#888] ${active ? "" : "-mt-[5px]"}`}><path d="M7 10l5 5 5-5z" /></svg>}
        </span>
      </span>
    </th>
  )
}

/** "0 тонна (+1 кг)": whole blocks of `boxAmount` units, the remainder in the product's own unit (Linko: a 12 px span
 * 4 px after the blocks). */
function blockLabel(quantity: number, unit: string, boxAmount?: number, boxUnit?: string): ReactNode {
  if (!boxAmount || boxAmount <= 0 || !boxUnit) return "0"
  const blocks = Math.floor(quantity / boxAmount)
  const rest = Math.round((quantity - blocks * boxAmount) * 1000) / 1000
  return (
    <>
      {blocks} {boxUnit}
      {rest > 0 && <span className="ml-[4px] text-[12px]">(+{formatNumber(rest)} {unit})</span>}
    </>
  )
}

/** Linko prints line prices and sums with up to 8 decimals (those of Настройки → Округление сумм when set). */
function formatPrice(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: amountDigits(8) })
}

/** A line's price after its discount (the stored price is the one before it). */
const salePrice = (item: OrderLineItem) => item.unitPrice * (1 - item.discountPercent / 100)
/** What the discount takes off the line (a bonus line, given for free, shows 0 like Linko). */
const lineDiscount = (item: OrderLineItem) => (item.isBonus ? 0 : item.quantity * item.unitPrice - item.lineTotal)

const SORT_VALUE: Record<ItemSortKey, (item: OrderLineItem) => number | string> = {
  productName: (item) => item.productName,
  amount: (item) => item.quantity,
  total: (item) => (item.boxAmount && item.boxAmount > 0 ? item.quantity / item.boxAmount : 0),
  totalWeight: () => 0,
  returnAmount: (item) => item.returnQuantity ?? 0,
  price: salePrice,
  productTotal: (item) => item.lineTotal,
  discount: lineDiscount,
}

function ItemsTable({ items, loading }: { items: OrderLineItem[]; loading: boolean }) {
  const { t } = useLanguage()
  // Linko: a header click orders the lines descending, the next ascending, the third goes back to the order's own.
  const [sort, setSort] = useState<ItemSort>(null)
  const onSort = (key: ItemSortKey) => setSort((current) => (current?.key !== key ? { key, desc: true } : current.desc ? { key, desc: false } : null))
  const rows = useMemo(() => {
    if (!sort) return items
    const value = SORT_VALUE[sort.key]
    return [...items].sort((a, b) => {
      const x = value(a)
      const y = value(b)
      const order = typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y), "ru") : x - y
      return sort.desc ? -order : order
    })
  }, [items, sort])
  const totals = items.reduce(
    (sum, item) => ({
      total: sum.total + item.lineTotal,
      discount: sum.discount + item.quantity * item.unitPrice - item.lineTotal,
      returned: sum.returned + (item.returnQuantity ?? 0),
    }),
    { total: 0, discount: 0, returned: 0 },
  )
  // Quantities are totalled per unit (never one sum over kg and pieces).
  const quantityTotals = formatUnitTotals(items.map((item) => ({ qty: item.quantity, unit: item.unit })), t)
  const returnedTotals = formatUnitTotals(items.map((item) => ({ qty: item.returnQuantity ?? 0, unit: item.unit })), t)
  const currency = items[0]?.currency || ""

  const cell = "border-b border-r border-[#efefef] px-[17.5px] py-[8px] align-middle"
  const head = { sort, onSort }

  return (
    <div className="border-l border-[#efefef]">
      <table className="w-full table-auto border-collapse">
        <thead>
          <tr>
            <th className="bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold text-[#374557]">№</th>
            <SortHead width="30%" name="productName" {...head}>{t("Товар")}</SortHead>
            <SortHead name="amount" {...head}>{t("Количество")}</SortHead>
            <SortHead name="total" {...head}>{t("Блок")}</SortHead>
            <SortHead name="totalWeight" {...head}>{t("Кг.")}</SortHead>
            <SortHead name="returnAmount" {...head}>{t("Возврат")}</SortHead>
            <SortHead name="price" {...head}>{`${t("Цена")} ${currency}`}</SortHead>
            <SortHead name="productTotal" {...head}>{`${t("Сумма")} ${currency}`}</SortHead>
            <SortHead name="discount" {...head}>{`${t("Скидка")} (${currency})`}</SortHead>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={9} className="p-6 text-center text-[#888]">
                {t("Загрузка...")}
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={9} className="p-6 text-center text-[#888]">
                {t("Товары не добавлены")}
              </td>
            </tr>
          ) : (
            rows.map((item, index) => (
              <tr key={item.id}>
                {/* Linko numbers the lines in the order they are shown. */}
                <td className={cell}>{index + 1}</td>
                <td className={cell}>
                  {item.productName}
                  {item.isBonus && <strong className="font-semibold text-[#81c784]"> ({t("бонус")})</strong>}
                  {item.article && <span title={`${t("Артикул")}: ${item.article}`} className="block text-[#1E4A9A]">{item.article}</span>}
                </td>
                <td className={cell}>
                  {formatNumber(item.quantity)} {t(item.unit)}
                </td>
                <td className={cell}>{blockLabel(item.quantity, t(item.unit), item.boxAmount, item.boxUnit && t(item.boxUnit))}</td>
                <td className={cell}>0</td>
                <td className={`${cell} ${(item.returnQuantity ?? 0) > 0 ? "text-[#e57373]" : ""}`}>{(item.returnQuantity ?? 0) > 0 ? "- " : ""}{formatNumber(item.returnQuantity ?? 0)} {t(item.unit)}</td>
                {/* Linko: the price after the discount, then the price before it in blue while a discount applies. */}
                <td className={cell}>
                  {formatPrice(salePrice(item))}
                  {item.discountPercent > 0 && item.unitPrice > 0 && (
                    <span title={t("Цена без скидки")} className="block text-[#1E4A9A]">
                      {formatPrice(item.unitPrice)}
                    </span>
                  )}
                </td>
                <td className={cell}>{formatPrice(item.lineTotal)}</td>
                {/* Linko: what the discount takes off the line (0 for a bonus line), then its percent in blue. */}
                <td className={cell}>
                  {formatNumber(lineDiscount(item))}
                  {item.discountPercent > 0 && (
                    <span title={t("Процент скидки")} className="block text-[#1E4A9A]">
                      {formatPrice(item.discountPercent)} %
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
          {!loading && items.length > 0 && (
            <tr className="text-[15px] font-semibold">
              <td colSpan={2} className="border-b border-r border-[#efefef] px-[17.5px] py-[8px]">
                {t("Итого")}:
              </td>
              <td className="border-b border-r border-[#efefef] px-[17.5px] py-[8px]">
                {quantityTotals}
              </td>
              <td className="border-b border-r border-[#efefef]" />
              <td className="border-b border-r border-[#efefef] px-[17.5px]">0</td>
              <td className={`border-b border-r border-[#efefef] px-[17.5px] ${totals.returned > 0 ? "text-[#e57373]" : ""}`}>{totals.returned > 0 ? "- " : ""}{returnedTotals}</td>
              <td className="border-b border-r border-[#efefef]" />
              <td className="border-b border-r border-[#efefef] px-[17.5px]">{formatPrice(totals.total)}</td>
              <td className="border-b border-r border-[#efefef] px-[17.5px]">{formatNumber(totals.discount)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}


/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

/**
 * "Размер скидки / OK" popover under the Скидка button (the reference's first discount menu item). Like Linko the field
 * hints the order's current discount (100 × discount / (total + discount), "9,091"), right-aligned before a "%", and an
 * order with a discount also gets the red «Отменить скидку», which takes it off at once.
 */
function DiscountSizePopover({ percent, hasReturn, onClose, onApply }: { percent: number; hasReturn: boolean; onClose: () => void; onApply: (percent: number) => void }) {
  const { t } = useLanguage()
  const [value, setValue] = useState("")
  const submit = () => {
    // Linko offers no OK while the order has a return (its lines' return_amount add up to more than 0).
    if (hasReturn) return onClose()
    const next = strictNumber(value, { locale: true })
    if (next > 0 && next <= 100) onApply(next)
    else onClose()
  }
  // Linko's OrderSetDiscountForm: 10 px padding (20 px on the left), the hint in the amount precision, no "%" sign; an
  // order with a return gets the red notice before the field and no OK.
  return (
    <>
      <button type="button" data-order-overlay aria-label={t("Закрыть")} onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
      <div className="absolute right-[-26px] top-[38.3px] z-[115] h-[72px] rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <span className="absolute right-[35px] top-[-7px] h-[14px] w-[14px] rotate-45 bg-white shadow-[-2px_-2px_4px_rgba(0,0,0,0.06)]" />
        <div className="relative flex h-full items-start overflow-hidden whitespace-nowrap rounded-[2px] bg-white pl-5 pr-[10px]">
          {hasReturn && <span className="mr-5 mt-[32px] text-[13px] leading-4 text-[#e57373]">{t("У этого заказа есть возврат пожалуйста с начало отмените возврат")}</span>}
          <label className="relative block h-full w-[110px]">
            <span className="absolute left-0 top-[11px] text-[9.75px] font-semibold leading-[12.2px] text-black">{t("Размер скидки")}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={value}
              placeholder={formatNumber(percent)}
              onChange={(event) => setValue(event.target.value.replace(/[^\d.,]/g, ""))}
              onKeyDown={(event) => event.key === "Enter" && submit()}
              className="absolute inset-x-0 top-[28px] h-[24px] bg-transparent text-right text-[13px] font-semibold text-[#333] outline-none placeholder:font-normal placeholder:text-black/30"
            />
            <span className="absolute inset-x-0 top-[52px] h-px bg-[#e0e0e0]" />
          </label>
          {!hasReturn && (
            <button type="button" onClick={submit} className="ml-[8px] mt-[22px] h-9 min-w-[50px] text-center">
              <span className="text-[13px] font-semibold leading-[18px] text-[#1E4A9A]">OK</span>
            </button>
          )}
          {percent > 0 && (
            <button type="button" onClick={() => onApply(0)} className="ml-[8px] mt-[22px] h-9 px-4 text-[13px] font-semibold uppercase leading-[18px] text-[#e57373]">
              {t("Отменить скидку")}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/** "9,091": a number with a decimal comma and at most `digits` fraction digits (Linko's percent hints). */
function formatDecimal(value: number, digits: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: digits })
}

/** Shown instead of the return menu while the goods are still in the warehouse. */
function ReturnNotice({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <>
      <button type="button" data-order-overlay aria-label={t("Закрыть")} onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
      <div className="absolute right-0 top-[38px] z-[115] w-[260px] rounded-[2px] bg-white px-5 py-4 text-[13px] font-semibold leading-[18px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        {t("Вы можете создать возврат после реализации со склада")}
      </div>
    </>
  )
}

/** "23 октября 2026 г." — how the reference's date pickers print a YYYY-MM-DD value. */
function longRuDate(value: string) {
  if (!value) return ""
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

/** Grey strip under a confirmation text (full dialog width). */
function ConfirmStrip({ children }: { children: ReactNode }) {
  return <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-5 text-[13px] font-semibold leading-[16.3px]">{children}</div>
}

function ConfirmText({ children }: { children: ReactNode }) {
  return <div className="py-5 text-[13px] leading-[16.3px]">{children}</div>
}

function StatusDialog({
  orderId,
  current,
  initial,
  error,
  onClose,
  onApply,
}: {
  orderId: number
  current: string
  initial: string
  error?: string
  onClose: () => void
  onApply: (status: string, deliveryDate?: string, transferDate?: string) => void
}) {
  const { t } = useLanguage()
  const [status, setStatus] = useState(initial)
  const [changeDelivery, setChangeDelivery] = useState(false)
  const [changeTransfer, setChangeTransfer] = useState(false)
  // Linko opens both date fields empty (the picker starts on today); an unpicked date changes nothing.
  const [date, setDate] = useState("")
  const [transferDate, setTransferDate] = useState("")
  const options = ORDER_STATUS_OPTIONS.filter((value) => value === current || canChangeStatus(current, value))
  // Linko's labels of the six statuses («Не подтвержденный», «Передан доставщику», «Доставлен»).
  const label = (value: string) => t(STATUS_MENU.find((item) => item.status === value)?.label ?? value)
  return (
    <DialogShell
      title={t("Изменение")}
      height={302.3}
      inset
      onClose={onClose}
      action={t("Изменить")}
      error={error}
      disabled={!status || (status === current && !(changeDelivery && date) && !(changeTransfer && transferDate))}
      onAction={() => status && onApply(status, changeDelivery && date ? date : undefined, changeTransfer && transferDate ? transferDate : undefined)}
    >
      <p className="mt-[10px] text-[13px] font-bold leading-[16.3px]">
        {t("Заказ №")} {orderId}
      </p>
      {/* Linko's status select can be cleared (×); nothing is changed without a status. */}
      <RefSelect
        className="mt-[10px]"
        label={t("Статус")}
        value={status}
        display={status ? label(status) : undefined}
        options={options.map((value) => ({ value, label: label(value) }))}
        onChange={setStatus}
        onClear={() => setStatus("")}
      />
      {/* Linko's dark grey boxes; an empty date field shows its name 14 px above the line, 9 px under the box. */}
      <RefCheck className="mt-[15px] [&_path]:fill-[#666]" checked={changeDelivery} onChange={setChangeDelivery}>
        {t("Изменить дата доставки")}
      </RefCheck>
      {changeDelivery && <RefDate className="mt-[9px]" height={47} label={t("Дата доставки")} value={date} display={t(longRuDate(date))} onChange={setDate} />}
      <RefCheck className={`${changeDelivery ? "mt-[29px]" : "mt-[20px]"} [&_path]:fill-[#666]`} checked={changeTransfer} onChange={setChangeTransfer}>
        {t("Изменить дату передачи")}
      </RefCheck>
      {/* Linko's «Дата передачи»: the day the goods were handed over (the card's «Дата реализации»). */}
      {changeTransfer && <RefDate className="mb-[29px] mt-[9px]" height={47} label={t("Дата передачи")} value={transferDate} display={t(longRuDate(transferDate))} onChange={setTransferDate} />}
    </DialogShell>
  )
}

function InvoiceDialog({ order, onClose, onSave }: { order: Order; onClose: () => void; onSave: (value: Partial<Order>) => void }) {
  const { t } = useLanguage()
  const [number, setNumber] = useState(order.invoiceNumber ?? "")
  const [date, setDate] = useState(order.invoiceDate ?? "")
  const [contract, setContract] = useState(order.contract || order.invoiceContract || "")
  const [active, setActive] = useState(order.invoiceActive ?? false)
  // The company on the invoice is the order's organization (also editable once the order is final).
  const [organization, setOrganization] = useState(order.organization ?? "")
  const organizations = useNames("/api/organizations", plainName)
  const organizationOptions = organization && !organizations.includes(organization) ? [organization, ...organizations] : organizations
  // The client's contracts (Финансы → Договоры).
  const contracts = useNames("/api/contracts?pageSize=0", (row) => {
    const clients = (row.clients as Array<{ id: number; name: string }> | undefined) ?? []
    const mine = clients.some((client) => (order.clientId ? client.id === order.clientId : client.name === order.client))
    return mine ? `№${String(row.fullNumber ?? row.id)}${row.officialName ? ` ${String(row.officialName)}` : ""}` : ""
  })
  const options = contract && !contracts.includes(contract) ? [contract, ...contracts] : contracts
  return (
    <DialogShell
      title={t("Изменить детали счет фактуры")}
      width={550}
      height={467}
      top={50}
      onClose={onClose}
      action={t("Сохранить")}
      onAction={() => onSave({ invoiceNumber: number.trim(), invoiceDate: date, contract, invoiceActive: active, ...(organization !== (order.organization ?? "") ? { organization } : {}) })}
    >
      <RefText className="mt-[8px]" label={t("Номер счет фактуры")} value={number} onChange={setNumber} />
      <RefDate className="mt-[13px]" height={49} label={t("Дата счет фактуры")} value={date} display={t(longRuDate(date))} onChange={setDate} />
      <RefSelect
        className="mt-[24px]"
        label={t("Договор")}
        value={contract}
        options={options.map((value) => ({ value, label: value }))}
        onChange={setContract}
        onClear={() => setContract("")}
      />
      <RefSelect
        className="mt-[24px]"
        label={t("Организация")}
        value={organization}
        options={organizationOptions.map((value) => ({ value, label: value }))}
        onChange={setOrganization}
      />
      <OrganizationMoveHint stored={order.organization ?? ""} chosen={organization} />
      <RefCheck className="mt-[25px]" checked={active} onChange={setActive}>
        {t("Активная счет фактура")}
      </RefCheck>
    </DialogShell>
  )
}

/** An active manual-discount promotion (GET /api/orders/[id]/promotions?manual=true). */
type ManualPromotion = { id: number; name: string; discount: number; products: Array<{ productId: number; percent: number }> }

/**
 * «Ручная скидка»: Linko's «Акция» select lists the active promotions of type discount with the manual discount kind
 * (market/promotion/get_active?order=&type=discount&discount_type=manual), «Не найдено» when there is none.
 */
function ManualDiscountDialog({ orderId, onClose, onApply, error }: { orderId: number; onClose: () => void; onApply: (promotion: ManualPromotion) => void; error?: string }) {
  const { t } = useLanguage()
  const [chosen, setChosen] = useState("")
  const [promotions, setPromotions] = useState<ManualPromotion[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void api<ManualPromotion[]>(`/api/orders/${orderId}/promotions?manual=true`).then((result) => {
      if (!cancelled) setPromotions(result.ok && Array.isArray(result.body) ? result.body : [])
    })
    return () => {
      cancelled = true
    }
  }, [orderId])
  const promotion = promotions?.find((row) => String(row.id) === chosen)
  return (
    <DialogShell title={t("Ручная скидка")} height={367} onClose={onClose} action={t("Применить")} error={error} disabled={!promotion} onAction={() => promotion && onApply(promotion)}>
      <RefSelect
        className="mt-[30px]"
        label={t("Акция")}
        value={chosen}
        options={(promotions ?? []).map((row) => ({ value: String(row.id), label: row.name }))}
        emptyText={promotions === null ? t("Загрузка...") : t("Не найдено")}
        onChange={setChosen}
      />
    </DialogShell>
  )
}

function FullReturnDialog({ order, onClose, onConfirm, error }: { order: Order; onClose: () => void; onConfirm: (returnDate: string) => void; error?: string }) {
  const { t } = useLanguage()
  const [date, setDate] = useState(todayIso())
  return (
    <DialogShell title={t("Выполнить")} height={350.8} onClose={onClose} action={t("Да")} error={error} onAction={() => onConfirm(date)}>
      <ConfirmText>{t("Подтверждение запроса")}</ConfirmText>
      <ConfirmStrip>
        <p>{t("Вы действительно хотите сделать полный возврат ?")}</p>
        <p>
          {t("Заказ №")} {order.id} — {t("Склад")}: {order.warehouse || order.stockName || t("Не указан")}
        </p>
        <RefDate className="mt-[6px]" height={46} compact label={t("Дата")} value={date} display={t(longRuDate(date))} onChange={setDate} />
      </ConfirmStrip>
    </DialogShell>
  )
}

/* ------------------------------------------------------------------ */
/* Full screen sheets                                                  */
/* ------------------------------------------------------------------ */

/** A typed number of the quick edit ("10 000", "0,17"); NaN when it is not one. */
const read = (text: string | undefined) => strictNumber(text ?? "", { locale: true })

/** The line's unit price after its own discount (what Linko's quick edit starts «Цена» at). */
const currentPrice = (item: OrderLineItem) => Math.round(item.unitPrice * (1 - (item.discountPercent ?? 0) / 100) * 1e8) / 1e8

/** "10000" → "10 000" (Linko's quick edit shows the line price grouped; strictNumber reads it back). */
function groupedInput(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 8, useGrouping: true }).replace(/ | /g, " ")
}

/** A typed amount regrouped as Linko's price inputs do while typing ("10000" → "10 000", "10000,5" → "10 000,5");
 * anything that is not a plain number is left as typed. */
function regroupTyped(text: string) {
  const match = /^(-?)(\d+)([.,]\d*)?$/.exec(text.replace(/\s+/g, ""))
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${match[3] ?? ""}` : text
}

function QuickEditSheet({ order, items, onClose, onSaved }: { order: Order; items: OrderLineItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  // Linko's USE_ORDER_PRODUCT_PRICE_DISCOUNT (on for this account): «Скидка (<currency>)» is an amount off the unit price.
  // «Цена» starts at the line's current price (after its discount) and the discount empty; new price = price − discount.
  const initial = useMemo(() => items.map((item) => ({ quantity: String(item.quantity), price: groupedInput(currentPrice(item)), discount: "" })), [items])
  const [lines, setLines] = useState(initial)
  // Linko: ticked for a confirmed order; it cannot be changed once the order is handed over or delivered.
  const confirmLocked = order.status === "В пути" || order.status === "Доставлено"
  const [confirmed, setConfirmed] = useState(order.status !== "Не подтвержден")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const calc = useMemo(
    () =>
      items.map((item, index) => {
        const line = lines[index]
        const quantity = read(line?.quantity) || 0
        const price = read(line?.price) || 0
        const discount = read(line?.discount) || 0
        return { quantity, gross: quantity * price, off: quantity * discount, net: quantity * (price - discount), newPrice: price - discount }
      }),
    [items, lines],
  )
  const grossTotal = calc.reduce((sum, line) => sum + line.gross, 0)
  const offTotal = calc.reduce((sum, line) => sum + line.off, 0)
  const netTotal = calc.reduce((sum, line) => sum + line.net, 0)
  const currency = items[0]?.currency || order.currency || ""

  const update = (index: number, patch: Partial<(typeof lines)[number]>) => {
    setError("")
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  const save = useCallback(async () => {
    setError("")
    for (const [index, line] of lines.entries()) {
      const quantity = read(line.quantity)
      const price = read(line.price)
      const discount = line.discount.trim() ? read(line.discount) : 0
      if (!(quantity > 0) || !(price >= 0) || !(discount >= 0 && discount <= price)) return setError(`${items[index]?.productName}: ${t("Проверьте количество и цену")}`)
    }
    setSaving(true)
    try {
      for (const [index, item] of items.entries()) {
        const line = lines[index]
        const start = initial[index]
        const quantity = read(line.quantity)
        const priced = line.price !== start?.price || Boolean(line.discount.trim())
        // Untouched lines are left alone; a new quantity alone keeps the line's stored price and discount.
        if (!priced && quantity === item.quantity) continue
        const price = read(line.price)
        const discount = line.discount.trim() ? read(line.discount) : 0
        const result = await api(`/api/orders/${order.id}/items/${item.id}`, {
          method: "PUT",
          body: {
            productId: item.productId ?? undefined,
            productName: item.productName,
            unit: item.unit,
            quantity,
            unitPrice: priced ? price : item.unitPrice,
            // The amount off the price is kept as the line's percent of it.
            discountPercent: priced ? (price > 0 ? Math.min(100, (discount / price) * 100) : 0) : (item.discountPercent ?? 0),
            currency: item.currency,
          },
        })
        if (!result.ok) return setError(result.agentLimit || result.productRestriction ? orderApiErrorText(result, t, "Не удалось сохранить изменения на сервере") : `${item.productName}: ${t(result.error)}`)
      }
      // «Подтвердить заказ», as the edit dialog: confirming an unconfirmed order puts it in stock, unticking unconfirms it.
      if (!confirmLocked && ["Не подтвержден", "В процессе", "Есть на складе"].includes(order.status)) {
        const nextStatus = confirmed ? (order.status === "Не подтвержден" ? "Есть на складе" : order.status) : "Не подтвержден"
        if (nextStatus !== order.status) {
          const result = await api(`/api/orders/${order.id}`, { method: "PATCH", body: { status: nextStatus } })
          if (!result.ok) return setError(t(result.error))
        }
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }, [confirmLocked, confirmed, initial, items, lines, onSaved, order.id, order.status, t])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "Enter") void save()
      if (event.altKey && event.key === "1" && !confirmLocked) setConfirmed((value) => !value)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [confirmLocked, save])

  // Linko's 12-column grid over the sheet's width: name 3, group 1, initial quantity 2, then one each; the last is right-aligned.
  // Every cell is padded 8 px (an input is 16 px narrower than its column).
  const COLS = "grid grid-cols-[3fr_1fr_2fr_1fr_1fr_1fr_1fr_1fr_1fr] [&>span]:px-2 [&>input]:mx-2 [&>input]:w-[calc(100%-16px)]"
  const cellInput = "h-[35px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold text-black outline-none focus:border-b-2 focus:border-[#374557] read-only:focus:border-b read-only:focus:border-[#e0e0e0]"
  // Linko's bonus lines are shown but not edited (disabled fields with a dotted line).
  const lockedInput = "h-[35px] w-full cursor-default border-b border-dotted border-[#999] bg-transparent text-[13px] font-semibold text-black outline-none"
  const row = (item: OrderLineItem, index: number) => {
    const box = item.boxAmount && item.boxAmount > 0 ? item.boxAmount : 0
    const locked = Boolean(item.isBonus)
    const input = locked ? lockedInput : cellInput
    return (
      // Linko's row: 50 px, text 20 px from its top, inputs 10 px from it with the line 36 px down.
      <div key={item.id} className={`${COLS} h-[50px] items-start border-b-2 border-dotted border-[#d9e0e5] text-[13px] leading-4 text-[#333] [&>input]:mt-[10px] [&>input]:h-[26px] [&>input]:pt-[6px] [&>span]:pt-5 ${locked ? "" : "bg-white"}`}>
        <span>{item.productName}</span>
        {/* «Группа»: the quantity in the product's blocks (1 of 6 → "0,17"); typing blocks sets the quantity. */}
        <input
          value={box ? formatDecimal((calc[index]?.quantity ?? 0) / box, 2) : "0"}
          readOnly={!box || locked}
          onChange={(event) => {
            const groups = read(event.target.value)
            if (box && Number.isFinite(groups)) update(index, { quantity: String(Math.round(groups * box * 1000) / 1000) })
          }}
          className={input}
        />
        <span>{formatNumber(item.quantity)}</span>
        {/* Linko focuses no field; prices and discounts are regrouped while typing (10 000). */}
        <input readOnly={locked} value={lines[index]?.quantity ?? ""} onChange={(event) => update(index, { quantity: event.target.value })} className={input} />
        <input readOnly={locked} value={lines[index]?.price ?? ""} onChange={(event) => update(index, { price: regroupTyped(event.target.value) })} className={input} />
        <span>{formatNumber(calc[index]?.gross ?? 0)}</span>
        <input readOnly={locked} value={lines[index]?.discount ?? ""} onChange={(event) => update(index, { discount: regroupTyped(event.target.value) })} className={input} />
        <span>{formatNumber(calc[index]?.newPrice ?? 0)}</span>
        <span className="text-right">{formatNumber(calc[index]?.net ?? 0)}</span>
      </div>
    )
  }
  const indexed = items.map((item, index) => ({ item, index }))

  return (
    <SheetShell
      z={1001}
      title={`${t("Быстрая правка")} №${order.id}`}
      onClose={onClose}
      footer={
        <div className="flex h-[62px] items-center justify-between pl-[10px] pr-[10px]">
          <div className="flex items-center text-[14px] text-black">
            <span>{t("Сумма без скидка")}:</span>
            <b className="ml-[5px] text-[16px] font-semibold text-[#129fdd]">{formatNumber(grossTotal)}</b>
            <span className="ml-[5px] mr-[20px]">,</span>
            <span>{t("Скидка / накидка")}:</span>
            <b className="ml-[5px] text-[16px] font-semibold text-[#129fdd]">{formatNumber(offTotal)}</b>
            <span className="ml-[5px] mr-[20px]">,</span>
            <span>{t("Итого")}:</span>
            <b className="ml-[5px] text-[16px] font-semibold text-[#129fdd]">{formatNumber(netTotal)}</b>
          </div>
          <div className="flex items-center gap-4">
            {error && <span className="text-[#e57373]">{error}</span>}
            <button type="button" onClick={save} disabled={saving} className="h-9 min-w-[213.9px] rounded-[2px] bg-[#71ce87] px-[5.3px] text-[13px] font-semibold uppercase text-white disabled:opacity-50">
              {t("Сохранить")} (Alt + Enter)
            </button>
          </div>
        </div>
      }
    >
      <div className="px-[22px] pt-[37px]">
        {/* Linko sets the client / initiator line in a grey rounded panel. */}
        <div className="mx-2 flex h-[62px] items-center rounded-[5px] border border-[#e8ebf0] bg-[#f7f8fa] px-[16px] text-[13px] text-[#333]">
          <span className="w-[141px]">{t("Клиент")}:</span>
          <b className="mr-[20px] font-semibold text-[#129fdd]">{order.marketName || order.client}</b>
          <span className="w-[126px]">{t("Инициатор")}:</span>
          <b className="mr-[18px] font-semibold">{order.agent}</b>
          {/* Linko only disables the input once the order is handed over: the box and its bold label keep their colour,
              and a ticked box is dark grey here. */}
          <span className={confirmLocked ? "pointer-events-none" : ""} aria-disabled={confirmLocked}>
            <RefCheck checked={confirmed} onChange={setConfirmed} className="[&_path]:fill-[#666]">
              {t("Подтвердить заказ")} (Alt + 1)
            </RefCheck>
          </span>
        </div>
        <div className={`${COLS} border-b-2 border-dotted border-[#d9e0e5] py-5 text-[13px] font-semibold leading-4`}>
          <span>{t("Наименование")}</span>
          <span>{t("Группа")}</span>
          <span>{t("Изначальный кол-во")}</span>
          <span>{t("Кол-во")}</span>
          <span>{t("Цена")}</span>
          <span>{t("Сумма")}</span>
          <span>{t("Скидка")} ({currency})</span>
          <span>{t("Новая цена")}</span>
          <span className="text-right">{t("Новая сумма")}</span>
        </div>
        <div>{indexed.filter(({ item }) => !item.isBonus).map(({ item, index }) => row(item, index))}</div>
        {/* The bonus lines sit inside Linko's grey «Бонусные товары» block (2 px wider than the rows on each side). */}
        <div className="-mx-[2px] mt-[20px] bg-[#f2f5f8]">
          <div className="flex h-[36px] items-center px-[10px] text-[13px] leading-[16.3px] text-[#999]">{t("Бонусные товары")}</div>
          {indexed.filter(({ item }) => item.isBonus).map(({ item, index }) => row(item, index))}
        </div>
      </div>
    </SheetShell>
  )
}

/** A line of the order that can still be returned (GET /api/orders/[id]/returnable). */
type Returnable = { orderItemId: number; productName: string; unit: string; ordered: number; returned: number; available: number; price: number; currency: string }

/** Linko's payment types of a quick return (cash / bank: the client ledger's split of the return, lib/finance/sources.ts). */
const RETURN_PAYMENT_TYPES = [
  { value: "cash", label: "Наличный" },
  { value: "bank", label: "Банковский счет" },
]

/** "Быстрый возврат": one client return of the order (Продажи → Возвраты); the stock and the client
 * balance change when it is accepted into the warehouse. Quantities above what is left are refused. */
function QuickReturnSheet({ order, items, onClose, onSaved }: { order: Order; items: OrderLineItem[]; onClose: () => void; onSaved: (id: number) => void }) {
  const { t } = useLanguage()
  // Linko starts on the order's own payment type («Наличный»); it can be changed or cleared (then the order's counts).
  const [paymentType, setPaymentType] = useState(order.paymentType === "bank" || order.payMethod === "bank" ? "bank" : "cash")
  const [warehouse, setWarehouse] = useState(order.warehouse || order.stockName || "")
  const warehouses = useNames("/api/warehouses", (row) => (row.active === false ? "" : plainName(row)))
  const [lines, setLines] = useState<Returnable[] | null>(null)
  const [comment, setComment] = useState("")
  const [manualPrice, setManualPrice] = useState(false)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void api<Returnable[]>(`/api/orders/${order.id}/returnable`).then((result) => setLines(result.ok ? result.body : []))
  }, [order.id])

  const priceOf = (line: Returnable) => (manualPrice && prices[line.orderItemId] !== undefined ? strictNumber(prices[line.orderItemId], { locale: true }) || 0 : line.price)
  const over = (line: Returnable) => (Number(qty[line.orderItemId]) || 0) > line.available + 1e-9
  const overLines = (lines ?? []).filter(over)
  /** Any edit: the message of the last save attempt is about the old values. */
  const edited = () => setError("")

  async function save() {
    setError("")
    const chosen = (lines ?? []).filter((line) => (Number(qty[line.orderItemId]) || 0) > 0)
    if (!warehouse) return setError(t("Выберите склад"))
    if (!chosen.length) return setError(t("Укажите количество возврата"))
    const tooMuch = chosen.find(over)
    if (tooMuch) return setError(`${tooMuch.productName}: ${t("Количество возврата больше доступного")}`)
    setSaving(true)
    const result = await api<{ id: number }>("/api/client-returns", {
      method: "POST",
      body: {
        clientId: order.clientId ?? undefined,
        client: order.clientId ? undefined : order.client,
        orderId: order.id,
        warehouse,
        comment: comment.trim() || undefined,
        ...(paymentType ? { paymentType } : {}),
        items: chosen.map((line) => ({ orderItemId: line.orderItemId, quantity: Number(qty[line.orderItemId]), ...(manualPrice ? { price: priceOf(line) } : {}) })),
      },
    })
    setSaving(false)
    if (!result.ok) return setError(t(result.error))
    onSaved(result.body.id)
  }

  // Linko's 12-column grid: № 1, name 3, ordered 1, available 1, quantity 2, price 2, sum 2; cells padded 8 px, a 2 px
  // dotted line under the head and under every row (white rows, 50 px).
  const COLS = "grid grid-cols-[1fr_3fr_1fr_1fr_2fr_2fr_2fr] [&>span]:px-2"
  const linkoIds = new Map(items.map((item) => [item.id, item.linkoId]))
  return (
    <SheetShell
      z={1001}
      title={`${t("Быстрый возврат")} №${order.id}`}
      onClose={onClose}
      footer={
        <div className="flex h-[56px] items-center justify-end gap-4 pr-[10px]">
          {error ? (
            <span className="text-[#e57373]">{error}</span>
          ) : (
            overLines.length > 0 && <span className="text-[#e57373]">{`${overLines[0].productName}: ${t("Количество возврата больше доступного")}`}</span>
          )}
          <button type="button" onClick={save} disabled={saving || overLines.length > 0} className="h-9 min-w-[110.8px] rounded-[2px] bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white disabled:opacity-50">
            {t("Сохранить")}
          </button>
        </div>
      }
    >
      <div className="px-[22px] pt-[31px]">
        <div className="ml-2 flex items-start gap-[15px]">
          <RefSelect
            className="w-[349px]"
            label={t("Тип оплаты")}
            value={paymentType}
            options={RETURN_PAYMENT_TYPES.map((option) => ({ value: option.value, label: t(option.label) }))}
            onChange={(value) => (setPaymentType(value), edited())}
            onClear={() => (setPaymentType(""), edited())}
          />
          <RefSelect
            className="w-[349px]"
            label={t("Склад")}
            value={warehouse}
            options={Array.from(new Set([...(warehouse ? [warehouse] : []), ...warehouses])).map((value) => ({ value, label: value }))}
            onChange={(value) => (setWarehouse(value), edited())}
            onClear={() => (setWarehouse(""), edited())}
          />
          <RefText className="w-[349px]" label={t("Комментарий")} value={comment} onChange={setComment} />
          <RefCheck className="ml-auto mt-[13.5px] mr-[50px]" checked={manualPrice} onChange={(value) => (setManualPrice(value), edited())}>
            {t("Изменение цены вручную")}
          </RefCheck>
        </div>
        <div className={`${COLS} mt-[2.7px] border-b-2 border-dotted border-[#d9e0e5] py-5 text-[13px] font-semibold leading-[16px]`}>
          <span>№</span>
          <span>{t("Наименование")}</span>
          <span>{t("По заказу")}</span>
          <span>{t("Доступно")}</span>
          <span>{t("Кол-во возврата")}</span>
          <span>{t("Цена")}</span>
          <span>{t("Сумма")}</span>
        </div>
        {lines === null ? (
          <p className="py-8 text-center text-[#888]">{t("Загрузка...")}</p>
        ) : (
          <div>
            {lines.map((line) => (
              <div key={line.orderItemId} className={`${COLS} min-h-[50px] items-center border-b-2 border-dotted border-[#d9e0e5] text-[13px] leading-[16px] text-[#333]`}>
                {/* Linko's № is the order line's id (its own id on an order copied from it). */}
                <span>{linkoIds.get(line.orderItemId) ?? line.orderItemId}</span>
                <span>{line.productName}</span>
                {/* Linko: what was ordered, with what has been returned already in red. */}
                <span>
                  {formatNumber(line.ordered)}
                  {line.returned > 0 && <span className="text-[#e57373]"> (-{formatNumber(line.returned)})</span>}
                </span>
                <span>{formatNumber(line.available)}</span>
                <span>
                  <input
                    type="number"
                    min="0"
                    max={line.available}
                    step="any"
                    disabled={line.available <= 0}
                    value={qty[line.orderItemId] ?? ""}
                    aria-invalid={over(line)}
                    title={over(line) ? t("Количество возврата больше доступного") : undefined}
                    onChange={(event) => {
                      setQty((current) => ({ ...current, [line.orderItemId]: event.target.value }))
                      edited()
                    }}
                    className={`h-[35px] w-full bg-transparent text-[13px] font-semibold outline-none disabled:opacity-40 ${over(line) ? "border-b-2 border-[#e57373] text-[#e57373]" : "border-b border-[#e0e0e0] text-black focus:border-b-2 focus:border-[#374557]"}`}
                  />
                  {over(line) && (
                    <span className="block text-[11px] font-semibold text-[#e57373]">
                      {t("Больше доступного количества")}: {formatNumber(line.available)} {t(line.unit)}
                    </span>
                  )}
                </span>
                <span>
                  <input
                    disabled={!manualPrice}
                    value={manualPrice ? (prices[line.orderItemId] ?? groupedInput(line.price)) : groupedInput(line.price)}
                    onChange={(event) => {
                      setPrices((current) => ({ ...current, [line.orderItemId]: event.target.value }))
                      edited()
                    }}
                    className="h-[35px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold text-black outline-none focus:border-b-2 focus:border-[#374557] disabled:border-b-2 disabled:border-dotted disabled:border-black/30 disabled:text-black"
                  />
                </span>
                {/* Linko's «Сумма» is the order line's: what was ordered at the price. */}
                <span>{formatNumber(line.ordered * priceOf(line))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SheetShell>
  )
}

function PrintSheet({ order, items, debt, copies = 1, onClose }: { order: Order; items: OrderLineItem[]; debt: { operative: string } | null; copies?: number; onClose: () => void }) {
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
  // Quantities are totalled per unit (never one sum over kg and pieces).
  const qty = formatUnitTotals(items.map((item) => ({ qty: item.quantity, unit: item.unit })), t)
  const currency = order.currency || order.amount.trim().split(/\s+/).pop() || ""
  // The company on the invoice: the order's organization, else the first organization.
  const company = orderOrganization(order) || organizations[0] || ""
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
            <td className="border border-black px-2 py-[3px]">{qty}</td>
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
          {t("Организация")}: {company || t("Не указан")}
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
            {t("Добавлено")}: {t(order.createdAt ? displayMoment(order.createdAt) : order.created)}
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
            <b>{t("Склад")}:</b> {order.warehouse || order.stockName || t("Не указан")}
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
      {Array.from({ length: copies * 2 }, (_, index) => (
        <div key={index}>{block}</div>
      ))}
      <div className="mt-6 flex justify-center gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="h-9 rounded-[3px] bg-[#1E4A9A] px-5 text-[12px] font-semibold uppercase text-white">
          {t("Распечатать")}
        </button>
      </div>
    </div>
  )
}
