"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

import { AddOrderDialog } from "./add-order-dialog"
import { RefCheck, RefDate, RefSelect, RefText } from "./order-ref-fields"
import { OrderPaymentsDialog, OrderReturnsTab } from "./order-returns-tab"
import { EDITABLE_STATUSES, FINAL_STATUSES, ORDER_STATUSES, canChangeStatus, orderOrganization, type Order } from "./orders-data"

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

/** Reference action codes -> badge label and colour of the "Логи" tab. */
export const LOG_ACTIONS: Record<string, { label: string; tone: "success" | "begin" | "error" }> = {
  created: { label: "Создан", tone: "success" },
  updated: { label: "Обновленный", tone: "begin" },
  given: { label: "Передан доставщику", tone: "begin" },
  cancel_given: { label: "Отменил передачу", tone: "error" },
  delivered: { label: "Доставлен", tone: "success" },
  undelivered: { label: "Отменена доставки", tone: "error" },
  add_discount: { label: "Добавлена скидка", tone: "success" },
  add_bonus: { label: "Добавлен бонус", tone: "success" },
  canceled: { label: "Заказ отменен", tone: "error" },
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
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

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
  return (
    <>
      <button type="button" data-order-overlay aria-label="close" onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
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
  useEscape(onClose)
  return createPortal(
    <div
      data-order-overlay
      className={`fixed inset-0 z-[1500] flex justify-center bg-black/[0.54] font-sans text-[13px] text-[#333] ${top === undefined ? "items-center" : "items-start"}`}
    >
      <div style={{ width, minHeight: height, marginTop: top }} className="relative max-w-full bg-white pb-[56px] pt-[60px] shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{title}</span>
        <button type="button" aria-label="close" onClick={onClose} style={{ right: closeRight }} className="absolute top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
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
  useEscape(onClose)
  return createPortal(
    <div data-order-overlay style={{ zIndex: z }} className="fixed inset-0 flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="relative h-[59px] shrink-0 border-b border-[#efefef]">
        <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{title}</span>
        <button type="button" aria-label="close" onClick={onClose} className="absolute right-[10px] top-[5.5px] flex h-12 w-12 cursor-pointer items-center justify-center">
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
  const [menu, setMenu] = useState<null | "status" | "edit" | "discount" | "discountSize" | "return">(null)
  const [paymentsOpen, setPaymentsOpen] = useState(false)
  const [dialog, setDialog] = useState<
    null | "status" | "invoice" | "manualDiscount" | "recalc" | "cancelDiscount" | "fullReturn" | "cancelOrder" | "logDetails"
  >(null)
  const [sheet, setSheet] = useState<null | "edit" | "quickEdit" | "quickReturn" | "print" | "printPreview">(null)
  const [printCopies, setPrintCopies] = useState(1)

  // The reference keeps these dialogs in the query string: ?openUpdateDialog=true, ?openQuickEdit=true, ?openInvoiceDialog=true
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("openUpdateDialog") === "true") setSheet("edit")
    else if (params.get("openQuickEdit") === "true") setSheet("quickEdit")
    if (params.get("openInvoiceDialog") === "true") setDialog("invoice")
  }, [])
  const urlFlags = `${sheet === "edit" ? "u" : ""}${sheet === "quickEdit" ? "q" : ""}${dialog === "invoice" ? "i" : ""}`
  const urlReady = useRef(false)
  useEffect(() => {
    if (!urlReady.current) {
      urlReady.current = true
      return
    }
    const url = new URL(window.location.href)
    const set = (name: string, on: boolean) => (on ? url.searchParams.set(name, "true") : url.searchParams.delete(name))
    set("openUpdateDialog", urlFlags.includes("u"))
    set("openQuickEdit", urlFlags.includes("q"))
    set("openInvoiceDialog", urlFlags.includes("i"))
    url.searchParams.sort()
    const next = url.pathname + url.search
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next)
  }, [urlFlags])
  const [items, setItems] = useState<OrderLineItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [logs, setLogs] = useState<ApiOrderLog[]>([])
  const [statusTarget, setStatusTarget] = useState(order.status)
  const [dialogError, setDialogError] = useState("")

  const loadItems = useCallback(() => {
    setItemsLoading(true)
    return api<OrderLineItem[]>(`/api/orders/${order.id}/items`)
      .then((result) => setItems(result.ok ? result.body : []))
      .finally(() => setItemsLoading(false))
  }, [order.id])

  useEffect(() => {
    void loadItems()
    setTab("Список товаров")
    setMenu(null)
  }, [order.id, loadItems])

  const loadLogs = useCallback(() => {
    fetch(`/api/orders/${order.id}/logs`)
      .then(async (response) => (response.ok ? ((await response.json()) as ApiOrderLog[]) : []))
      .then(setLogs)
      .catch(() => setLogs([]))
  }, [order.id])

  useEffect(() => {
    loadLogs()
  }, [loadLogs, order.status])

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
    refreshOrder(order.id)
  }

  /** Saves a patch through the list's updater; false (and no message) when the server refused it. */
  const patchOrder = async (patch: Partial<Order>, message?: string) => {
    const ok = await onUpdate(order.id, patch)
    if (ok !== false) {
      loadLogs()
      if (message) onNotify(message)
    }
    return ok !== false
  }

  const status = order.status
  const editable = !(ORDER_STATUSES as readonly string[]).includes(status) || EDITABLE_STATUSES.includes(status)
  const final = FINAL_STATUSES.includes(status)

  /** The reference only offers returns once the goods left the warehouse (delivered / handed to the courier). */
  const canReturn = order.status === "Доставлено" || order.status === "В пути"

  /** One discount on every line; returns the first server error (nothing is logged then). */
  async function applyDiscountPercent(percent: number): Promise<string | null> {
    const error = await putDiscounts(order.id, items, percent)
    if (error) return error
    await patchOrder({ discount: percent ? `${percent}%` : "" })
    addLog(percent ? "add_discount" : "updated", percent ? `Ручная скидка: ${percent}%` : "Скидки отменены")
    reloadAll()
    return null
  }

  const invoiceActive = order.invoiceActive ?? false
  const invoiceNumber = order.invoiceNumber ?? ""
  const invoiceDate = order.invoiceDate ?? ""
  const invoiceContract = order.invoiceContract ?? ""
  const statusColor =
    status === "Доставлено" ? "text-[#81c784]" : status === "Отменен" ? "text-[#e57373]" : status === "Не подтвержден" ? "text-[#999]" : "text-[#f0ad4e]"
  const currency = order.amount.trim().split(/\s+/).pop() || "SUM"
  const money = (value: number, unit = currency) => `${formatNumber(value)} ${unit}`
  const debtClass = (value: number) => (value < 0 ? "text-[#e57373]" : "text-[#81c784]")
  const debtLines = (expand: Order["operativeExpand"], fallback: number) => (expand ?? [{ currency: "SUM", amount: fallback }])
  const operativeLines = debtLines(order.operativeExpand, order.operativeDebt ?? 0)
  const actualLines = debtLines(order.actualExpand, order.actualDebt ?? 0)
  const createdDate = order.createdAt ? fromInputDate(order.createdAt.slice(0, 10)) : /^\d{1,2}\s+\S+\s+\d{4}/.test(order.created) ? order.created.replace(/\s+\d{1,2}:\d{2}$/, "") : `${order.created.replace(/\s+\d{1,2}:\d{2}$/, "")} ${new Date().getFullYear()}`
  // Client debt of the invoice (per currency), as the print form lists it.
  const debt = { operative: operativeLines.map((line) => `${formatNumber(line.amount)} ${line.currency}`).join(", ") }

  const row = (label: string, value: ReactNode, valueClass = "") => (
    <li className="flex min-h-[25px] items-start justify-between gap-3 leading-[25px]">
      <span>{label}</span>
      <span className={`max-w-[50%] text-right font-semibold ${valueClass}`}>{value}</span>
    </li>
  )

  const tabIndex = TABS.indexOf(tab)
  const allowedTargets = STATUS_MENU.filter((item) => item.status !== status && canChangeStatus(status, item.status))

  return (
    <div className="relative bg-white font-sans text-[13px] leading-normal text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
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
                    kind="status"
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
                <MenuItem icon={ICONS.sync} label={t("Пересчитать")} onClick={() => (setMenu(null), setDialog("recalc"))} />
                <MenuItem icon={ICONS.trash} label={t("Отменить скидки")} onClick={() => (setMenu(null), setDialogError(""), setDialog("cancelDiscount"))} />
              </Menu>
            )}
            {menu === "discountSize" && (
              <DiscountSizePopover
                onClose={() => setMenu(null)}
                onApply={(percent) => {
                  setMenu(null)
                  void applyDiscountPercent(percent)
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
                    onClick={() => (setMenu(null), onNavigate(`/analytics/returns?o=${order.id}&openCreateDialog=true`))}
                  />
                </Menu>
              ) : (
                <ReturnNotice onClose={() => setMenu(null)} />
              ))}
          </div>
          <HeaderButton icon={ICONS.print} label={t("Распечатать")} onClick={() => setSheet("print")} />
          <button
            type="button"
            aria-label={t("Отменить")}
            disabled={!canChangeStatus(status, "Отменен") || status === "Отменен"}
            onClick={() => (setDialogError(""), setDialog("cancelOrder"))}
            className="group relative flex h-12 w-12 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Mi d={ICONS.trash} className="h-5 w-5 fill-black/30 group-hover:fill-black/60" />
            <span className="pointer-events-none absolute right-[-27px] top-[58px] z-[120] hidden whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-bold leading-[17px] text-white opacity-90 group-hover:block">{t("Отменить")}</span>
          </button>
        </div>
      </div>

      {/* info columns */}
      <div className="flex border-b border-[#efefef] px-[15px]">
        <div className="w-1/3 border-r border-[#efefef] p-[15px]">
          <ul>
            {row(
              `${t("Клиент")}:`,
              <button type="button" onClick={() => onNavigate(`/clients?openClient=${encodeURIComponent(order.client)}`)} className="font-semibold text-[#5869f0] hover:underline">
                {order.marketName || order.client}
              </button>,
            )}
            {row(`${t("Транспорт")}:`, order.transportNumber || t("Не указан"))}
            {row(`${t("Филиал")}:`, order.branchName || t("Не указан"))}
            {row(`${t("Склад")}:`, order.stockName || t("Не указан"))}
            {row(`${t("Договор")}:`, invoiceContract || t("Не указан"))}
            {row(`${t("Счет фактура")}:`, invoiceActive ? t("Активный") : t("Не активный"), invoiceActive ? "text-[#81c784]" : "text-[#e57373]")}
            {row("Номер счет фактура:", invoiceNumber || t("Не указан"))}
            {row(`${t("Дата счет фактуры")}:`, invoiceDate ? fromInputDate(invoiceDate) : t("Не указан"))}
          </ul>
        </div>
        <div className="w-1/3 border-r border-[#efefef] p-[15px]">
          <ul>
            {row(`${t("Прайс-лист")}:`, order.priceList || t("Не указан"))}
            {row(`${t("Организация")}:`, orderOrganization(order) || t("Не указан"))}
            {row(`${t("Дата окончательной оплаты")}:`, order.dueDate ? fromInputDate(order.dueDate) : order.delivery)}
            {row(`${t("Тип оплаты")}:`, order.payTypeName || (order.payMethod === "bank" ? "Перечисление" : t("Наличные")))}
            {row(t("Общая стоимость"), order.amount)}
            {order.discount && row(t("Скидка"), order.discount, "text-[#278549]")}
            {row(
              `${t("Оплачено")}:`,
              (order.paidAmount ?? 0) > 0 ? (
                <button type="button" onClick={() => setPaymentsOpen(true)} className="cursor-pointer border-b border-dashed border-[#4f71dc] font-semibold text-[#4f71dc]">
                  {money(order.paidAmount ?? 0)}
                </button>
              ) : (
                money(order.paidAmount ?? 0)
              ),
            )}
            {row(`${t("Остаток")}:`, order.orderBalance === undefined ? order.balance : money(order.orderBalance), (order.orderBalance ?? 0) > 0 ? "text-[#e57373]" : "")}
            <li className="flex min-h-[25px] items-center justify-between gap-3 font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#4f71dc]" />
                Оперативный долг клиента:
              </span>
              <span className="text-right">
                {operativeLines.map((line) => (
                  <span key={line.currency} className={`block ${debtClass(line.amount)}`}>{`${line.amount.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${line.currency}`}</span>
                ))}
              </span>
            </li>
            <li className="flex min-h-[25px] items-center justify-between gap-3 font-semibold leading-[25px]">
              <span className="flex items-center gap-[5px]">
                <Mi d={ICONS.info} className="h-6 w-6 fill-[#4f71dc]" />
                Фактический долг клиента:
              </span>
              <span className="text-right">
                {actualLines.map((line) => (
                  <span key={line.currency} className={`block ${debtClass(line.amount)}`}>{`${line.amount.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ${line.currency}`}</span>
                ))}
              </span>
            </li>
          </ul>
        </div>
        <div className="w-1/3 px-[15px] pb-5 pt-[15px]">
          <ul>
            {row(`${t("Создал")}:`, order.agent)}
            {row(`${t("Доставщик")}:`, order.deliveryMan || order.agent)}
            {row("Экспедитор:", order.expeditor || t("Не указано"))}
            {row(t("Дата создания"), createdDate)}
            {row(`${t("Дата реализации")}:`, order.acceptedDate ? fromInputDate(order.acceptedDate) : order.status === "Доставлено" ? order.delivery : t("Не реализовано"))}
            {row(`${t("Текущий статус")}:`, t(order.status === "Доставлено" ? "Доставлен" : order.status === "В пути" ? "Передан доставщику" : order.status), statusColor)}
            {row(`${t("Тип передачи")}:`, order.deliveryType === "self" ? t("Самовывоз") : t("Доставка"))}
            {row(`${t("Дата доставки")}:`, order.delivery)}
            {row(`${t("Тип сделки")}:`, order.dealType === "0" ? t("Стандартная") : t("Консигнация"))}
            {invoiceActive && invoiceNumber && row(`${t("Статус отправки")}:`, t("Заполнено"))}
          </ul>
          {order.wrongDebt && (
          <div>
            <b className="block leading-[25px] text-[#e57373]">У этого клиента остаток, требуется перасчет</b>
            <button
              type="button"
              onClick={() => onNavigate("/analytics/client-debts")}
              className="mt-[5px] flex h-[30px] w-full items-center justify-center rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95"
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
            <button key={label} type="button" onClick={() => setTab(label)} className="h-12 text-left text-[13px] font-medium text-black">
              <span className="block text-center" style={{ width: `${(TAB_COLUMNS[0] / TAB_COLUMNS[index]) * 100}%` }}>
                {label === "Серии" ? label : t(label)}
              </span>
            </button>
          ))}
          <span
            className="absolute -bottom-[1px] h-[2px] bg-[#4f71dc] transition-all duration-300"
            style={{ left: `${tabIndex * 20}%`, width: "20%" }}
          />
        </div>

        {tab === "Список товаров" && (
          <ItemsTable items={items} loading={itemsLoading} />
        )}
        {tab === "Серии" && <Robot text={t("По вашему запросу ничего не найдено")} />}
        {tab === "Возврат" && <OrderReturnsTab orderId={order.id} currency={currency} empty={<Robot overlay text={t("В данном заказе нет возвратов")} />} />}
        {tab === "Задействованные акции" && <Robot overlay text={t("Для этого заказа нет акций")} />}
        {tab === "Логи" && (
          <div>
            <div className="mt-[10px] flex w-full items-end justify-end">
              <button
                type="button"
                onClick={() => setDialog("logDetails")}
                className="mr-2 flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white"
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
                        <p className="ml-[5px]">{formatLogDate(log.createdAt)}</p>
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
          error={dialogError}
          onClose={() => setDialog(null)}
          onApply={async (percent) => {
            const error = await applyDiscountPercent(percent)
            if (error) return setDialogError(t(error))
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
          orderId={order.id}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            // every line that has not been returned yet goes back: line return quantities + the return document (P&L and the returns report read it)
            const open = items.filter((item) => item.quantity - (item.returnQuantity ?? 0) > 0)
            setDialog(null)
            if (!open.length) return onNotify(t("Все товары уже возвращены"))
            try {
              await Promise.all(
                open.map((item) =>
                  fetch(`/api/orders/${order.id}/items/${item.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent, currency: item.currency, returnQuantity: item.quantity }),
                  }),
                ),
              )
              const lines = open.map((item) => ({ productName: item.productName, quantity: item.quantity - (item.returnQuantity ?? 0), unitPrice: item.unitPrice, discountPercent: item.discountPercent, currency: item.currency }))
              const document = await fetch(`/api/orders/${order.id}/returns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: "", lines }) })
              if (!document.ok) throw new Error("return document failed")
              addLog("updated", "Оформлен полный возврат")
              await loadItems()
              onNotify(t("Полный возврат оформлен"))
            } catch {
              onNotify(t("Не удалось сохранить изменения на сервере"))
            }
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
            items: items.map((item) => ({ id: item.id, productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent, boxAmount: item.boxAmount, boxUnit: item.boxUnit })),
          }}
          onClose={() => setSheet(null)}
          onCreated={() => setSheet(null)}
          onSaved={async (patch) => {
            if (!(await patchOrder(patch, t("Заказ обновлён")))) return
            addLog("updated")
            setSheet(null)
            void loadItems()
            refreshOrder(order.id)
          }}
        />
      )}
      {sheet === "quickEdit" && (
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
          onSaved={() => {
            addLog("updated", "Оформлен быстрый возврат")
            setSheet(null)
            void loadItems()
            onNotify(t("Возврат оформлен"))
          }}
        />
      )}
      {sheet === "print" && (
        <PrintDrawer
          onClose={() => setSheet(null)}
          onPick={(copies) => {
            setPrintCopies(copies)
            setSheet("printPreview")
          }}
        />
      )}
      {sheet === "printPreview" && createPortal(<PrintSheet order={order} items={items} debt={debt} copies={printCopies} onClose={() => setSheet(null)} />, document.body)}
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
    { key: "amount" as const, label: "Кол-во", color: "", value: (line: NonNullable<ReturnType<typeof lineOf>>) => `${formatNumber(line.amount)} шт.` },
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
        <button type="button" aria-label="close" onClick={onClose} className="ml-auto">
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
                {columns.map((log) => <th key={log.id} className={`${cellClass} font-normal`}>{formatLogDate(log.createdAt)}</th>)}
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

