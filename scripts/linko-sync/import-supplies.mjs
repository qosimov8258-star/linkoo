// Склад → Приход от поставщиков: every supply of the Linko account (accepted, pending, cancelled) with its product lines
// in `items` (the lines the stock ledger counts), its additional costs (supplier_incoming_expenses) and its history
// (supplier_incoming_logs). Supplies that are not in Linko — the fabricated demo / parity supplies registered in
// demo_seed_rows — are deleted, so the page and the stock show Linko's supplies only.
//
//   node scripts/linko-sync/import-supplies.mjs   (raw: supplies, supplies_detail, supply_expenses, supply_logs)
import { bumpSequence, connect, currencyCode, ensureRegistry, fullName, isoDay, raw, register, runId, sqlDateTime, upsertById } from "./lib.mjs"

const STATUS = { 0: "ожидает", 1: "ожидает", 2: "принят", 3: "ожидает", 4: "отменен" }
const PAYMENT = { cash: "Наличные", bank: "Банковский счет", card: "Пластиковая карта" }
// Linko history actions → the action codes this app writes (supplier_incoming_logs.action).
const LOG_ACTION = { created: "created", updated: "updated", arrived: "accepted", change_invoice: "updated", canceled: "cancelled", cancelled: "cancelled" }
const LOG_DETAILS = { change_invoice: "Счет-фактура изменена" }

const list = raw("supplies")
const details = raw("supplies_detail")
const expenses = raw("supply_expenses")
const logs = raw("supply_logs")
const run = runId("supplies")

