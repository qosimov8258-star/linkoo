import "server-only"

import type { PgDb } from "@/lib/db"

// The ledger books every production_movements line under its own row id, which names no document a user can find
// (that id is no batch №). The stock views name what a line belongs to instead, as Движение товаров does
// (lib/stock-movement-report.ts productionDocuments, MOVE_DOC_TYPES):
//   * a batch line: its batch, «Партия №100», opening the batch (a line copied from Linko outside its batch names
//     the batch in its comment, «Партия №64 — Linko #351641»);
//   * a stage's reconciliation (older versions' «Сверить»): «Инвентаризация №<id>», opening the stage's Активность;
//   * a shift entry of a stage (no batch): the stage's «Активность», no number, opening it;
//   * a balance copied from Linko («Работа с инвентарем», «Остаток без документа») or another adjustment: no
//     production document (no number, no link).
// docId 0 = no numbered document.

export type ProductionDocument = { docType: string; docId: number; href?: string }

type LineRow = { id: number; party_id: number | null; stage_id: number | null; inventory_id: number | null; direction: string; copied_party: number | null; adjustment: string }

const stagePage = (stageId: number) => `/analytics/production-stages?stage=${stageId}&tab=activity`

/** production_movements id → the document it is shown as. Ids of no line are left out (the caller numbers them 0). */
export async function describeProductionLines(db: PgDb, ids: number[]): Promise<Map<number, ProductionDocument>> {
  const result = new Map<number, ProductionDocument>()
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0 && id <= 2147483647))]
  if (!unique.length) return result
  // Optional columns are read through to_jsonb: an older production schema may lack them.
  const rows = (await db
    .prepare(
      `SELECT m.id, NULLIF(to_jsonb(m)->>'party_id', '')::int AS party_id, NULLIF(to_jsonb(m)->>'stage_id', '')::int AS stage_id,
              NULLIF(to_jsonb(m)->>'inventory_id', '')::int AS inventory_id, COALESCE(m.direction, '') AS direction,
              CASE WHEN m.direction IN ('made', 'raw') THEN substring(COALESCE(to_jsonb(m)->>'comment', '') from '^Партия №([0-9]{1,9}) — Linko #')::int END AS copied_party,
              CASE COALESCE(to_jsonb(m)->>'comment', '') WHEN 'Linko: инвентарь (Работа с инвентарем)' THEN 'inventory_work'
                   WHEN 'Linko: остаток без документа' THEN 'undocumented_stock' ELSE 'production_adjustment' END AS adjustment
         FROM production_movements m WHERE m.id = ANY(@ids::int[])`,
    )
    .all({ ids: unique })) as LineRow[]
  for (const line of rows) {
    const party = line.party_id ?? line.copied_party
    let document: ProductionDocument
    if (party) document = { docType: "production_parties", docId: Number(party), href: `/analytics/production-batches?party=${Number(party)}` }
    else if (line.direction === "adjust") {
      document =
        line.inventory_id && line.stage_id
          ? { docType: "production_inventories", docId: Number(line.inventory_id), href: stagePage(Number(line.stage_id)) }
          : { docType: line.adjustment, docId: 0 }
    } else if (line.stage_id) document = { docType: "production_activity", docId: 0, href: stagePage(Number(line.stage_id)) }
    else document = { docType: "production_movements", docId: 0 }
    result.set(Number(line.id), document)
  }
  return result
}