function SortHead({ children, width }: { children: ReactNode; width?: string }) {
  return (
    <th style={width ? { width } : undefined} className="whitespace-nowrap bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold text-[#374557]">
      <span className="flex items-center">
        {children}
        <span className="flex h-5 w-5 flex-col">
          <svg viewBox="0 0 24 24" className="ml-[5px] -mb-[5px] h-[15px] w-[15px] fill-[#888]"><path d="M7 14l5-5 5 5z" /></svg>
          <svg viewBox="0 0 24 24" className="ml-[5px] -mt-[5px] h-[15px] w-[15px] fill-[#888]"><path d="M7 10l5 5 5-5z" /></svg>
        </span>
      </span>
    </th>
  )
}

/** "0 тонна(+1 кг)": whole blocks of `boxAmount` units, the remainder in the product's own unit. */
function blockLabel(quantity: number, unit: string, boxAmount?: number, boxUnit?: string) {
  if (!boxAmount || boxAmount <= 0 || !boxUnit) return "0"
  const blocks = Math.floor(quantity / boxAmount)
  const rest = Math.round((quantity - blocks * boxAmount) * 1000) / 1000
  return `${blocks} ${boxUnit}${rest > 0 ? `(+${formatNumber(rest)} ${unit})` : ""}`
}

