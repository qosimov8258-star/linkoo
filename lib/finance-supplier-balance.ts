import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb } from "@/lib/db"
import { DOC_DATE_FUTURE, DOC_DATE_INVALID, docDateCheck, parseDocInput } from "@/lib/document-dates"
import { MAX_ID, MAX_MONEY } from "@/lib/finance/api"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import type { SupplierBalanceResult } from "@/lib/supplier-balance-repo"
import { dbId, strictNum } from "@/lib/strict-number"
import { INVALID_DATA_MESSAGE } from "@/lib/validation"

// Request schemas, response mapping and filter options of the "Баланс
// поставщиков" write API (/api/supplier-balance-transactions/**) and its
// filter lookup (/api/balances/supplier-balance/options). The currency must
// be one of the currencies table: the repo checks it with
// resolveCurrencyCode (lib/finance/context.ts) and returns
// "currency_not_found" → 400 "Валюта не найдена".

const currencyCode = z
  .string({ error: "Укажите валюту" })
  .trim()
  .min(1, "Укажите валюту")
  .regex(/^[\p{L}$€']{1,12}$/u, "Неизвестная валюта")
const paymentType = z.enum(["cash", "bank", ""]).optional()
const name = z.string().trim().max(200).optional()
// Year 2000..2100 here; an add / expense entry dated after today is refused by the repo
// (date_future; a money request may be, an edit may keep its own day) — lib/document-dates.ts.
const dateText = z
  .string()
  .trim()
  .refine((value) => value === "" || parseDocInput(value) !== null, DOC_DATE_INVALID)
  .superRefine(docDateCheck({ allowFuture: true }))
  .optional()
const comment = z.string().trim().max(2000).optional()
const fundRequestStatus = z.enum(["pending", "approved", "rejected"])

/** POST /api/supplier-balance-transactions — "Добавить приход/расход поставщику" (add / expense) and "Запрос средств" (fund_request). */
export const supplierBalanceCreateSchema = z.object({
  supplierId: dbId(),
  kind: z.enum(["add", "expense", "fund_request"]),
  currency: currencyCode,
  amount: strictNum(
    z.number({ error: "Введите сумму" }).finite("Введите сумму").positive("Введите сумму больше нуля").max(MAX_MONEY, "Слишком большая сумма"),
    "Введите сумму",
  ),
  paymentType,
  organization: name,
  branch: name,
  date: dateText,
  comment,
})

/** PUT /api/supplier-balance-transactions/[id] — "Изменение баланса поставщика": signed amount (+ приход, − расход). */
export const supplierBalanceUpdateSchema = z.object({
  amount: strictNum(
    z
      .number({ error: "Введите сумму" })
      .finite("Введите сумму")
      .refine((value) => value !== 0, "Введите сумму")
      .refine((value) => Math.abs(value) <= MAX_MONEY, "Слишком большая сумма"),
    "Введите сумму",
  ),
  currency: currencyCode,
  paymentType,
  organization: name,
  branch: name,
  date: dateText,
  comment,
  status: fundRequestStatus.optional(),
})

/** PATCH /api/supplier-balance-transactions/[id] — approve / reject a money request. */
export const fundRequestStatusSchema = z.object({ status: fundRequestStatus })

/** GET /api/supplier-balance-transactions?supplierId&kind */
export const supplierBalanceListQuerySchema = z.object({
  supplierId: dbId().optional(),
  kind: z.enum(["add", "expense", "fund_request"]).optional(),
})

/** Route param → positive integer id, or null. */
export function transactionId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null
}

/** Repo result → JSON response (`status` for a success). */
export function supplierBalanceResponse(result: SupplierBalanceResult, status = 200) {
  if (result.transaction) return NextResponse.json(result.transaction, { status })
  if (result.error === "supplier_not_found") return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  if (result.error === "not_found") return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  // The repo validates the currency against the currencies table (resolveCurrencyCode).
  if (result.error === "currency_not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 400 })
  if (result.error === "date_invalid" || result.error === "date_future") {
    const message = result.error === "date_future" ? DOC_DATE_FUTURE : DOC_DATE_INVALID
    return NextResponse.json({ error: message, field: "date", details: { fieldErrors: { date: [message] } } }, { status: 400 })
  }
  return NextResponse.json({ error: INVALID_DATA_MESSAGE }, { status: 400 })
}

export type SupplierFilterOptions = { organizations: string[]; branches: string[] }

/** Filter options of the page: organizations / branches from their tables plus
 * every distinct (non-empty) name used on supplier movements, so the strict
 * movement-level organization filter of the ledger can match them. */
export async function listSupplierFilterOptions(): Promise<SupplierFilterOptions> {
  const db = getDb()
  const s = await ensureFinanceSchema(db)
  const sources: Array<[table: string, orgColumn: string | null, branchColumn: string | null]> = [
    ["organizations", "name", null],
    ["branches", null, "name"],
    ["suppliers", "organization", "branch"],
    ["supplier_incomings", "organization", "branch"],
    ["supplier_returns", "organization", "branch"],
    ["supplier_payments", "organization", null],
    ["supplier_balance_transactions", "organization", "branch"],
  ]
  const parts: string[] = []
  for (const [table, org, branch] of sources) {
    if (!s.has(table)) continue
    if (org && s.col(table, org)) parts.push(`SELECT 'org' AS kind, fin_place(${org}) AS value FROM ${table}`)
    if (branch && s.col(table, branch)) parts.push(`SELECT 'branch' AS kind, fin_place(${branch}) AS value FROM ${table}`)
  }
  if (!parts.length) return { organizations: [], branches: [] }
  const rows = (await db.prepare(`SELECT DISTINCT kind, value FROM (${parts.join(" UNION ALL ")}) x WHERE value <> ''`).all()) as Array<{ kind: string; value: string }>
  const pick = (kind: string) => {
    const seen = new Map<string, string>()
    for (const row of rows) if (row.kind === kind && !seen.has(row.value.toLowerCase())) seen.set(row.value.toLowerCase(), row.value)
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }
  return { organizations: pick("org"), branches: pick("branch") }
}
