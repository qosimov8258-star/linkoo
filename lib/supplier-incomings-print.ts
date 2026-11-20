import "server-only"

import type { Incoming } from "@/components/analytics/supplier-incomings-data"
import { getDb, type PgDb } from "@/lib/db"
import { renderDocTemplate, stripActiveContent, type TemplateContext } from "@/lib/doc-template-render"
import { getDocTemplate } from "@/lib/doc-templates-repo"
import { parseAnyDate, parseAnyDay } from "@/lib/finance/dates"
import { currencyLabel } from "@/lib/finance/currency"
import { getIncoming } from "@/lib/supplier-incomings-repo"

// Printing a supply (Склад → Приход от поставщиков), like Linko's card print menu: a print template of
// Справочники → Шаблоны документов with the key "supply" merged with the supply, `count` copies (Linko merges it on its
// server: saas/merge_template/). The data carries the names of Linko's supply serializer (id, provider, stock,
// accepted_by, accepted_time, products with product / amount / posted_amount / defect_amount / cost, total_cost…); a
// line's `cost` is the line's sum (Linko's own «Поставка» template prints cost / amount as the price).

export const SUPPLY_TEMPLATE_KEY = "supply"
export const MAX_SUPPLY_PRINT_COPIES = 50

export class SupplyPrintError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type ProductRow = { id: number; name: string; unit: string | null; integration_code: string | null; barcode: string | null; article: string | null; type: string | null }

const blank = (value: unknown) => {
  const text = String(value ?? "").trim()
  return text && !/^не установлен/i.test(text) && !/^не указано/i.test(text) ? text : ""
}

/** "Admin Ritm" → Linko's {first_name, second_name}; the whole name stays in first_name. */
const person = (name: string) => (name.trim() ? { first_name: name.trim(), second_name: "", full_name: name.trim() } : null)

/** The catalog rows of the supply's lines: by their key ("product:12"), else by name. */
async function productsOf(db: PgDb, row: Incoming): Promise<Map<number, ProductRow>> {
  const ids = row.items.map((item) => /^product:(\d+)$/.exec(item.key ?? "")?.[1]).filter((id): id is string => Boolean(id)).map(Number)
  const names = row.items.filter((item) => !/^product:\d+$/.test(item.key ?? "")).map((item) => item.product)
  if (!ids.length && !names.length) return new Map()
  const rows = (await db
    .prepare(
      `SELECT id, name, unit, integration_code, barcode, article, type FROM products
        WHERE id = ANY(@ids::int[]) OR (fin_key(name) IN (SELECT fin_key(x) FROM unnest(@names::text[]) AS x) AND COALESCE(deleted, 0) = 0)
        ORDER BY id`,
    )
    .all({ ids, names })) as ProductRow[]
  return new Map(rows.map((product) => [product.id, product]))
}

function templateContext(row: Incoming, products: Map<number, ProductRow>): TemplateContext {
  const currency = currencyLabel(row.currency)
  const byName = new Map([...products.values()].reverse().map((product) => [product.name.trim().toLowerCase(), product]))
  const accepted = row.status === "принят"
  const lines = row.items.map((item, index) => {
    const keyId = /^product:(\d+)$/.exec(item.key ?? "")?.[1]
    const product = (keyId ? products.get(Number(keyId)) : undefined) ?? byName.get(item.product.trim().toLowerCase())
    const posted = item.posted ?? (accepted ? item.qty : 0)
    return {
      id: item.id,
      position: index + 1,
      product: {
        id: product?.id ?? null,
        name: item.product,
        code: blank(product?.integration_code) || null,
        vendor_code: blank(product?.article) || null,
        barcode: blank(product?.barcode) || null,
        measurement: { name: blank(product?.unit) },
        product_type: { name: blank(product?.type) },
      },
      amount: item.qty,
      price: item.cost,
      cost: item.total,
      posted_amount: posted,
      defect_amount: 0,
      series: item.series ? { number: item.series, display_name: item.series } : null,
      expiration_date: item.expiry || null,
    }
  })
  const day = parseAnyDay(row.date)
  return {
    id: row.id,
    status: row.status === "принят" ? "2" : row.status === "отменен" ? "4" : "0",
    provider: { name: row.supplier },
    stock: { name: row.warehouse },
    division: { name: row.organization },
    branch: { name: row.branch },
    contact: { phone: blank(row.phone) || null, email: blank(row.email) || null },
    currency: { name: currency },
    payment_type: /^нал/i.test(row.paymentType) ? "cash" : "bank",
    contract: row.contractNumber ? { contract_number: row.contractNumber } : null,
    comment: row.comment || null,
    date_delivery: day,
    user: person(row.initiator),
    accepted_by: accepted ? person(row.acceptedBy) : null,
    accepted_time: accepted ? (parseAnyDate(row.acceptedAt, false) ?? null) : null,
    will_be_sent_out_date: row.expectedFactoryExit || null,
    will_come_to_post_date: row.expectedCustomsArrival || null,
    invoice_number: row.invoiceNumber || null,
    invoice_date: row.invoiceDate || null,
    invoice_comment: row.invoiceComment || null,
    is_inventory: row.isInventory,
    products: lines,
    total_cost: row.amount,
    total_paid: row.paid,
    PRIMARY_CURRENCY: currency,
  }
}

/** Linko's template filter `division` (a / b, 0 when b is 0). */
const division = (value: unknown, arg: unknown) => {
  const a = Number(value)
  const b = Number(arg)
  return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : 0
}

/** The printed pages: the template merged with the supply, `count` copies. */
export async function renderSupplyPrintPages(id: number, templateId: number, count: number): Promise<string[]> {
  const template = await getDocTemplate(templateId)
  if (!template || template.keyName !== SUPPLY_TEMPLATE_KEY) throw new SupplyPrintError("Шаблон не найден", 404)
  const row = await getIncoming(id)
  if (!row) throw new SupplyPrintError("Приемка не найдена", 404)
  const html = stripActiveContent(renderDocTemplate(template.html, templateContext(row, await productsOf(getDb(), row)), { division }))
  return Array.from({ length: count }, () => html)
}
