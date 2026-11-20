// Продажи → Бонусы клиентов: the history of every client's points (Linko's sales/client_promotion/<client>/detail/:
// [{id, client, promotion: {id, name} | null, amount, type, comment, ball, order_product: {id, product, order_id} | null,
// created_date}]) into client_bonus_entries, the table the page reads (lib/client-bonuses-repo.ts). A client's points
// and «Дата последнего бала» are the sum and the newest of its entries, as in Linko.
//
// Raw files (backups/linko-raw/<date>/, the newest folder that has them; RAW=<folder> picks one):
// - client_promotion_details.json: {data: {<client id>: [entries]}} (one read-only capture of the dialog per client);
// - client_promotions.json: Linko's list (sales/client_promotion/, {data: [{id, name, ball, last_created}]}), used to
//   check that the copied entries add up to Linko's points of every client.
// Rows keep Linko's entry id (linko_id): a re-run updates them in place. Entries added in the app are left alone.
//
//   node scripts/linko-sync/import-client-bonuses.mjs
import fs from "node:fs"
import path from "node:path"

import { ROOT, connect, ensureRegistry, register, runId } from "./lib.mjs"

const DETAILS = "client_promotion_details.json"
const LIST = "client_promotions.json"

function rawFolder() {
  if (process.env.RAW) return process.env.RAW
  const base = path.join(ROOT, "backups", "linko-raw")
  const days = fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse() : []
  const day = days.find((name) => fs.existsSync(path.join(base, name, DETAILS)))
  return day ? path.join(base, day) : null
}

const folder = rawFolder()
if (!folder) {
  console.log(`client bonuses: no raw ${DETAILS} (capture the clients' bonus dialogs first)`)
  process.exit(0)
}
const details = JSON.parse(fs.readFileSync(path.join(folder, DETAILS), "utf8")).data ?? {}
const listFile = path.join(folder, LIST)
const list = fs.existsSync(listFile) ? (JSON.parse(fs.readFileSync(listFile, "utf8")).data ?? []) : []

// Same table as lib/client-bonuses-repo.ts (the app creates it too; a fresh database gets it from either).
const DDL = `
CREATE TABLE IF NOT EXISTS client_bonus_entries (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  promotion_id INTEGER,
  promotion_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'custom_ball',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  ball DOUBLE PRECISION NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  order_product_id INTEGER,
  product_id INTEGER,
  product_name TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT '',
  linko_id INTEGER
);
CREATE INDEX IF NOT EXISTS client_bonus_entries_client_idx ON client_bonus_entries (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS client_bonus_entries_linko_idx ON client_bonus_entries (linko_id) WHERE linko_id IS NOT NULL;
`

const COLUMNS = ["client_id", "promotion_id", "promotion_name", "type", "amount", "ball", "comment", "order_id", "order_product_id", "product_id", "product_name", "created_at"]

const number = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
const intOrNull = (value) => (Number.isInteger(value) ? value : null)
/** Linko's created_date ("2026-04-22T23:29:02.675112", Tashkent wall time) → "2026-04-22T23:29:02". */
const moment = (value) => (typeof value === "string" ? value.trim().replace(" ", "T").slice(0, 19) : "")

function values(clientId, entry) {
  const product = entry.order_product ?? null
  return {
    client_id: clientId,
    promotion_id: intOrNull(entry.promotion?.id),
    promotion_name: String(entry.promotion?.name ?? ""),
    type: String(entry.type ?? "custom_ball"),
    amount: number(entry.amount),
    ball: number(entry.ball),
    comment: String(entry.comment ?? ""),
    order_id: intOrNull(product?.order_id),
    order_product_id: intOrNull(product?.id),
    product_id: intOrNull(product?.product?.id),
    product_name: String(product?.product?.name ?? ""),
    created_at: moment(entry.created_date),
  }
}

function same(current, next) {
  return COLUMNS.every((column) => {
    const a = current[column]
    const b = next[column]
    if (a == null || b == null) return a == null && b == null
    if (typeof b === "number") return Math.abs(Number(a) - b) < 1e-9
    return String(a) === String(b)
  })
}

const run = runId("client-bonuses")
const client = await connect()
await ensureRegistry(client)
const stats = { clients: 0, entries: 0, insert: 0, update: 0, same: 0, unknownClients: [] }
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(hashtext('linko:client_bonus_entries:schema'))")
  await client.query(DDL)
  const accounts = new Set((await client.query("SELECT id FROM financial_accounts")).rows.map((row) => Number(row.id)))
  for (const [key, entries] of Object.entries(details)) {
    const clientId = Number(key)
    if (!Array.isArray(entries)) continue
    stats.clients++
    if (!accounts.has(clientId)) {
      stats.unknownClients.push(clientId)
      continue
    }
    for (const entry of entries) {
      if (!Number.isInteger(entry?.id)) continue
      stats.entries++
      const next = values(clientId, entry)
      const current = (await client.query(`SELECT id, ${COLUMNS.join(", ")} FROM client_bonus_entries WHERE linko_id = $1`, [entry.id])).rows[0]
      if (!current) {
        const inserted = await client.query(
          `INSERT INTO client_bonus_entries (${COLUMNS.join(", ")}, linko_id) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")}, $${COLUMNS.length + 1}) RETURNING id`,
          [...COLUMNS.map((column) => next[column]), entry.id],
        )
        await register(client, run, "client_bonus_entries", inserted.rows[0].id, "insert")
        stats.insert++
      } else if (same(current, next)) {
        stats.same++
      } else {
        await client.query(`UPDATE client_bonus_entries SET ${COLUMNS.map((column, i) => `${column} = $${i + 2}`).join(", ")} WHERE id = $1`, [
          current.id,
          ...COLUMNS.map((column) => next[column]),
        ])
        const previous = Object.fromEntries(COLUMNS.map((column) => [column, current[column]]))
        await register(client, run, "client_bonus_entries", current.id, "update", previous)
        stats.update++
      }
    }
  }
  // Check: the copied entries of every client add up to Linko's points and newest moment.
  const sums = new Map(
    (await client.query("SELECT client_id, SUM(ball) AS ball, MAX(created_at) AS last FROM client_bonus_entries WHERE linko_id IS NOT NULL GROUP BY client_id")).rows.map((row) => [
      Number(row.client_id),
      { ball: Number(row.ball), last: row.last },
    ]),
  )
  const mismatches = []
  for (const row of list) {
    const local = sums.get(Number(row.id)) ?? { ball: 0, last: null }
    const last = row.last_created ? moment(row.last_created) : null
    if (Math.abs(local.ball - number(row.ball)) > 1e-6 || (local.last ?? null) !== last) mismatches.push(`${row.id} (Linko ${number(row.ball)} / ${last}, copied ${local.ball} / ${local.last})`)
  }
  await client.query("COMMIT")
  console.log(
    `client bonuses: ${stats.clients} clients, ${stats.entries} entries; inserted ${stats.insert}, updated ${stats.update}, unchanged ${stats.same}` +
      (stats.unknownClients.length ? `; clients missing here: ${stats.unknownClients.join(", ")}` : "") +
      (list.length ? `; checked ${list.length} clients against Linko's list, ${mismatches.length} differ${mismatches.length ? ": " + mismatches.slice(0, 20).join(", ") : ""}` : ""),
  )
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
