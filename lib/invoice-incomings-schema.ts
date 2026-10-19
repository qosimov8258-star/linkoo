import "server-only"

import { withTransaction } from "@/lib/db"

// Storage of "Входящие счет фактуры" (spec: scratchpad extra/spec-invoice-incomings.md).
//
// The historical `invoice_incomings` table keeps its columns and rows; the e-invoice
// header is added next to them (existing rows are never rewritten here):
//   document_number = № счет-фактуры, date = дата (YYYY-MM-DD), supplier = поставщик
//   as on the document, note = комментарий, amount = итого с НДС (legacy REAL copy),
//   status = pending | accepted | rejected (legacy "Получен" / "Проведён" / "Отклонён"
//   are read as the same three statuses).
// New columns: contract number / date, supplier_id (our suppliers) + supplier_inn,
// organization_id (our organizations) + buyer_name / buyer_inn, currency, the three
// precise totals, reject reason, who / when changed the status, created_by.
// Lines live in `invoice_incoming_items` (matched product / raw material ids).
// The supplier incoming created from an invoice stores supplier_incomings.invoice_id
// (column owned by lib/supplier-incomings-repo.ts).

const SCHEMA_VERSION = 1

declare global {
  var __linkoInvoiceIncomingsSchema: { version: number; ready: Promise<void> } | undefined
}

async function installSchema(): Promise<void> {
  await withTransaction(async (tx) => {
    // Several dev-server workers may race on the DDL; the lock serialises them.
    await tx.exec("SELECT pg_advisory_xact_lock(72120971)")
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS invoice_incomings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_number TEXT NOT NULL DEFAULT '',
        supplier TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        branch TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Получен',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS contract_number TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS contract_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS supplier_id INTEGER;
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS supplier_inn TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS organization_id INTEGER;
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS buyer_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS buyer_inn TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'SUM';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS amount_without_vat DOUBLE PRECISION;
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS vat_amount DOUBLE PRECISION;
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS total_amount DOUBLE PRECISION;
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS reject_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS status_changed_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS status_changed_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE invoice_incomings ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS invoice_incomings_date_idx ON invoice_incomings (date);
      CREATE INDEX IF NOT EXISTS invoice_incomings_supplier_idx ON invoice_incomings (supplier_id);

      CREATE TABLE IF NOT EXISTS invoice_incoming_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoice_incomings(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL DEFAULT '',
        ikpu TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT '',
        quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
        price DOUBLE PRECISION NOT NULL DEFAULT 0,
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        vat_rate DOUBLE PRECISION,
        vat_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        total DOUBLE PRECISION NOT NULL DEFAULT 0,
        product_id INTEGER,
        raw_material_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS invoice_incoming_items_invoice_idx ON invoice_incoming_items (invoice_id);
    `)
  })
}

/** Creates / extends the invoice tables once per process. Call before any transaction. */
export async function ensureInvoiceIncomingsSchema(): Promise<void> {
  if (globalThis.__linkoInvoiceIncomingsSchema?.version !== SCHEMA_VERSION) {
    const ready = installSchema().catch((error) => {
      globalThis.__linkoInvoiceIncomingsSchema = undefined
      throw error
    })
    globalThis.__linkoInvoiceIncomingsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoInvoiceIncomingsSchema!.ready
}

/** Status of a row; legacy Russian values map onto the three EDO statuses. */
export const INVOICE_STATUS_SQL = `(CASE
  WHEN i.status IN ('accepted', 'Проведён', 'Проведен', 'Принят', 'принят') THEN 'accepted'
  WHEN i.status IN ('rejected', 'Отклонён', 'Отклонен', 'отклонен') THEN 'rejected'
  ELSE 'pending' END)`
