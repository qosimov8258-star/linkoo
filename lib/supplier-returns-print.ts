import "server-only"

import type { SupplierReturn } from "@/components/analytics/supplier-returns-data"
import { getDb, type PgDb } from "@/lib/db"
import { renderDocTemplate, stripActiveContent, type TemplateContext } from "@/lib/doc-template-render"
import { getDocTemplate } from "@/lib/doc-templates-repo"
import { parseAnyDate, parseAnyDay } from "@/lib/finance/dates"
import { currencyLabel } from "@/lib/finance/currency"
import { getSupplierReturn } from "@/lib/supplier-returns-repo"

// Printing a supplier return (Склад → Возврат поставщиков), like Linko's card print menu: a print template of
// Справочники → Шаблоны документов with the key "provider_return" merged with each return, `count` copies of every
// return. The data carries the names of Linko's return serializer (id, provider, from_stock, created_by, accepted_by,
// return_products, total_price…); its print data also has `products` (the same lines) and the creator's `position`, and
// a line's `cost` there is the line's sum (Linko's own «Возврат поставщику» template prints cost / amount as the price).

export const SUPPLIER_RETURN_TEMPLATE_KEY = "provider_return"

export class SupplierReturnPrintError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type Person = { first_name: string; second_name: string; full_name: string; position: { name: string } | null }

/** Employees' Linko position (the role part of "Супер-Админ · Админ") by display name. */
async function positionsOf(db: PgDb, names: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (!wanted.length) return new Map()
  const rows = (await db
    .prepare("SELECT btrim(concat_ws(' ', first_name, last_name)) AS name, position FROM employees WHERE btrim(concat_ws(' ', first_name, last_name)) = ANY(?::text[]) ORDER BY id")
    .all(wanted)) as Array<{ name: string; position: string | null }>
  const result = new Map<string, string>()
  for (const row of rows) {
    const role = String(row.position ?? "").split(" · ")[0]?.trim() ?? ""
    if (!result.has(row.name) && role) result.set(row.name, role)
  }
  return result
}

/** A display name → Linko's {first_name, second_name}; the whole name stays in first_name. */
function person(name: string, positions: Map<string, string>): Person | null {
  const text = name.trim()
  if (!text) return null
  const position = positions.get(text)
  return { first_name: text, second_name: "", full_name: text, position: position ? { name: position } : null }
}

/** A stored moment ("2025-12-29 17:11:12", "19 октября 2026, 14:05") as Linko's "2025-12-29T17:11:12". */
function moment(value: string): string | null {
  return parseAnyDate(value, false) ?? null
}

async function templateContext(db: PgDb, row: SupplierReturn): Promise<TemplateContext> {
  const positions = await positionsOf(db, [row.addedBy, row.transferredBy, row.cancelledBy])
  const currency = currencyLabel(row.currency)
  const day = parseAnyDay(row.date)
  const lines = row.items.map((item, index) => {
    const productId = /^product:(\d+)$/.exec(item.key ?? "")?.[1]
    return {
      id: item.id,
      position: index + 1,
      product: { id: productId ? Number(productId) : null, name: item.product },
      amount: item.qty,
      price: item.price,
      cost: item.total,
      total_price: item.total,
      series: item.series ? { id: item.seriesId ?? null, display_name: item.series, displayName: item.series } : null,
    }
  })
  const createdBy = person(row.addedBy, positions)
  return {
    id: row.id,
    status: row.status === "завершен" ? "completed" : row.status === "отменен" ? "cancelled" : "in_progress",
    provider: { name: row.fromWhom },
    from_stock: { name: row.warehouse },
    stock: { name: row.warehouse },
    division: { name: row.organization },
    branch: { name: row.branch },
    price_list: row.priceList ? { name: row.priceList } : null,
    currency: { name: currency },
    payment_type: row.paymentType === "наличный" ? "cash" : row.paymentType === "банковский счет" ? "bank" : null,
    comment: row.reason || null,
    created_date: day ? `${day}T${/^\d{2}:\d{2}/.test(row.time) ? `${row.time}:00` : "00:00:00"}` : null,
    created_by: createdBy,
    position: createdBy?.position ?? null,
    accepted_by: person(row.transferredBy, positions),
    accepted_time: row.transferTime ? moment(row.transferTime) : null,
    cancelled_by: person(row.cancelledBy, positions),
    cancelled_time: row.cancelledAt ? moment(row.cancelledAt) : null,
    return_products: lines,
    products: lines,
    total_price: row.amount,
    total_amount: row.items.reduce((sum, item) => sum + item.qty, 0),
    PRIMARY_CURRENCY: currency,
  }
}

/** Linko's template filter `division` (a / b, 0 when b is 0). */
const division = (value: unknown, arg: unknown) => {
  const a = Number(value)
  const b = Number(arg)
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : 0
}

/** The printed pages: the template merged with every return (newest first), `count` copies of each. */
export async function renderSupplierReturnPrintPages(ids: number[], templateId: number, count: number): Promise<string[]> {
  const template = await getDocTemplate(templateId)
  if (!template || template.keyName !== SUPPLIER_RETURN_TEMPLATE_KEY) throw new SupplierReturnPrintError("Шаблон не найден", 404)
  const rows: SupplierReturn[] = []
  for (const id of [...new Set(ids)].sort((a, b) => b - a)) {
    const row = await getSupplierReturn(id)
    if (row) rows.push(row)
  }
  if (!rows.length) throw new SupplierReturnPrintError("Возврат не найден", 404)
  const db = getDb()
  const pages: string[] = []
  for (const row of rows) {
    const html = stripActiveContent(renderDocTemplate(template.html, await templateContext(db, row), { division }))
    for (let copy = 0; copy < count; copy++) pages.push(html)
  }
  return pages
}