function ItemsTable({ items, loading }: { items: OrderLineItem[]; loading: boolean }) {
  const { t } = useLanguage()
  const totals = items.reduce(
    (sum, item) => ({
      quantity: sum.quantity + item.quantity,
      total: sum.total + item.lineTotal,
      discount: sum.discount + item.quantity * item.unitPrice - item.lineTotal,
      returned: sum.returned + (item.returnQuantity ?? 0),
    }),
    { quantity: 0, total: 0, discount: 0, returned: 0 },
  )
  const unitLabel = items[0]?.unit ?? "dona"
  const currency = items[0]?.currency || "SUM"

  const cell = "border-b border-r border-[#efefef] px-[17.5px] py-[8px] align-middle"

  return (
    <div className="border-l border-[#efefef]">
      <table className="w-full table-auto border-collapse">
        <thead>
          <tr>
            <th className="bg-[#f0f4f9] px-[17.5px] py-[7.8px] text-left text-[13px] font-semibold text-[#374557]">№</th>
            <SortHead width="30%">{t("Товар")}</SortHead>
            <SortHead>{t("Количество")}</SortHead>
            <SortHead>{t("Блок")}</SortHead>
            <SortHead>Кг.</SortHead>
            <SortHead>{t("Возврат")}</SortHead>
            <SortHead>{`${t("Цена")} ${currency}`}</SortHead>
            <SortHead>{`${t("Сумма")} ${currency}`}</SortHead>
            <SortHead>{`${t("Скидка")} (${currency})`}</SortHead>
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
            items.map((item, index) => (
              <tr key={item.id}>
                <td className={cell}>{index + 1}</td>
                <td className={cell}>
                  {item.productName}
                  {item.article && <span className="block text-[#4f71dc]">{item.article}</span>}
                </td>
                <td className={cell}>
                  {formatNumber(item.quantity)} {item.unit}
                </td>
                <td className={cell}>{blockLabel(item.quantity, item.unit, item.boxAmount, item.boxUnit)}</td>
                <td className={cell}>0</td>
                <td className={`${cell} ${(item.returnQuantity ?? 0) > 0 ? "text-[#e57373]" : ""}`}>{(item.returnQuantity ?? 0) > 0 ? "- " : ""}{formatNumber(item.returnQuantity ?? 0)} {item.unit}</td>
                <td className={cell}>{formatNumber(item.unitPrice)}</td>
                <td className={cell}>{formatNumber(item.lineTotal)}</td>
                <td className={cell}>{formatNumber(item.quantity * item.unitPrice - item.lineTotal)}</td>
              </tr>
            ))
          )}
          {!loading && items.length > 0 && (
            <tr className="text-[15px] font-semibold">
              <td colSpan={2} className="border-b border-r border-[#efefef] px-[17.5px] py-[8px]">
                {t("Итого")}:
              </td>
              <td className="border-b border-r border-[#efefef] px-[17.5px] py-[8px]">
                {formatNumber(totals.quantity)} {unitLabel}
              </td>
              <td className="border-b border-r border-[#efefef]" />
              <td className="border-b border-r border-[#efefef] px-[17.5px]">0</td>
              <td className={`border-b border-r border-[#efefef] px-[17.5px] ${totals.returned > 0 ? "text-[#e57373]" : ""}`}>{totals.returned > 0 ? "- " : ""}{formatNumber(totals.returned)} {unitLabel}</td>
              <td className="border-b border-r border-[#efefef]" />
              <td className="border-b border-r border-[#efefef] px-[17.5px]">{formatNumber(totals.total)}</td>
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

/** "Размер скидки / OK" popover under the Скидка button (the reference's first discount menu item). */
function DiscountSizePopover({ onClose, onApply }: { onClose: () => void; onApply: (percent: number) => void }) {
  const { t } = useLanguage()
  const [value, setValue] = useState("")
  const submit = () => {
    const percent = Number(value)
    if (percent > 0 && percent <= 100) onApply(percent)
    else onClose()
  }
  return (
    <>
      <button type="button" data-order-overlay aria-label="close" onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
      <div className="absolute left-[-71.1px] top-[38.3px] z-[115] h-[72px] w-[198.1px] rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <span className="absolute left-[149px] top-[-7px] h-[14px] w-[14px] rotate-45 bg-white shadow-[-2px_-2px_4px_rgba(0,0,0,0.06)]" />
        <div className="relative h-full overflow-hidden rounded-[2px] bg-white">
          <span className="absolute left-5 top-[10.7px] text-[9.75px] font-semibold leading-[12.2px] text-black">{t("Размер скидки")}</span>
          <input
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/[^\d.]/g, ""))}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            className="absolute left-5 top-[27px] h-[26px] w-[110px] bg-transparent text-[13px] font-semibold text-[#333] outline-none"
          />
          <span className="absolute left-5 top-[53px] h-px w-[110px] bg-[#e0e0e0]" />
          <button type="button" onClick={submit} className="absolute left-[138px] top-[21.5px] h-9 w-[50.1px] text-center">
            <span className="inline-block py-[9px] text-[13px] leading-[18px] text-[#4f71dc]">OK</span>
          </button>
        </div>
      </div>
    </>
  )
}

