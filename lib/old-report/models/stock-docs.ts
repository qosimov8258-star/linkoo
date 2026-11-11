import "server-only"

import { normCurrency } from "@/lib/finance/currency"

import { defineModel, type FilterDef } from "../context"
import { nameKey, type ProductInfo } from "../directory"
import { productGroups } from "../facets"
import { avg, dayGroups, distinct, dmy, max, min, plain, sum, type GroupDef, type MeasureFn } from "../pivot"

// The stock-document models of the old report builder — one record per line of a document:
//   writeoff        «Списание продукты»: the write-offs that are not cancelled, on the day of the document;
//   supply_product  «Продукты поставок по дате поставки»: the supplier incomings that are not cancelled, on their
//                   delivery day, with their prices (for the readers of purchases only).

const str = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim())
const num = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}
type JsonLine = Record<string, unknown>
function linesOf(text: unknown): JsonLine[] {
  try {
    const parsed = JSON.parse(str(text) || "[]") as unknown
    return Array.isArray(parsed) ? (parsed.filter((item) => item && typeof item === "object") as JsonLine[]) : []
  } catch {
    return []
  }
}
/** The product of a document line: by its catalog key ("product:12"), else by its name. */
function productOf(line: JsonLine, byId: Map<number, ProductInfo>, byName: Map<string, ProductInfo>) {
  const key = str(line.key)
  const found = key.startsWith("product:") ? byId.get(Number(key.slice(8))) : undefined
  return found ?? byName.get(nameKey(line.product ?? line.name))
}

// ---------------------------------------------------------------- Списание продукты

type WriteOffLine = {
  docId: number
  day: string
  status: string
  comment: string
  stock: string
  author: string
  productKey: string
  productName: string
  product?: ProductInfo
  qty: number
  lastPrice: number | null
  box: number
  kg: number
}

const WRITE_OFF_STATUS: Record<string, string> = { закрыт: "Завершен", отменен: "Отменен" }
type W = WriteOffLine
const writeOffDays = dayGroups<W>((line) => line.day)
const writeOffProduct = productGroups<W>((line) => line.product, (line) => line.productName, (line) => line.product?.id)
const w = (pick: (line: W) => string | number | null | undefined): GroupDef<W> => ({ label: pick })