const num = (v) => (v == null || v === "" ? 0 : Number(v))
const round = (v) => Math.round(v * 1e6) / 1e6

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, deleted: 0, expenses: 0, logs: 0 }
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS supplier_id INTEGER")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS is_inventory INTEGER NOT NULL DEFAULT 0")
  // 0 = a supply Linko has not confirmed yet: it is not planned for receiving (План приемок) until it is.
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS is_confirmed INTEGER NOT NULL DEFAULT 1")
  const ids = list.map((row) => row.id)

  // 1. Supplies that are not Linko's: only the ones a demo / parity seed wrote are removed.
  const seeded = new Set(
    (await client.query("SELECT row_id FROM demo_seed_rows WHERE table_name = 'supplier_incomings'")).rows.map((r) => Number(r.row_id)),
  )
  const foreign = (await client.query("SELECT * FROM supplier_incomings WHERE NOT (id = ANY($1::int[]))", [ids])).rows
  const kept = []
  for (const row of foreign) {
    if (!seeded.has(row.id)) {
      kept.push(row.id)
      continue
    }
    await client.query("DELETE FROM supplier_incomings WHERE id = $1", [row.id])
    await register(client, run, "supplier_incomings", row.id, "delete", row)
    stats.deleted++
  }

  // 2. Linko's supplies with their lines.
  for (const row of list) {
    const doc = details[row.id]
    if (!doc || doc.__status) throw new Error(`supply ${row.id}: detail missing`)
    const status = STATUS[Number(doc.status)] ?? "ожидает"
    const items = (doc.products ?? []).map((line, index) => {
      const qty = num(line.amount)
      const total = num(line.cost)
      const unit = line.price != null ? num(line.price) : qty ? total / qty : 0
      return {
        id: index + 1,
        key: line.product?.id ? `product:${line.product.id}` : "",
        product: line.product?.name ?? "",
        expiry: line.expiration_date ? isoDay(line.expiration_date) : "",
        series: line.series?.number ?? line.series?.display_name ?? (typeof line.series === "string" ? line.series : ""),
        qty,
        block: 0,
        kg: num(line.total_weight),
        netWeight: num(line.total_weight_netto),
        cost: round(unit),
        total: round(total),
        ...(line.posted_amount != null && num(line.posted_amount) !== qty ? { posted: num(line.posted_amount) } : {}),
      }
    })
    const values = {
      supplier: doc.provider?.name ?? "",
      warehouse: doc.stock?.name ?? "",
      date: isoDay(doc.date_delivery ?? row.date_delivery ?? doc.created_date) || isoDay(doc.accepted_time),
      payment_type: PAYMENT[doc.payment_type] ?? doc.custom_payment_type?.name ?? doc.payment_type ?? "",
      contract_number: doc.contract?.contract_number ?? doc.contract?.full_number ?? (doc.contract ? String(doc.contract.id ?? "") : ""),
      amount: num(doc.total_cost),
      status,
      invoice_number: doc.invoice_number ?? "",
      organization: doc.division?.name ?? "",
      branch: doc.branch?.name ?? "",
      phone: doc.contact?.phone || "Не указан",
      email: doc.contact?.email || "Не указан",
      initiator: fullName(doc.user),
      paid: num(doc.total_paid),
      time: "",
      comment: doc.comment ?? "",
      items: JSON.stringify(items),
      ref_items: "[]",
      currency: currencyCode(doc.currency),
      invoice_date: doc.invoice_date ? isoDay(doc.invoice_date) : "",
      accepted_at: status === "принят" ? (doc.accepted_time ?? "").slice(0, 19) : "",
      accepted_by: status === "принят" ? fullName(doc.accepted_by) : "",
      created_at: sqlDateTime(doc.created_date ?? doc.date_delivery) ?? sqlDateTime(doc.accepted_time),
      // The supplier by id (Linko suppliers may share a name); a supply Linko generated from an inventory surplus
      // charges no supplier.
      supplier_id: doc.provider?.id ?? null,
      is_inventory: doc.is_inventory ? 1 : 0,
      is_confirmed: (doc.is_confirmed ?? row.is_confirmed) === false ? 0 : 1,
    }
    stats[await upsertById(client, run, "supplier_incomings", row.id, values)]++
  }

  // 3. Additional costs (Доп. расход) and history: replaced per supply.
  const expensesOf = new Map()
  for (const e of expenses) {
    const sid = typeof e.supply === "object" ? e.supply?.id : e.supply
    if (!expensesOf.has(sid)) expensesOf.set(sid, [])
    expensesOf.get(sid).push(e)
  }
  const logsOf = new Map()
  for (const l of logs) {
    const sid = typeof l.supply === "object" ? l.supply?.id : l.supply
    if (!logsOf.has(sid)) logsOf.set(sid, [])
    logsOf.get(sid).push(l)
  }
  for (const id of ids) {
    const want = (expensesOf.get(id) ?? []).sort((a, b) => a.id - b.id)
    const before = (await client.query("SELECT * FROM supplier_incoming_expenses WHERE incoming_id = $1 ORDER BY id", [id])).rows
    if (want.length || before.length) {
      await client.query("DELETE FROM supplier_incoming_expenses WHERE incoming_id = $1", [id])
      for (const e of want) {
        await client.query(
          `INSERT INTO supplier_incoming_expenses (incoming_id, date, description, amount, currency, payment_type, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, isoDay(e.created_date), e.comment ?? "", num(e.amount), currencyCode(e.currency), PAYMENT[e.payment_type] ?? e.payment_type ?? "", "", sqlDateTime(e.created_date) ?? ""],
        )
        stats.expenses++
      }
      if (before.length || want.length) await register(client, run, "supplier_incoming_expenses", `supply:${id}`, "replace", before)
    }
    const wantLogs = (logsOf.get(id) ?? []).sort((a, b) => a.id - b.id)
    const beforeLogs = (await client.query("SELECT count(*)::int AS n FROM supplier_incoming_logs WHERE incoming_id = $1", [id])).rows[0].n
    if (wantLogs.length || beforeLogs) {
      await client.query("DELETE FROM supplier_incoming_logs WHERE incoming_id = $1", [id])
      for (const l of wantLogs) {
        await client.query("INSERT INTO supplier_incoming_logs (incoming_id, action, details, user_name, created_at) VALUES ($1, $2, $3, $4, $5)", [
          id,
          LOG_ACTION[l.action] ?? l.action ?? "",
          [LOG_DETAILS[l.action] ?? "", l.comment ?? ""].filter(Boolean).join(". "),
          fullName(l.created_by) || fullName(l.updated_by),
          sqlDateTime(l.created_date) ?? "",
        ])
        stats.logs++
      }
    }
  }
  await bumpSequence(client, "supplier_incomings")
  await client.query("COMMIT")
  console.log(
    `supplies: ${list.length} in Linko; inserted ${stats.insert}, updated ${stats.update}, unchanged ${stats.same}; demo supplies deleted ${stats.deleted}` +
      `${kept.length ? `, local-only kept ${kept.join(",")}` : ""}; expenses ${stats.expenses}; history rows ${stats.logs}`,
  )
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