/** Shown instead of the return menu while the goods are still in the warehouse. */
function ReturnNotice({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <>
      <button type="button" data-order-overlay aria-label="close" onClick={onClose} className="fixed inset-0 z-[110] cursor-default" />
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
  const [changeTransfer, setChangeTransfer] = useState(false)
  const [date, setDate] = useState(toInputDate(delivery))
  const options = ORDER_STATUS_OPTIONS.filter((value) => value === current || canChangeStatus(current, value))
  const label = (value: string) => t(value === "Доставлено" ? "Доставлен" : value)
  return (
    <DialogShell title={t("Изменение")} height={302.3} inset onClose={onClose} action={t("Изменить")} error={error} disabled={status === current && !changeDelivery} onAction={() => onApply(status, changeDelivery ? date : undefined)}>
      <p className="mt-[10px] text-[13px] font-bold leading-[16.3px]">
        {t("Заказ №")} {orderId}
      </p>
      <RefSelect
        className="mt-[10px]"
        label={t("Статус")}
        value={status}
        display={label(status)}
        options={options.map((value) => ({ value, label: label(value) }))}
        onChange={setStatus}
      />
      <RefCheck className="mt-[15px]" checked={changeDelivery} onChange={setChangeDelivery}>
        {t("Изменить дата доставки")}
      </RefCheck>
      {changeDelivery && <RefDate className="mt-[10px]" label={t("Дата доставки")} value={date} display={longRuDate(date)} onChange={setDate} />}
      <RefCheck className={changeDelivery ? "mt-[10px]" : "mt-[20px]"} checked={changeTransfer} onChange={setChangeTransfer}>
        {t("Изменить дату передачи")}
      </RefCheck>
    </DialogShell>
  )
}

function InvoiceDialog({ order, onClose, onSave }: { order: Order; onClose: () => void; onSave: (value: Partial<Order>) => void }) {
  const { t } = useLanguage()
  const [number, setNumber] = useState(order.invoiceNumber ?? "")
  const [date, setDate] = useState(order.invoiceDate ?? "")
  const [contract, setContract] = useState(order.invoiceContract ?? order.contract ?? "")
  const [active, setActive] = useState(order.invoiceActive ?? false)
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
      onAction={() => onSave({ invoiceNumber: number.trim(), invoiceDate: date, invoiceContract: contract, invoiceActive: active })}
    >
      <RefText className="mt-[8px]" label={t("Номер счет фактуры")} value={number} onChange={setNumber} />
      <RefDate className="mt-[13px]" height={49} label={t("Дата счет фактуры")} value={date} display={longRuDate(date)} onChange={setDate} />
      <RefSelect
        className="mt-[24px]"
        label={t("Договор")}
        value={contract}
        options={options.map((value) => ({ value, label: value }))}
        onChange={setContract}
        onClear={() => setContract("")}
      />
      <RefCheck className="mt-[25px]" checked={active} onChange={setActive}>
        {t("Активная счет фактура")}
      </RefCheck>
    </DialogShell>
  )
}

