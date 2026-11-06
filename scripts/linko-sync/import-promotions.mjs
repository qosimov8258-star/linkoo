// Маркетинговые акции: every promotion of the Linko account with its full setup (products, gifts, conditions, audience,
// cashback terms) into ref_records kind 'promo'. The list fields keep the shape the page already reads
// (id, name, start, end, type, active); the reference document itself goes into `ref` for the detail card.
//
//   node scripts/linko-sync/import-promotions.mjs        (raw files: promotions, promotions_detail)
import { connect, ensureRegistry, raw, register, ruShortDate, runId, today } from "./lib.mjs"

const TYPE = { bonus: "Бонус", discount: "Скидка", addup: "Надбавка", ball: "Балл", cash_back: "Кэшбэк" }

const list = raw("promotions")
const details = raw("promotions_detail")
const run = runId("promotions")
const day = today()

const client = await connect()
await ensureRegistry(client)
let inserted = 0
let updated = 0
let same = 0
try {
  await client.query("BEGIN")
  for (const row of list) {
    const ref = details[row.id]
    if (!ref || ref.__status) throw new Error(`promotion ${row.id}: detail missing`)
    const begin = ref.begin_date ?? row.begin_date
    const till = ref.till_date ?? row.till_date
    const data = {
      id: row.id,
      name: ref.name ?? row.name,
      start: ruShortDate(begin),
      end: ruShortDate(till),
      type: TYPE[ref.type] ?? ref.type,
      active: Boolean(begin && till && begin <= day && day <= till),
      ref,
    }
    const current = (await client.query("SELECT data, deleted FROM ref_records WHERE kind = 'promo' AND id = $1", [String(row.id)])).rows[0]
    const text = JSON.stringify(data)
    if (!current) {
      await client.query("INSERT INTO ref_records (kind, id, data) VALUES ('promo', $1, $2)", [String(row.id), text])
      await register(client, run, "ref_records", `promo:${row.id}`, "insert")
      inserted++
    } else if (current.data !== text || current.deleted !== 0) {
      await client.query("UPDATE ref_records SET data = $2, deleted = 0, updated_at = datetime('now') WHERE kind = 'promo' AND id = $1", [String(row.id), text])
      await register(client, run, "ref_records", `promo:${row.id}`, "update", current)
      updated++
    } else same++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`promotions: ${list.length} in Linko; inserted ${inserted}, updated ${updated}, unchanged ${same}`)
