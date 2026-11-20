import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { stockTables } from "@/lib/stock/schema"
import { buildReservedDocsSql } from "@/lib/stock/sources"

// «Забронировано» of Остаток opens the documents that hold the item (Linko's stock/reserved_product?product=<id>&stock=):
// one row per document line, orders first (newest first), then confirmed internal transfers (newest first); the
// warehouses chosen in the page's filter narrow it, as Linko's `stock` parameter does.

export type StockReservedDoc = { docType: "order" | "transfer"; docId: number; warehouse: string; qty: number }

export async function getStockReservedDocs(key: string, warehouses: string[] = [], db: PgDb = getDb()): Promise<StockReservedDoc[]> {
  const t = await stockTables(db)
  const scoped = warehouses.map((name) => name.trim()).filter(Boolean)
  const rows = (await db
    .prepare(
      `SELECT r.doc_type, r.doc_id, btrim(r.warehouse) AS warehouse, r.qty FROM (${buildReservedDocsSql(t)}) r
       WHERE r.item_key = @stk_key AND r.qty <> 0
         ${scoped.length ? "AND fin_key(r.warehouse) IN (SELECT fin_key(x) FROM unnest(@stk_whs::text[]) AS x)" : ""}
       ORDER BY CASE r.doc_type WHEN 'order' THEN 0 ELSE 1 END, r.doc_id DESC, r.line_no DESC`,
    )
    .all(scoped.length ? { stk_key: key, stk_whs: scoped } : { stk_key: key })) as Array<{ doc_type: string; doc_id: number; warehouse: string; qty: number }>
  return rows.map((row) => ({
    docType: row.doc_type === "transfer" ? "transfer" : "order",
    docId: Number(row.doc_id),
    warehouse: row.warehouse ?? "",
    qty: Math.round(Number(row.qty) * 1e6) / 1e6,
  }))
}