function ManualDiscountDialog({ onClose, onApply, error }: { onClose: () => void; onApply: (percent: number) => void; error?: string }) {
  const { t } = useLanguage()
  const [percent, setPercent] = useState("")
  return (
    <DialogShell title={t("Ручная скидка")} height={367} onClose={onClose} action={t("Применить")} error={error} disabled={!percent} onAction={() => onApply(Number(percent))}>
      <RefSelect
        className="mt-[30px]"
        label={t("Акция")}
        value={percent}
        options={[5, 10, 15, 20, 25, 30].map((value) => ({ value: String(value), label: `${t("Скидка")} ${value}%` }))}
        onChange={setPercent}
      />
    </DialogShell>
  )
}

function FullReturnDialog({ orderId, onClose, onConfirm }: { orderId: number; onClose: () => void; onConfirm: () => void }) {
  const { t } = useLanguage()
  const [date, setDate] = useState(localIso(new Date()))
  return (
    <DialogShell title={t("Выполнить")} height={350.8} onClose={onClose} action={t("Да")} onAction={onConfirm}>
      <ConfirmText>{t("Подтверждение запроса")}</ConfirmText>
      <ConfirmStrip>
        <p>{t("Вы действительно хотите сделать полный возврат ?")}</p>
        <p>
          {t("Заказ №")} {orderId}
        </p>
        <RefDate className="mt-[6px]" height={46} compact label={t("Дата")} value={date} display={longRuDate(date)} onChange={setDate} />
      </ConfirmStrip>
    </DialogShell>
  )
}

