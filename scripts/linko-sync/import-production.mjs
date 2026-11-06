// Производство: in Linko every raw-material write-off (manufacture/manufacture_writeoff) and every product made
// (manufacture/manufacture_return) belongs to a batch (Партия) — the batch's raw_products / made_products are those
// same records. The earlier copy held each of them twice: once as the batch's movement and once more as a stage
// movement without a batch, so the stock counted production twice. This
// 1. removes the batch-less copies that repeat a batch movement (same stage, direction, product, quantity and day);
// 2. books production into the stock exactly as Linko's stock history (stock/barcode_history: "manufacture return" =
//    made, "manufacture writeoff" = raw used, per batch, with the warehouse it really moved) does: a batch line Linko
//    booked keeps that warehouse; a batch line Linko never booked stays on the batch with in_stock = 0; a booked
//    movement the batch no longer lists (older batches, cancelled batches whose movements Linko kept) is added as a
//    batch-less movement of the batch's stage.
//
//   node scripts/linko-sync/import-production.mjs     (raw: parties_detail, barcode_history)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("production")
const parties = raw("parties_detail")
const history = raw("barcode_history").filter((h) => ["manufacture return", "manufacture writeoff"].includes(h.generic?.type))

const client = await connect()
await ensureRegistry(client)
let removed = 0
const differences = []
const booked = { kept: 0, warehouseFixed: 0, notBooked: 0, added: 0 }
try {
  await client.query("BEGIN")
  // 1. Batch movements = Linko's batch lines.
  for (const party of Object.values(parties)) {
    if (party.__status) continue
    const want = [
      ...[...(party.made_products ?? []), ...(party.made_defects ?? [])].map((x) => `made|${x.product?.id}|${Number(x.amount)}`),
      ...[...(party.raw_products ?? []), ...(party.raw_defects ?? [])].map((x) => `raw|${x.product?.id}|${Number(x.amount)}`),
    ].sort()
    const have = (await client.query("SELECT direction, item_id, amount FROM production_movements WHERE party_id = $1 AND direction IN ('made', 'raw')", [party.id])).rows
      .map((m) => `${m.direction}|${m.item_id}|${Number(m.amount)}`)
      .sort()
    if (JSON.stringify(want) !== JSON.stringify(have)) differences.push(party.id)
  }
  // 2. Batch-less copies of batch movements.
  const copies = (
    await client.query(`
      SELECT m.* FROM production_movements m
      WHERE m.party_id IS NULL AND m.direction IN ('made', 'raw')
        AND EXISTS (
          SELECT 1 FROM production_movements p
          WHERE p.party_id IS NOT NULL AND p.direction = m.direction AND p.item_id IS NOT DISTINCT FROM m.item_id
            AND p.amount = m.amount AND left(p.date, 10) = left(m.date, 10) AND p.stage_id IS NOT DISTINCT FROM m.stage_id
        )`)
  ).rows
  for (const row of copies) {
    await client.query("DELETE FROM production_movements WHERE id = $1", [row.id])
    await register(client, run, "production_movements", row.id, "delete", row)
    removed++
  }

  // 3. Stock effect = Linko's stock history.
  await client.query("ALTER TABLE production_movements ADD COLUMN IF NOT EXISTS in_stock INTEGER NOT NULL DEFAULT 1")
  const local = (await client.query(
    `SELECT m.id, m.party_id, m.direction, m.item_id, m.amount, m.warehouse, m.in_stock, p.status AS party_status, p.stage_id AS party_stage
       FROM production_movements m JOIN production_parties p ON p.id = m.party_id WHERE m.direction IN ('made', 'raw')`,
  )).rows
  const used = new Set()
  const pending = []
  for (const h of [...history].sort((a, b) => a.id - b.id)) {
    const direction = h.generic.type === "manufacture return" ? "made" : "raw"
    const amount = Math.abs(Number(h.amount))
    const match = local.find(
      (m) => !used.has(m.id) && m.party_id === h.d_parent_id && m.direction === direction && m.item_id === h.product?.id && Math.abs(Number(m.amount) - amount) < 1e-6 && m.party_status !== "cancelled",
    )
    if (match) {
      used.add(match.id)
      const warehouse = h.stock?.name ?? match.warehouse
      if (match.warehouse !== warehouse || Number(match.in_stock) !== 1) {
        await client.query("UPDATE production_movements SET warehouse = $2, in_stock = 1 WHERE id = $1", [match.id, warehouse])
        await register(client, run, "production_movements", match.id, "update", { warehouse: match.warehouse, in_stock: match.in_stock })
        if (match.warehouse !== warehouse) booked.warehouseFixed++
      }
      booked.kept++
    } else pending.push({ h, direction, amount })
  }
  for (const m of local) {
    if (used.has(m.id) || Number(m.in_stock) === 0) continue
    await client.query("UPDATE production_movements SET in_stock = 0 WHERE id = $1", [m.id])
    await register(client, run, "production_movements", m.id, "update", { in_stock: m.in_stock })
    booked.notBooked++
  }
  // Booked movements no batch line stands for: batch-less movements of the batch's stage (added once: keyed by the
  // history id in the comment, so a re-run finds them).
  const marker = (id) => `Linko #${id}`
  for (const { h, direction, amount } of pending) {
    const exists = (await client.query("SELECT 1 FROM production_movements WHERE party_id IS NULL AND comment LIKE $1", [`%${marker(h.id)}%`])).rows.length
    if (exists) continue
    const party = (await client.query("SELECT id, stage_id FROM production_parties WHERE id = $1", [h.d_parent_id])).rows[0]
    const product = (await client.query("SELECT name, unit FROM products WHERE id = $1", [h.product?.id])).rows[0]
    const inserted = await client.query(
      `INSERT INTO production_movements (stage_id, party_id, warehouse, direction, item_kind, item_id, item_name, unit, amount, cost, is_defect, comment, date, user_name, created_at, in_stock)
       VALUES ($1, NULL, $2, $3, 'product', $4, $5, $6, $7, 0, $8, $9, $10, '', $11, 1) RETURNING id`,
      [
        party?.stage_id ?? null,
        h.stock?.name ?? "",
        direction,
        h.product?.id,
        product?.name ?? h.product?.name ?? "",
        product?.unit ?? h.product?.measurement?.name ?? "",
        amount,
        h.is_defect ? 1 : 0,
        `Партия №${h.d_parent_id} — ${marker(h.id)}`,
        String(h.created_date ?? "").slice(0, 10),
        String(h.created_date ?? "").slice(0, 19),
      ],
    )
    await register(client, run, "production_movements", inserted.rows[0].id, "insert")
    booked.added++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`production: batch-less copies removed ${removed}; batches whose lines differ from Linko: ${differences.length ? differences.join(",") : "none"}; stock history: ${JSON.stringify(booked)}`)
