import "server-only"

import { getDb } from "@/lib/db"
import { roundMoney } from "@/lib/finance/currency"
import { innKey, nameKey } from "@/lib/finance/entities"
import { CashError, loadCategories } from "@/lib/cash/common"
import { ensureCashSchema } from "@/lib/cash/schema"
import { createClientIncomes } from "@/lib/cash/write"
import type { CashOperationInput, CashWriteResult } from "@/lib/cash/types"
import { strictNumber } from "@/lib/strict-number"

// "Груповой приход" of the cash page (demo /finance/group_client_payment/):
// one customer payment (op 6) per row, all in one transaction, through the
// same writer as a single Kirim with a client. Rows may carry their own
// organization, date, contract and comment ("Разные даты для каждой оплаты").
// The balance pages keep using POST /api/balances/group-payment
// (lib/finance/group-payment.ts), which writes the same kind of rows.

export type CashGroupPaymentRow = {
  clientId: number
  amount: number
  contractId?: number
  organization?: string
  /** Per-row date ("Разные даты…"); default = the dialog date. */
  date?: string
  comment?: string
}

export type CashGroupPaymentInput = {
  date?: string
  cashboxId: number
  branch?: string
  /** Income category; default = the first income category with the client option (or none). */
  categoryId?: number
  /** Default organization for rows without their own. */
  organization?: string
  comment?: string
  isVerified?: boolean
  responsibleId?: number
  debtCurrency?: string
  rateType?: "current" | "order" | "custom"
  customRate?: number
  debtRate?: number
  rows: CashGroupPaymentRow[]
}

export type CashGroupPaymentResult = { results: CashWriteResult[]; count: number; total: number }

export async function createCashGroupPayment(input: CashGroupPaymentInput, user: string): Promise<CashGroupPaymentResult> {
  const db = getDb()
  await ensureCashSchema(db)
  const rows = input.rows.filter((row) => Number(row.amount) > 0)
  if (!rows.length) throw new CashError("Укажите сумму оплаты", 400, "transactions")
  let categoryId = input.categoryId
  if (!categoryId) categoryId = (await loadCategories(db)).find((category) => category.kind === "income" && category.options.includes("client"))?.id
  const inputs: CashOperationInput[] = rows.map((row) => ({
    kind: "income",
    date: row.date || input.date,
    cashboxId: input.cashboxId,
    branch: input.branch,
    organization: row.organization?.trim() || input.organization,
    categoryId,
    amount: Number(row.amount),
    comment: row.comment?.trim() || input.comment,
    isVerified: input.isVerified,
    clientId: row.clientId,
    contractId: row.contractId,
    responsibleId: input.responsibleId,
    debtCurrency: input.debtCurrency,
    rateType: input.rateType,
    customRate: input.customRate,
    debtRate: input.debtRate,
  }))
  const results = await createClientIncomes(inputs, user)
  return { results, count: results.length, total: roundMoney(rows.reduce((sum, row) => sum + Number(row.amount), 0)) }
}

export type GroupPaymentImportRow = {
  client?: string
  inn?: string
  code?: string
  amount?: number | string
  organization?: string
  date?: string
  comment?: string
}

export type GroupPaymentMatch = {
  founds: Array<CashGroupPaymentRow & { clientName: string; source: GroupPaymentImportRow }>
  notFounds: GroupPaymentImportRow[]
}

/** Excel import of the group income (demo import_excel → {founds, notFounds}):
 * rows parsed on the client are matched to clients by code, INN, then name. */
export async function matchGroupPaymentRows(rows: GroupPaymentImportRow[]): Promise<GroupPaymentMatch> {
  const db = getDb()
  await ensureCashSchema(db)
  const clients = (await db.prepare("SELECT * FROM clients ORDER BY id").all()) as Array<{ id: number; name: string; inn?: string | null; code?: string | null }>
  const byCode = new Map<string, (typeof clients)[number]>()
  const byInn = new Map<string, (typeof clients)[number]>()
  const byName = new Map<string, (typeof clients)[number]>()
  for (const client of clients) {
    const code = nameKey(client.code)
    const inn = innKey(client.inn)
    const name = nameKey(client.name)
    if (code && !byCode.has(code)) byCode.set(code, client)
    if (inn && !byInn.has(inn)) byInn.set(inn, client)
    if (name && !byName.has(name)) byName.set(name, client)
  }
  const result: GroupPaymentMatch = { founds: [], notFounds: [] }
  for (const row of rows) {
    const amount = strictNumber(row.amount, { locale: true })
    const client = byCode.get(nameKey(row.code)) ?? byInn.get(innKey(row.inn)) ?? byName.get(nameKey(row.client))
    if (!client || !(amount > 0)) {
      result.notFounds.push(row)
      continue
    }
    result.founds.push({
      clientId: client.id,
      clientName: client.name,
      amount,
      organization: row.organization?.trim() || undefined,
      date: row.date?.trim() || undefined,
      comment: row.comment?.trim() || undefined,
      source: row,
    })
  }
  return result
}