/* ------------------------------------------------------------------ */
/* Full screen sheets                                                  */
/* ------------------------------------------------------------------ */

function QuickEditSheet({ order, items, onClose, onSaved }: { order: Order; items: OrderLineItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [lines, setLines] = useState(() => items.map((item) => ({ id: item.id, quantity: String(item.quantity), price: String(item.unitPrice), discount: item.discountPercent ? String(item.discountPercent) : "" })))
  const [confirmed, setConfirmed] = useState(true)
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
      if (event.altKey && event.key === "1") setConfirmed((value) => !value)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [save])

  const COLS = "grid grid-cols-[364px_121.3px_242.7px_repeat(6,121.3px)]"
  const cellInput = "ml-2 h-[35px] w-[105.3px] border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold text-black outline-none focus:border-[#374557]"

  return (
    <SheetShell
      z={1001}
      title={`${t("Быстрая правка")} №${order.id}`}
      onClose={onClose}
      footer={
        <div className="flex h-[62px] items-center justify-between pl-[10px] pr-[10px]">
          <div className="flex items-center text-[14px] text-black">
            <span>{t("Сумма без скидка")}:</span>
            <b className="ml-[10px] mr-[29px] text-[16px] font-semibold text-[#129fdd]">{formatNumber(grossTotal)}</b>
            <span>{t("Скидка / накидка")}:</span>
            <b className="ml-[10px] mr-[29px] text-[16px] font-semibold text-[#129fdd]">{formatNumber(grossTotal - netTotal)}</b>
            <span>{t("Итого")}:</span>
            <b className="ml-[10px] text-[16px] font-semibold text-[#129fdd]">{formatNumber(netTotal)}</b>
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
      <div className="px-[22px] pt-[41px]">
        <div className="ml-2 flex h-[25px] items-center text-[13px] text-[#333]">
          <span className="w-[100px]">{t("Клиент")}:</span>
          <b className="w-[120px] font-semibold text-[#129fdd]">{order.marketName || order.client}</b>
          <span className="w-[126.2px]">{t("Инициатор")}:</span>
          <b className="w-[88.8px] font-semibold">{order.agent}</b>
          <RefCheck checked={confirmed} onChange={setConfirmed}>
            {t("Подтвердить заказ")} (Alt + 1)
          </RefCheck>
        </div>
        <div className={`${COLS} mt-5 text-[13px] font-semibold leading-[16.3px]`}>
          <span>{t("Наименование")}</span>
          <span>{t("Группа")}</span>
          <span>{t("Изначальный кол-во")}</span>
          <span>{t("Кол-во")}</span>
          <span>{t("Цена")}</span>
          <span>{t("Сумма")}</span>
          <span>{t("Скидка")} (%)</span>
          <span>{t("Новая цена")}</span>
          <span>{t("Новая сумма")}</span>
        </div>
        <div className="mt-[19.3px]">
          {items.map((item, index) => (
            <div key={item.id} className={`${COLS} h-[56px] items-center border-y border-dotted border-[#cfd8dc] bg-[#f1f4f7] text-[13px] leading-[16.3px] text-[#333]`}>
              <span>{item.productName}</span>
              <input value="0" readOnly className={cellInput} />
              <span>{formatNumber(item.quantity)}</span>
              <input value={lines[index]?.quantity ?? ""} onChange={(event) => update(index, { quantity: event.target.value })} className={cellInput} />
              <input value={lines[index]?.price ?? ""} onChange={(event) => update(index, { price: event.target.value })} className={cellInput} />
              <span>{formatNumber(calc[index]?.gross ?? 0)}</span>
              <input value={lines[index]?.discount ?? ""} onChange={(event) => update(index, { discount: event.target.value })} className={cellInput} />
              <span>{formatNumber(calc[index]?.newPrice ?? 0)}</span>
              <span>{formatNumber(calc[index]?.net ?? 0)}</span>
            </div>
          ))}
        </div>
        <div className="ml-2 mt-[24.7px] text-[13px] leading-[16.3px] text-[#999]">{t("Бонусные товары")}</div>
      </div>
    </SheetShell>
  )
}

function QuickReturnSheet({ order, items, onClose, onSaved }: { order: Order; items: OrderLineItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [paymentType, setPaymentType] = useState("Банковский счет")
  const [warehouse, setWarehouse] = useState(order.stockName ?? order.warehouse ?? "")
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [comment, setComment] = useState("")
  const [manualPrice, setManualPrice] = useState(false)
  const [qty, setQty] = useState<Record<number, string>>({})
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/warehouses")
      .then(async (response) => (response.ok ? ((await response.json()) as { name: string }[]) : []))
      .then((rows) => setWarehouses(rows.map((row) => row.name)))
      .catch(() => setWarehouses([]))
  }, [])

  const available = (item: OrderLineItem) => Math.max(0, item.quantity - (item.returnQuantity ?? 0))
  const priceOf = (item: OrderLineItem) => Number(prices[item.id] ?? item.unitPrice) || 0
  const total = items.reduce((sum, item) => sum + (Number(qty[item.id]) || 0) * priceOf(item), 0)

  async function save() {
    if (items.some((item) => (Number(qty[item.id]) || 0) > available(item))) return setError(t("Количество возврата больше доступного"))
    if (total <= 0) return setError(t("Укажите количество возврата"))
    setSaving(true)
    try {
      await Promise.all(
        items
          .filter((item) => (Number(qty[item.id]) || 0) > 0)
          .map((item) =>
            fetch(`/api/orders/${order.id}/items/${item.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productName: item.productName,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discountPercent: item.discountPercent,
                currency: item.currency,
                returnQuantity: (item.returnQuantity ?? 0) + Number(qty[item.id]),
              }),
            }),
          ),
      )
      const lines = items
        .filter((item) => (Number(qty[item.id]) || 0) > 0)
        .map((item) => ({ productName: item.productName, quantity: Number(qty[item.id]), unitPrice: priceOf(item), discountPercent: item.discountPercent, currency: item.currency }))
      // the return document itself (P&L and the returns report read these rows)
      const document = await fetch(`/api/orders/${order.id}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, lines }),
      })
      if (!document.ok) throw new Error("return document failed")
      onSaved()
    } catch {
      setError(t("Не удалось сохранить изменения на сервере"))
    } finally {
      setSaving(false)
    }
  }

  const COLS = "grid grid-cols-[121.3px_364px_121.3px_121.3px_242.7px_242.7px_242.7px]"
  return (
    <SheetShell
      z={1001}
      title={`${t("Быстрый возврат")} №${order.id}`}
      onClose={onClose}
      footer={
        <div className="flex h-[56px] items-center justify-end gap-4 pr-[10px]">
          {error && <span className="text-[#e57373]">{error}</span>}
          <button type="button" onClick={save} disabled={saving} className="h-9 min-w-[110.8px] rounded-[2px] bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white disabled:opacity-50">
            {t("Сохранить")}
          </button>
        </div>
      }
    >
      <div className="px-[22px] pt-[31px]">
        <div className="ml-2 flex items-start gap-[25px]">
          <RefSelect
            className="w-[316px]"
            label={t("Тип оплаты")}
            value={paymentType}
            options={["Банковский счет", "Наличные", "Перечисление"].map((value) => ({ value, label: t(value) }))}
            onChange={setPaymentType}
            onClear={() => setPaymentType("")}
          />
          <RefSelect
            className="w-[316px]"
            label={t("Склад")}
            value={warehouse}
            options={Array.from(new Set([...(warehouse ? [warehouse] : []), ...warehouses])).map((value) => ({ value, label: value }))}
            onChange={setWarehouse}
            onClear={() => setWarehouse("")}
          />
          <RefText className="w-[326px]" label={t("Комментарий")} value={comment} onChange={setComment} />
          <RefCheck className="ml-auto mt-[13.5px] mr-[42px]" checked={manualPrice} onChange={setManualPrice}>
            {t("Изменение цены вручную")}
          </RefCheck>
        </div>
        <div className={`${COLS} mt-[22.7px] text-[13px] font-semibold leading-[16.3px]`}>
          <span>№</span>
          <span>{t("Наименование")}</span>
          <span>{t("По заказу")}</span>
          <span>{t("Доступно")}</span>
          <span>{t("Кол-во возврата")}</span>
          <span>{t("Цена")}</span>
          <span>{t("Сумма")}</span>
        </div>
        <div className="mt-[19.4px]">
          {items.map((item) => (
            <div key={item.id} className={`${COLS} h-[56px] items-center border-y border-dotted border-[#9ec9e8] bg-[#f1f4f7] text-[13px] leading-[16.3px] text-[#333]`}>
              <span>{item.id}</span>
              <span>{item.productName}</span>
              <span>{formatNumber(item.quantity)}</span>
              <span>{formatNumber(available(item))}</span>
              <input
                value={qty[item.id] ?? ""}
                onChange={(event) => setQty((current) => ({ ...current, [item.id]: event.target.value }))}
                className="ml-2 h-[35px] w-[226.7px] border-b-2 border-[#374557] bg-transparent text-[13px] font-semibold text-black outline-none"
              />
              <input
                disabled={!manualPrice}
                value={prices[item.id] ?? String(item.unitPrice)}
                onChange={(event) => setPrices((current) => ({ ...current, [item.id]: event.target.value }))}
                className="ml-2 h-[35px] w-[226.7px] border-b border-dotted border-[#374557] bg-transparent text-[13px] font-semibold outline-none"
              />
              <span>{formatNumber((Number(qty[item.id]) || 0) * priceOf(item))}</span>
            </div>
          ))}
        </div>
      </div>
    </SheetShell>
  )
}

