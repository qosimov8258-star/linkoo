import { selectedBranchName } from "@/lib/selected-branch"
import "server-only"

import { z } from "zod"

import { getDb } from "@/lib/db"
import { nameKey } from "@/lib/finance/entities"
import { CashError, findClientByName, isDbId, loadCategories, MAX_MONEY } from "@/lib/cash/common"
import { ensureCashSchema } from "@/lib/cash/schema"
import type { CashOperationInput, CashWriteResult } from "@/lib/cash/types"
import { createCashOperation, deleteCashOperation, updateCashOperation } from "@/lib/cash/write"
import { dbId, strictNum } from "@/lib/strict-number"

// Legacy /api/cash-management-entries: the old flat shape of a cash entry
// ({ cashboxId, category, clientName, branch, organization, comment, date,
// amount ± }). It no longer writes the table itself: every write goes through
// the cash core (lib/cash/write.ts) — validation of the cashbox, category,
// client, date and amount, op_type, the overdraft / cashback checks, transfer
// pairs, loyalty / staff links — and a delete is the core's soft delete
// (is_deleted, deleted_at / deleted_by), never a physical DELETE. Transfer
// legs, staff payouts and other typed rows are edited / deleted by the same
// rules as on the cash page (a transfer leg cannot be edited, 409).

export type CashManagementEntry = {
  id: number
  cashboxId: number
  description: string
  category: string
  clientName: string
  branch: string
  organization: string
  comment: string
  date: string
  amount: number
}

type Row = {
  id: number
  cashbox_id: number
  description: string
  category: string
  client_name: string
  branch: string
  organization: string
  comment: string
  entry_date: string
  amount: number
}

function rowToEntry(row: Row): CashManagementEntry {
  return {
    id: row.id,
    cashboxId: row.cashbox_id,
    description: row.description,
    category: row.category,
    clientName: row.client_name,
    branch: row.branch,
    organization: row.organization,
    comment: row.comment,
    date: row.entry_date,
    amount: Number(row.amount),
  }
}

const id = dbId()

/** Body of POST / PUT (legacy shape; `categoryId` may replace the category name). */
export const cashManagementEntrySchema = z.object({
  cashboxId: id,
  description: z.string().max(500).optional(),
  category: z.string().trim().max(255).optional(),
  categoryId: id.optional(),
  clientName: z.string().trim().max(255).optional(),
  clientId: id.optional(),
  branch: z.string().trim().max(255).optional(),
  organization: z.string().trim().max(255).optional(),
  comment: z.string().max(2000).optional(),
  date: z.string().trim().max(40).optional(),
  /** > 0 = income, < 0 = expense, in the cashbox currency. */
  amount: strictNum(
    z
      .number()
      .finite()
      .min(-MAX_MONEY, { error: "Слишком большая сумма" })
      .max(MAX_MONEY, { error: "Слишком большая сумма" })
      .refine((value) => value !== 0, { error: "Укажите сумму" }),
  ),
})
export type CashManagementEntryBody = z.infer<typeof cashManagementEntrySchema>

/** Legacy body → the cash core's input (category by id or name, client by id or name). */
async function toOperationInput(body: CashManagementEntryBody): Promise<CashOperationInput> {
  const db = getDb()
  await ensureCashSchema(db)
  const kind = body.amount >= 0 ? "income" : "expense"
  let categoryId = body.categoryId
  if (!categoryId && body.category) {
    const wanted = nameKey(body.category)
    categoryId = (await loadCategories(db)).find((category) => category.kind === kind && nameKey(category.name) === wanted)?.id
    if (!categoryId) throw new CashError("Категория не найдена", 400, kind === "income" ? "incomeCategory" : "expenseCategory")
  }
  let clientId = body.clientId
  if (!clientId && body.clientName) clientId = (await findClientByName(db, body.clientName))?.id
  return {
    kind,
    date: body.date || undefined,
    cashboxId: body.cashboxId,
    branch: body.branch,
    organization: body.organization,
    categoryId,
    amount: Math.abs(body.amount),
    comment: body.comment,
    clientId,
  }
}

/** Live (not deleted) entries, newest first; `cashboxId` filters one cashbox. */
export async function listCashManagementEntries(cashboxId?: number): Promise<CashManagementEntry[]> {
  const db = getDb()
  await ensureCashSchema(db)
  const branch = await selectedBranchName()
  const rows = isDbId(cashboxId)
    ? ((await db.prepare("SELECT * FROM cash_management_entries WHERE cashbox_id = @id AND is_deleted = 0 AND (@branch::text = '' OR branch = @branch) ORDER BY id DESC").all({ id: cashboxId, branch })) as Row[])
    : ((await db.prepare("SELECT * FROM cash_management_entries WHERE is_deleted = 0 AND (@branch::text = '' OR branch = @branch) ORDER BY id DESC").all({ branch })) as Row[])
  return rows.map(rowToEntry)
}

export async function getCashManagementEntry(entryId: number): Promise<CashManagementEntry | null> {
  if (!isDbId(entryId)) return null
  const db = getDb()
  await ensureCashSchema(db)
  const row = (await db.prepare("SELECT * FROM cash_management_entries WHERE id = @id AND is_deleted = 0").get({ id: entryId })) as Row | undefined
  return row ? rowToEntry(row) : null
}

/** The core's result plus the legacy entry when the money stayed a cash entry. */
export type LegacyWriteResult = CashWriteResult & { entry: CashManagementEntry | null }

async function withEntry(result: CashWriteResult): Promise<LegacyWriteResult> {
  return { ...result, entry: result.source === "cash" ? await getCashManagementEntry(result.id) : null }
}

export async function createCashManagementEntry(body: CashManagementEntryBody, user: string): Promise<LegacyWriteResult> {
  return withEntry(await createCashOperation(await toOperationInput(body), user))
}

export async function updateCashManagementEntry(entryId: number, body: CashManagementEntryBody, user: string): Promise<LegacyWriteResult> {
  return withEntry(await updateCashOperation(`cash-${entryId}`, await toOperationInput(body), user))
}

/** Soft delete through the cash core (a transfer leg deletes the whole transfer). */
export async function deleteCashManagementEntry(entryId: number, user: string): Promise<{ deleted: string[] }> {
  const result = await deleteCashOperation(`cash-${entryId}`, user)
  return { deleted: result.deleted }
}
