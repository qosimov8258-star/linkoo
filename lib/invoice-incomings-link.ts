import "server-only"

import type { PgDb } from "@/lib/db"
import { ensureInvoiceIncomingsSchema, INVOICE_STATUS_SQL } from "@/lib/invoice-incomings-schema"

// Link "счет-фактура → приход от поставщика" used by lib/supplier-incomings-repo.ts
// when a supply is created from an invoice (demo: EDO "Принятые" → external_url
// #/supply?openCreateDialog=true). Kept apart from the invoice repo so the supplier
// incomings repo can import it without an import cycle.

export class InvoiceLinkError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message)
  }
}

export { ensureInvoiceIncomingsSchema }

/** Locks the invoice (FOR UPDATE, inside the supply's transaction) and checks that a
 * supply may be created from it: it exists, is accepted and has no supply yet. */
export async function claimInvoiceForIncoming(tx: PgDb, invoiceId: number): Promise<{ id: number; number: string; date: string }> {
  const row = (await tx
    .prepare(`SELECT i.id, i.document_number, i.date, ${INVOICE_STATUS_SQL} AS status FROM invoice_incomings i WHERE i.id = ? FOR UPDATE`)
    .get(invoiceId)) as { id: number; document_number: string; date: string; status: string } | undefined
  if (!row) throw new InvoiceLinkError("Счет-фактура не найдена", 404)
  if (row.status !== "accepted") throw new InvoiceLinkError("Приход можно создать только из принятой счет-фактуры")
  const linked = (await tx.prepare("SELECT id FROM supplier_incomings WHERE invoice_id = ? LIMIT 1").get(invoiceId)) as { id: number } | undefined
  if (linked) throw new InvoiceLinkError("По этой счет-фактуре уже создан приход")
  return { id: row.id, number: row.document_number, date: row.date }
}
