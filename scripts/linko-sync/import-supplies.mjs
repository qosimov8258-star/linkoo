// Склад → Приход от поставщиков: every supply of the Linko account (accepted, pending, cancelled) with its product lines
// in `items` (the lines the stock ledger counts), its additional costs (supplier_incoming_expenses) and its history
// (supplier_incoming_logs: Linko's action codes, the supply's status code at the time and the event day of
// «Добавить лог»). Also the invoice comment and the expected dates (will_be_sent_out_date / will_come_to_post_date),
// and per line the marking flag and counts (use_mark, mark_stat) and Linko's line id (linkoId, the «№» of «Скачать» →
// «Продукты поставки»). Linko's own «Оплачено» of the card (total_paid, from its debt allocation) is kept in linko_paid.
// Additional costs keep Linko's ids (cash entries point at them through supply_expense_id), their distribution type
// and the «Привязан к поставщику» flag. Supplies that are not in Linko — the fabricated demo / parity supplies
// registered in demo_seed_rows — are deleted, so the page and the stock show Linko's supplies only.
//
//   node scripts/linko-sync/import-supplies.mjs   (raw: supplies, supplies_detail, supply_expenses, supply_logs)
//   DRY=1 node scripts/linko-sync/import-supplies.mjs   lists the supplies and columns it would change, then rolls back
import { bumpSequence, connect, currencyCode, ensureRegistry, fullName, isoDay, raw, register, runId, sqlDateTime, upsertById } from "./lib.mjs"

