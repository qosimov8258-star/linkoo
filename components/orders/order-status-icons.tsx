"use client"

import type { ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

// Linko's order icons (its OrderStatus cell, used by Продажи → Заказы and the debtor dialog of «Долги с заказов»):
// the status icon with its hint, the payment icon (cash / bank), the invoice icon; MUI paths, 20px in a 30px button.

export const ORDER_ICON = {
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  store: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z",
  truck: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  clipboard: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z",
  ban: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z",
  cash: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2v1zm9-13H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V6h16v12z",
  bank: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  receipt: "M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
}

/** Status → icon, colour and Linko's hint (it says «Передан доставщику» for В пути, «Доставлен», «Заказ отменен»). */
export const ORDER_STATUS_ICON: Record<string, { path: string; color: string; tip: string }> = {
  "Доставлено": { path: ORDER_ICON.clipboard, color: "#81c784", tip: "Доставлен" },
  "Есть на складе": { path: ORDER_ICON.store, color: "#f0ad4e", tip: "Есть на складе" },
  "В пути": { path: ORDER_ICON.truck, color: "#f0ad4e", tip: "Передан доставщику" },
  "В процессе": { path: ORDER_ICON.clock, color: "#f0ad4e", tip: "В процессе" },
  "Отменен": { path: ORDER_ICON.ban, color: "#e57373", tip: "Заказ отменен" },
  "Не подтвержден": { path: ORDER_ICON.warning, color: "#999999", tip: "Не подтвержден" },
}

/** An icon of the cell: a 20px glyph in a 30px box, with Linko's dark hint on the left when `tip` is set. */
export function OrderIcon({ path, color, tip }: { path: string; color: string; tip?: ReactNode }) {
  return (
    <span className="group/icon relative inline-flex h-[30px] w-[30px] items-center justify-center p-[5px]">
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" style={{ fill: color }}>
        <path d={path} />
      </svg>
      {tip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute right-full top-1/2 z-50 mr-[6px] hidden -translate-y-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-left text-[13px] font-normal leading-[17px] text-white opacity-90 group-hover/icon:block"
        >
          {tip}
        </span>
      ) : null}
    </span>
  )
}

/** The status icon of an order with Linko's hint (translated). */
export function OrderStatusIcon({ status }: { status: string }) {
  const { t } = useLanguage()
  const icon = ORDER_STATUS_ICON[status]
  return icon ? <OrderIcon path={icon.path} color={icon.color} tip={t(icon.tip)} /> : <OrderIcon path={ORDER_ICON.warning} color="#757575" />
}