export const writeoffModel = defineModel<W>({
  access: "any",
  async load(context) {
    const { db, dir } = context
    const dayTs = "COALESCE(fin_ts(NULLIF(w.date, '')), fin_ts(w.created_at, true))"
    const rows = (await db
      .prepare(
        `SELECT w.id, w.creator, w.warehouse, w.status, w.comment, w.items, to_char((${dayTs})::date, 'YYYY-MM-DD') AS day
           FROM write_offs w
          WHERE w.status <> 'отменен' AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
      )
      .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
    if (!rows.length) return []
    const [products, productsByName, warehouseBranches] = await Promise.all([dir.products(), dir.productsByName(), dir.warehouseBranches()])
    // «Посл.цена»: the product's price in the price lists (the latest entry).
    const lastPrice = new Map<string, number>()
    if (context.wants("last_price")) {
      const prices = (await db.prepare("SELECT product, cash FROM price_list_entries ORDER BY id").all().catch(() => [])) as Record<string, unknown>[]
      for (const row of prices) lastPrice.set(nameKey(row.product), Number(row.cash) || 0)
    }
    const lines: W[] = []
    for (const row of rows) {
      const stock = str(row.warehouse)
      if (context.branch && nameKey(warehouseBranches.get(nameKey(stock))) !== nameKey(context.branch)) continue
      for (const line of linesOf(row.items)) {
        const product = productOf(line, products, productsByName)
        const name = product?.name || str(line.product)
        lines.push({
          docId: Number(row.id),
          day: str(row.day),
          status: WRITE_OFF_STATUS[str(row.status)] ?? "Ожидает",
          comment: str(line.comment) || str(row.comment),
          stock,
          author: str(row.creator),
          productKey: product ? `product:${product.id}` : `name:${nameKey(name)}`,
          productName: name,
          product,
          qty: num(line.qty),
          lastPrice: lastPrice.get(nameKey(name)) ?? null,
          box: product?.box ?? 0,
          kg: product?.kg ?? 0,
        })
      }
    }
    return lines
  },
  groups: {
    writeoff_request_id: w((line) => line.docId),
    writeoff_request_status: w((line) => line.status),
    comment: w((line) => line.comment),
    product: writeOffProduct.name,
    last_price: w((line) => plain(line.lastPrice)),
    stock: w((line) => line.stock),
    user_id: w((line) => line.author),
    created_date_day: writeOffDays.byDay,
    created_date_week: writeOffDays.byWeek,
    created_date_month: writeOffDays.byMonth,
    one_box_amount: writeOffProduct.box,
    product_type_name: writeOffProduct.type,
  },
  measures: {
    amount: sum((line) => line.qty),
    total_box_amount: sum((line) => (line.box > 0 ? line.qty / line.box : 0)),
    kg_amount: sum((line) => line.kg * line.qty),
  },
  filters: {
    product_name: { value: (line) => line.productName },
    WriteoffRequest: { value: (line) => line.docId },
    stock_name: { value: (line) => line.stock },
    product_type: { value: (line) => line.product?.type },
  },
})

// ---------------------------------------------------------------- Продукты поставок

type SupplyLine = {
  docId: number
  day: string
  supplier: string
  stock: string
  organization: string
  comment: string
  invoiceNumber: string
  invoiceDay: string
  currency: string
  productKey: string
  productName: string
  product?: ProductInfo
  qty: number
  /** Line amount and unit price, the document's currency. */
  total: number
  price: number
  /** The line's share of the document's additional expenses, the document's currency. */
  expense: number
  box: number
  kg: number
}

type S = SupplyLine
const supplyDays = dayGroups<S>((line) => line.day)
const supplyProduct = productGroups<S>((line) => line.product, (line) => line.productName, (line) => line.product?.id)
const s = (pick: (line: S) => string | number | null | undefined): GroupDef<S> => ({ label: pick })
const eq = (pick: FilterDef<S>["value"]): FilterDef<S> => ({ value: pick })

const SUPPLY_GROUPS: Record<string, GroupDef<S>> = {
  provider_id: s((line) => line.supplier),
  supply_id: s((line) => line.docId),
  created_date_2: supplyDays.byDay,
  supply_invoice_date: { label: (line) => dmy(line.invoiceDay), sort: (line) => line.invoiceDay },
  supply_invoice_number: s((line) => line.invoiceNumber),
  comment: s((line) => line.comment),
  stock_name: s((line) => line.stock),
  division_id: s((line) => line.organization),
  created_date_day: supplyDays.byDay,
  created_date_week: supplyDays.byWeek,
  created_date_month: supplyDays.byMonth,
  created_date_year: supplyDays.byYear,
  product_id: supplyProduct.name,
  product_id_id: supplyProduct.id,
  measurement: supplyProduct.unit,
  currency_id: s((line) => line.currency),
  product_type_id: supplyProduct.type,
  type_parent_id: supplyProduct.parentType,
  brand_name: supplyProduct.brand,
  one_box_amount: supplyProduct.box,
  one_price: s((line) => plain(line.price)),
}

const SUPPLY_MEASURES: Record<string, MeasureFn<S>> = {
  cost: sum((line) => line.total, 2),
  amount: sum((line) => line.qty),
  price: avg((line) => (line.qty ? line.price : null)),
  sum_expense_price: sum((line) => line.expense, 2),
  sum_with_expense_price: sum((line) => line.total + line.expense, 2),
  min_price: min((line) => (line.qty ? line.price : null)),
  max_price: max((line) => (line.qty ? line.price : null)),
  supply_box_amount: sum((line) => (line.box > 0 ? line.qty / line.box : 0)),
  kg_amount: sum((line) => line.kg * line.qty),
  supply_count: distinct((line) => line.docId),
}

export const supplyProductModel = defineModel<S>({
  access: "purchases",
  async load(context) {
    const { db, dir, money } = context
    const dayTs = "COALESCE(fin_ts(NULLIF(d.date, '')), fin_ts(d.created_at, true))"
    const rows = (await db
      .prepare(
        `SELECT d.id, d.supplier, d.warehouse, d.status, d.organization, d.comment, d.invoice_number, d.items, d.currency,
                to_jsonb(d) ->> 'branch' AS branch, to_jsonb(d) ->> 'invoice_date' AS invoice_date,
                to_char((${dayTs})::date, 'YYYY-MM-DD') AS day
           FROM supplier_incomings d
          WHERE d.status <> 'отменен' AND (${dayTs})::date BETWEEN @from::date AND @to::date`,
      )
      .all({ from: context.from, to: context.to })) as Record<string, unknown>[]
    if (!rows.length) return []
    const [products, productsByName] = await Promise.all([dir.products(), dir.productsByName()])
    // Additional expenses of the documents (Доп. расходы), in the base currency.
    const expenses = new Map<number, number>()
    if (context.wants("sum_expense_price", "sum_with_expense_price")) {
      const found = (await db
        .prepare("SELECT incoming_id, amount, currency, date FROM supplier_incoming_expenses WHERE incoming_id = ANY(@ids::int[])")
        .all({ ids: rows.map((row) => Number(row.id)) })
        .catch(() => [])) as Record<string, unknown>[]
      for (const row of found) {
        const id = Number(row.incoming_id)
        expenses.set(id, (expenses.get(id) ?? 0) + money.base(num(row.amount), normCurrency(str(row.currency), money.code), str(row.date)))
      }
    }
    const lines: S[] = []
    for (const row of rows) {
      if (context.branch && nameKey(row.branch) !== nameKey(context.branch)) continue
      const docId = Number(row.id)
      const fx = money.rate(normCurrency(str(row.currency), money.code), str(row.day))
      const parsed = linesOf(row.items)
      const docTotal = parsed.reduce((total, line) => total + (num(line.total) || num(line.qty) * num(line.cost)), 0)
      // The document's expenses in its own printed currency, split by the lines' amounts.
      const docExpense = fx.toBase ? (expenses.get(docId) ?? 0) / fx.toBase : 0
      for (const line of parsed) {
        const product = productOf(line, products, productsByName)
        const name = product?.name || str(line.product)
        const qty = num(line.qty)
        const total = (num(line.total) || qty * num(line.cost)) * fx.own
        lines.push({
          docId,
          day: str(row.day),
          supplier: str(row.supplier),
          stock: str(row.warehouse),
          organization: str(row.organization),
          comment: str(row.comment),
          invoiceNumber: str(row.invoice_number),
          invoiceDay: str(row.invoice_date).slice(0, 10),
          currency: fx.name,
          productKey: product ? `product:${product.id}` : `name:${nameKey(name)}`,
          productName: name,
          product,
          qty,
          total,
          price: qty ? total / qty : num(line.cost) * fx.own,
          expense: docTotal ? (docExpense * (num(line.total) || qty * num(line.cost))) / docTotal : 0,
          box: num(line.block) > 0 && qty > 0 ? qty / num(line.block) : (product?.box ?? 0),
          kg: product?.kg ?? 0,
        })
      }
    }
    return lines
  },
  groups: SUPPLY_GROUPS,
  measures: SUPPLY_MEASURES,
  filters: {
    provider_name: eq((line) => line.supplier),
    product_name: eq((line) => line.productName),
    brand: eq((line) => line.product?.brand),
    division_name: eq((line) => line.organization),
  },
})