/** Right-hand "Распечатать" panel: repeat count and the active order-invoice templates (Справочники → Шаблоны документов). */
function PrintDrawer({ onClose, onPick }: { onClose: () => void; onPick: (copies: number) => void }) {
  const { t } = useLanguage()
  const [copies, setCopies] = useState("1")
  const [templates, setTemplates] = useState<{ id: number; name: string }[] | null>(null)
  useEscape(onClose)
  useEffect(() => {
    fetch("/api/doc-templates?pageSize=500")
      .then(async (response) => (response.ok ? ((await response.json()) as { results: { id: number; name: string; keyName: string; isActive: boolean }[] }) : { results: [] }))
      .then((data) => setTemplates(data.results.filter((row) => row.keyName === "order" && row.isActive)))
      .catch(() => setTemplates([]))
  }, [])
  return createPortal(
    <div data-order-overlay className="fixed inset-0 z-[2100] font-sans text-[13px] text-[#333]">
      <button type="button" aria-label="close" onClick={onClose} className="absolute inset-0 cursor-default" />
      <aside className="absolute top-0 h-full w-[358px] overflow-y-auto bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]" style={{ left: "calc(100% - 459px)" }}>
        <div className="px-5 pb-[10px] pt-5">
          <span className="block text-[9.75px] font-semibold leading-[12.2px] text-black">{t("Кол - во повторений")}</span>
          <input value={copies} onChange={(event) => setCopies(event.target.value.replace(/\D/g, ""))} className="h-[26px] w-[170px] border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold outline-none" />
        </div>
        {templates === null ? null : templates.length === 0 ? (
          <p className="px-5 py-4 text-[#999]">{t("По вашему запросу ничего не найдено...")}</p>
        ) : (
          templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onPick(Math.max(1, Number(copies) || 1))}
              className="block h-12 w-full cursor-pointer px-5 text-left leading-[48px] hover:bg-[#f5f5f5]"
            >
              {template.name}
            </button>
          ))
        )}
      </aside>
    </div>,
    document.body,
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
  const qty = items.reduce((sum, item) => sum + item.quantity, 0)
  const currency = order.currency || "SUM"
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
      {Array.from({ length: copies * 2 }, (_, index) => (
        <div key={index}>{block}</div>
      ))}
      <div className="mt-6 flex justify-center gap-3 print:hidden">
        <button type="button" onClick={() => window.print()} className="h-9 rounded-[3px] bg-[#4f71dc] px-5 text-[12px] font-semibold uppercase text-white">
          {t("Распечатать")}
        </button>
      </div>
    </div>
  )
}
