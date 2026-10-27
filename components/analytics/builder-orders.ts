"use client"

import { useEffect, useState } from "react"

import { parseAnyDay } from "@/lib/finance/dates"
import { ORDER_EXCLUDED_STATUSES } from "@/lib/finance/types"

/**
 * Real data of the report builders (old report builder, trend builder): the factory's own
 * orders (/api/orders) and their lines (/api/order-items), never invented demo rows.
 */

export type BuilderOrder = {
  id: number
  /** Local calendar day (YYYY-MM-DD) the order was created. */
  day: string
  client: string
  clientId: number | null
  agent: string
  deliveryMan: string
  organization: string
  warehouse: string
  branch: string
  status: string
  currency: string
  amount: number
}

export type BuilderLine = BuilderOrder & {
  productId: number | null
  product: string
  quantity: number
  /** Line total in the order's currency (after the line discount). */
  lineTotal: number
}

export type ApiOrder = {
  id: number
  client?: string
  clientId?: number | null
  createdAt?: string
  agent?: string
  deliveryMan?: string
  organization?: string
  warehouse?: string
  clientBranch?: string
  status?: string
  currency?: string
  amount?: string
}

export type ApiOrderItem = {
  orderId: number
  productId?: number | null
  productName?: string
  quantity?: number
  lineTotal?: number
  currency?: string | null
}

/** Orders that are not sales (Отменен, Не подтвержден): left out like on the dashboard totals. */
export function isCountedOrder(status: string) {
  return !(ORDER_EXCLUDED_STATUSES as readonly string[]).includes(status)
}

const pad = (value: number) => String(value).padStart(2, "0")

export function isoDay(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** First day of the current month and today: the default period of the builders. */
export function currentMonthRange() {
  const now = new Date()
  return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) }
}

/** orders.created_at is written in UTC ("2026-10-23 07:38:08"): the business day (Asia/Tashkent)
 * it falls on, the same day the dashboard totals count it on. */
export function localDay(createdAt: string | undefined): string {
  return parseAnyDay(createdAt, true) ?? ""
}

/** "60 000 SUM", "1 234,5 USD" → 60000 / 1234.5 (0 when the text holds no number). */
export function moneyValue(text: string | undefined): number {
  const match = /-?[\d\s  .,]*\d/.exec(String(text ?? ""))
  if (!match) return 0
  const value = Number(match[0].replace(/[\s  ]/g, "").replace(",", "."))
  return Number.isFinite(value) ? value : 0
}

export function toBuilderOrder(row: ApiOrder): BuilderOrder {
  return {
    id: row.id,
    day: localDay(row.createdAt),
    client: row.client ?? "",
    clientId: row.clientId ?? null,
    agent: row.agent ?? "",
    deliveryMan: row.deliveryMan ?? "",
    organization: row.organization ?? "",
    warehouse: row.warehouse ?? "",
    branch: row.clientBranch ?? "",
    status: row.status ?? "",
    currency: (row.currency || "SUM").toUpperCase(),
    amount: moneyValue(row.amount),
  }
}

/** The product lines of the orders, in the currency of each line (falling back to the order's). */
export function builderLines(orders: BuilderOrder[], itemRows: ApiOrderItem[]): BuilderLine[] {
  const byId = new Map(orders.map((order) => [order.id, order]))
  const lines: BuilderLine[] = []
  for (const item of itemRows) {
    const order = byId.get(item.orderId)
    if (!order) continue
    lines.push({
      ...order,
      currency: (item.currency || order.currency).toUpperCase(),
      productId: item.productId ?? null,
      product: item.productName ?? "",
      quantity: Number(item.quantity) || 0,
      lineTotal: Number(item.lineTotal) || 0,
    })
  }
  return lines
}

type BuilderData = { orders: BuilderOrder[]; lines: BuilderLine[]; loading: boolean; error: string }

/** Loads the orders (and, with `withLines`, their product lines) once. */
export function useBuilderOrders(withLines: boolean): BuilderData {
  const [state, setState] = useState<BuilderData>({ orders: [], lines: [], loading: true, error: "" })
  useEffect(() => {
    let cancelled = false
    const json = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(String(response.status))
      return (await response.json()) as T
    }
    Promise.all([
      // balances=0: the builders need no per-order client balance.
      json<ApiOrder[]>("/api/orders?balances=0"),
      withLines ? json<ApiOrderItem[]>("/api/order-items") : Promise.resolve([] as ApiOrderItem[]),
    ])
      .then(([orderRows, itemRows]) => {
        if (cancelled) return
        const orders = (Array.isArray(orderRows) ? orderRows : []).map(toBuilderOrder)
        const lines = builderLines(orders, Array.isArray(itemRows) ? itemRows : [])
        setState({ orders, lines, loading: false, error: "" })
      })
      .catch(() => {
        if (!cancelled) setState({ orders: [], lines: [], loading: false, error: "Не удалось загрузить данные с сервера" })
      })
    return () => {
      cancelled = true
    }
  }, [withLines])
  return state
}