const STATUS = { 0: "ожидает", 1: "ожидает", 2: "принят", 3: "ожидает", 4: "отменен" }
const PAYMENT = { cash: "Наличные", bank: "Банковский счет", card: "Пластиковая карта" }
// Linko history actions → the action codes this app writes (supplier_incoming_logs.action).
// change_invoice, sent_out and come_to_post keep Linko's code (the Логи tab names them like Linko).
const LOG_ACTION = { arrived: "accepted", cancel_arrived: "unaccepted", canceled: "cancelled" }

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
const dry = process.env.DRY === "1"
const changes = []
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS supplier_id INTEGER")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS is_inventory INTEGER NOT NULL DEFAULT 0")
  // 0 = a supply Linko has not confirmed yet: it is not planned for receiving (План приемок) until it is.
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS is_confirmed INTEGER NOT NULL DEFAULT 1")
  // The same columns as the app's schema (lib/supplier-incomings-repo.ts installSchema).
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS invoice_comment TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS will_be_sent_out_date TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS will_come_to_post_date TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE supplier_incoming_logs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE supplier_incoming_logs ADD COLUMN IF NOT EXISTS event_date TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE supplier_incomings ADD COLUMN IF NOT EXISTS linko_paid DOUBLE PRECISION")
  await client.query("ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS distribute_type TEXT NOT NULL DEFAULT 'cost'")
  await client.query("ALTER TABLE supplier_incoming_expenses ADD COLUMN IF NOT EXISTS bind_to_provider INTEGER NOT NULL DEFAULT 0")
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
        ...(line.id ? { linkoId: line.id } : {}),
        key: line.product?.id ? `product:${line.product.id}` : "",
        product: line.product?.name ?? "",
        // The line's own expiry, else its series' (Linko's card shows the series' date under «Срок годности»).
        expiry: line.expiration_date ? isoDay(line.expiration_date) : line.series?.expiration_date ? isoDay(line.series.expiration_date) : "",
        series: line.series?.number ?? line.series?.display_name ?? (typeof line.series === "string" ? line.series : ""),
        qty,
        block: 0,
        kg: num(line.total_weight),
        netWeight: num(line.total_weight_netto),
        cost: round(unit),
        total: round(total),
        ...(line.posted_amount != null && num(line.posted_amount) !== qty ? { posted: num(line.posted_amount) } : {}),
        // Marking (Маркировка): the product needed codes; Linko's counts in the invoice / scanned / scanned extra.
        ...(line.product?.use_mark
          ? {
              useMark: true,
              markStat: {
                inInvoice: num(line.mark_stat?.has_in_invoice_count),
                inStock: num(line.mark_stat?.has_in_stock_count),
                extra: num(line.mark_stat?.extra_in_stock_count),
              },
            }
          : {}),
      }
    })
    const values = {
      supplier: doc.provider?.name ?? "",
      warehouse: doc.stock?.name ?? "",
      date: isoDay(doc.date_delivery ?? row.date_delivery ?? doc.created_date) || isoDay(doc.accepted_time),
      payment_type: PAYMENT[doc.payment_type] ?? doc.custom_payment_type?.name ?? doc.payment_type ?? "",
      // Linko's supply serializer gives the contract as its plain number ("19").
      contract_number:
        typeof doc.contract === "string" || typeof doc.contract === "number"
          ? String(doc.contract).trim()
          : (doc.contract?.contract_number ?? doc.contract?.full_number ?? (doc.contract ? String(doc.contract.id ?? "") : "")),
      amount: num(doc.total_cost),
      status,
      invoice_number: doc.invoice_number ?? "",
      organization: doc.division?.name ?? "",
      branch: doc.branch?.name ?? "",
      phone: doc.contact?.phone || "Не указан",
      email: doc.contact?.email || "Не указан",
      initiator: fullName(doc.user),
      paid: num(doc.total_paid),
      linko_paid: num(doc.total_paid),
      time: "",
      comment: doc.comment ?? "",
      items: JSON.stringify(items),
      ref_items: "[]",
      currency: currencyCode(doc.currency),
      invoice_date: doc.invoice_date ? isoDay(doc.invoice_date) : "",
      invoice_comment: doc.invoice_comment ?? "",
      will_be_sent_out_date: doc.will_be_sent_out_date ? isoDay(doc.will_be_sent_out_date) : "",
      will_come_to_post_date: doc.will_come_to_post_date ? isoDay(doc.will_come_to_post_date) : "",
      accepted_at: status === "принят" ? (doc.accepted_time ?? "").slice(0, 19) : "",
      accepted_by: status === "принят" ? fullName(doc.accepted_by) : "",
      created_at: sqlDateTime(doc.created_date ?? doc.date_delivery) ?? sqlDateTime(doc.accepted_time),
      // The supplier by id (Linko suppliers may share a name); a supply Linko generated from an inventory surplus
      // charges no supplier.
      supplier_id: doc.provider?.id ?? null,
      is_inventory: doc.is_inventory ? 1 : 0,
      is_confirmed: (doc.is_confirmed ?? row.is_confirmed) === false ? 0 : 1,
    }
    if (dry) {
      const current = (await client.query(`SELECT ${Object.keys(values).map((c) => `"${c}"`).join(", ")} FROM supplier_incomings WHERE id = $1`, [row.id])).rows[0]
      const differ = current ? Object.keys(values).filter((c) => String(current[c] ?? "") !== String(values[c] ?? "")) : ["(new)"]
      if (differ.length) changes.push(`${row.id}: ${differ.join(", ")}`)
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
    // Additional costs under Linko's ids: a re-run updates them in place, and cash entries keep pointing at them.
    const want = (expensesOf.get(id) ?? []).sort((a, b) => a.id - b.id)
    const wantIds = new Set(want.map((e) => Number(e.id)))
    const before = (await client.query("SELECT * FROM supplier_incoming_expenses WHERE incoming_id = $1 ORDER BY id", [id])).rows
    for (const row of before) {
      if (wantIds.has(Number(row.id))) continue
      await client.query("DELETE FROM supplier_incoming_expenses WHERE id = $1", [row.id])
      await register(client, run, "supplier_incoming_expenses", row.id, "delete", row)
    }
    for (const e of want) {
      const taken = (await client.query("SELECT incoming_id FROM supplier_incoming_expenses WHERE id = $1", [e.id])).rows[0]
      if (taken && Number(taken.incoming_id) !== id) throw new Error(`expense ${e.id}: the id belongs to supply ${taken.incoming_id}`)
      await upsertById(client, run, "supplier_incoming_expenses", e.id, {
        incoming_id: id,
        date: isoDay(e.created_date),
        description: e.comment ?? "",
        amount: num(e.amount),
        currency: currencyCode(e.currency),
        payment_type: PAYMENT[e.payment_type] ?? e.payment_type ?? "",
        created_by: "",
        created_at: sqlDateTime(e.created_date) ?? "",
        distribute_type: e.distribute_type || "cost",
        bind_to_provider: e.bind_to_provider ? 1 : 0,
      })
      stats.expenses++
    }
    const wantLogs = (logsOf.get(id) ?? []).sort((a, b) => a.id - b.id)
    const beforeLogs = (await client.query("SELECT count(*)::int AS n FROM supplier_incoming_logs WHERE incoming_id = $1", [id])).rows[0].n
    if (wantLogs.length || beforeLogs) {
      await client.query("DELETE FROM supplier_incoming_logs WHERE incoming_id = $1", [id])
      for (const l of wantLogs) {
        await client.query(
          "INSERT INTO supplier_incoming_logs (incoming_id, action, details, user_name, created_at, status, event_date) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            id,
            LOG_ACTION[l.action] ?? l.action ?? "",
            l.comment ?? "",
            fullName(l.created_by) || fullName(l.updated_by),
            sqlDateTime(l.created_date) ?? "",
            l.status == null ? "" : String(l.status),
            l.date ? isoDay(l.date) : "",
          ],
        )
        stats.logs++
      }
    }
  }
  await bumpSequence(client, "supplier_incomings")
  // Past Linko's expense ids, never lowered (expenses added in the app keep their ids).
  await client.query(
    `SELECT setval(pg_get_serial_sequence('supplier_incoming_expenses', 'id'),
       GREATEST((SELECT COALESCE(MAX(id), 1) FROM supplier_incoming_expenses),
                (SELECT last_value FROM supplier_incoming_expenses_id_seq)))`,
  )
  if (dry) {
    console.log(changes.length ? changes.join("\n") : "no supply changes")
    await client.query("ROLLBACK")
  } else await client.query("COMMIT")
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
