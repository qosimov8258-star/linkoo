// «Управления кассой» list facts of Linko's own cash transactions (finance/transaction) that the merged local rows do not
// carry, plus the transactions Linko keeps unverified (the clock badge on that page):
//   - a client payment's cash transaction can name another type / order / client than its client transaction (Linko
//     shows «<client> Заказ № 1491» where the payment itself has no order): kept in linko_cash_list_facts (source
//     'customer') with the local row's client / type / order at import time; lib/cash/list.ts shows them only while the
//     local row still has those values (an edit in the app wins);
//   - an agent cash acceptance stored as a cash entry (no accepted payments) keeps the agent only in its description, an
//     order payment stored as a cash entry (its client transaction is gone) has no order column: linko_cash_list_facts
//     (source 'cash') gives the list «Принято денег с <agent>» (while the entry has no employee), «Заказ № <order>» and the
//     client of a withdrawal kept without one;
//   - unverified transactions (finance/transaction/unverified_transactions/, not in the own=True list the full copy used)
//     → cash_management_entries with is_verified = 0 (id = doc_no = Linko №) and their detalization lines; an
//     unverified transfer leg also completes its transfer header (to_organization / to_branch).
// Nothing here touches balances: unverified entries are left out of every ledger until someone verifies them.
//
//   node scripts/linko-sync/import-cash-list-facts.mjs        (DRY_RUN=1: report, then roll back)
//   raw: backups/linko-raw/2026-11-20/finance-cash/{cash_transactions_live,unverified_transactions}.json (read-only
//        harness captures; RAW_CASH=<dir> picks another folder, RAW=<folder> reads only <RAW>/finance-cash and
//        skips the step without it), client_transactions (full copy)
import fs from "node:fs"
import path from "node:path"

import { capturedOrSkip, connect, currencyCode, ensureRegistry, raw, register, runId } from "./lib.mjs"
import { counter, localIso, money, name, num, putRow, rateType, text, utcText } from "./finance-lib.mjs"

// RAW_CASH, else <RAW>/finance-cash (skipped when RAW lacks it), else the first account's capture of 2026-11-20.
const dir = capturedOrSkip("finance-cash", { env: "RAW_CASH", legacy: "2026-11-20/finance-cash" })
const readRaw = (file) => JSON.parse(fs.readFileSync(path.join(dir, `${file}.json`), "utf8")).data

const cashTx = readRaw("cash_transactions_live")
const unverified = readRaw("unverified_transactions").filter((c) => c.is_verified === false && !c.is_delete)
const clientTx = raw("client_transactions").filter((x) => x.type === 1 && x.transaction)
const paymentByCash = new Map(clientTx.map((p) => [typeof p.transaction === "object" ? p.transaction.id : p.transaction, p]))
const cashboxType = new Map()

const FACTS_DDL = `CREATE TABLE IF NOT EXISTS linko_cash_list_facts (
  source TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  op_type INTEGER,
  order_id INTEGER,
  client_id INTEGER,
  client_name TEXT,
  agent_id INTEGER,
  agent_name TEXT,
  local_op_type INTEGER,
  local_order_id INTEGER,
  local_client_id INTEGER,
  PRIMARY KEY (source, row_id)
)`

const run = runId("cash-list-facts")
const stats = counter()
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query(FACTS_DDL)
  for (const row of (await client.query("SELECT id, payment_type FROM cashboxes")).rows) cashboxType.set(Number(row.id), row.payment_type === "bank" ? "bank" : "cash")

  const putFact = async (source, rowId, values) => {
    const current = (await client.query("SELECT * FROM linko_cash_list_facts WHERE source = $1 AND row_id = $2", [source, rowId])).rows[0]
    const cols = Object.keys(values)
    if (!current) {
      await client.query(
        `INSERT INTO linko_cash_list_facts (source, row_id, ${cols.join(", ")}) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")})`,
        [source, rowId, ...cols.map((c) => values[c])],
      )
      await register(client, run, "linko_cash_list_facts", `${source}:${rowId}`, "insert")
      return "insert"
    }
    const changed = cols.filter((c) => String(current[c] ?? "") !== String(values[c] ?? ""))
    if (!changed.length) return "same"
    await client.query(`UPDATE linko_cash_list_facts SET ${changed.map((c, i) => `${c} = $${i + 3}`).join(", ")} WHERE source = $1 AND row_id = $2`, [
      source,
      rowId,
      ...changed.map((c) => values[c]),
    ])
    await register(client, run, "linko_cash_list_facts", `${source}:${rowId}`, "update", Object.fromEntries(changed.map((c) => [c, current[c]])))
    return "update"
  }

  // --- client payments whose cash transaction says something else -------------------------------------------------------
  for (const c of cashTx) {
    if (c.type !== 3 && c.type !== 6) continue
    const p = paymentByCash.get(c.id)
    if (!p) continue
    const local = (await client.query("SELECT id, op_type, order_id, client_id, client, accept_id FROM customer_payments WHERE id = $1", [p.id])).rows[0]
    if (!local || local.accept_id != null) continue
    const linkoClientId = c.client?.id ?? null
    const otherClient =
      (linkoClientId !== null && local.client_id != null && Number(local.client_id) !== linkoClientId) || (c.client && text(c.client.name) !== text(local.client))
    const differs = Number(local.op_type ?? 0) !== c.type || (local.order_id ?? null) !== (c.order ?? null) || otherClient
    if (!differs) continue
    stats.add(
      "linko_cash_list_facts",
      await putFact("customer", p.id, {
        op_type: c.type,
        order_id: c.order ?? null,
        client_id: linkoClientId,
        client_name: c.client ? text(c.client.name) : null,
        local_op_type: local.op_type ?? null,
        local_order_id: local.order_id ?? null,
        local_client_id: local.client_id ?? null,
      }),
    )
  }

  // --- cash entries: the agent of an acceptance, the order of an order payment ---------------------------------------------
  for (const c of cashTx) {
    const local = (await client.query("SELECT id, employee_id, op_type, client_name FROM cash_management_entries WHERE id = $1", [c.id])).rows[0]
    if (!local || Number(local.op_type) !== c.type) continue
    const values = {}
    if (c.type === 8 && c.user && local.employee_id == null) Object.assign(values, { agent_id: c.user.id ?? null, agent_name: name(c.user) })
    if (c.type === 3 && c.order) values.order_id = c.order
    // A client withdrawal whose client transaction is gone keeps no client on the entry (it must not touch the client
    // ledger); the list still names it.
    if (c.client && !text(local.client_name)) Object.assign(values, { client_id: c.client.id ?? null, client_name: text(c.client.name) })
    if (Object.keys(values).length) stats.add("linko_cash_list_facts", await putFact("cash", c.id, values))
  }

  // --- unverified transactions ---------------------------------------------------------------------------------------------
  for (const c of unverified) {
    const taken = (await client.query("SELECT 1 FROM cash_management_entries WHERE id = $1 AND doc_no <> $1", [c.id])).rowCount
    if (taken) throw new Error(`cash_management_entries ${c.id} already holds another document`)
    const op = c.type
    const transfer = c.transfer ?? null
    const fromName = text(transfer?.from_cashbox?.name)
    let description = op === 4 ? "Приход" : op === 5 ? "Расход" : ""
    if (op === 1) description = `Перевод в ${text((await client.query("SELECT name FROM cashboxes WHERE id = $1", [transfer?.to_cashbox])).rows[0]?.name)}`
    if (op === 2) description = `Перевод из ${fromName}`
    const responsible = op === 4 || op === 5 ? c.user ?? null : null
    stats.add(
      "cash_management_entries",
      await putRow(client, run, "cash_management_entries", c.id, {
        doc_no: c.id,
        cashbox_id: c.cashbox.id,
        description,
        category: op === 1 || op === 2 ? "Перевод" : text((c.income_category ?? c.expense_category)?.name),
        client_name: "",
        client_id: null,
        branch: text(c.branch?.name),
        organization: text(c.division?.name),
        comment: text(c.comment),
        entry_date: localIso(c.date),
        amount: money(c.amount),
        created_by: name(c.created_by),
        op_type: op,
        income_category_id: c.income_category?.id ?? null,
        expense_category_id: c.expense_category?.id ?? null,
        supply_id: c.supply?.id ?? (typeof c.supply === "number" ? c.supply : null),
        supply_expense_id: c.supply_expense?.id ?? (typeof c.supply_expense === "number" ? c.supply_expense : null),
        employee_id: responsible?.id ?? null,
        employee_name: responsible ? name(responsible) : "",
        transfer_id: transfer?.id ?? null,
        currency: currencyCode(c.currency),
        payment_type: c.payment_type === "bank" ? "bank" : (cashboxType.get(c.cashbox.id) ?? "cash"),
        internal_amount: num(c.internal_amount),
        custom_rate: num(c.custom_rate),
        rate_type: rateType(c.rate_type),
        is_verified: 0,
        verified_at: "",
        verified_by: "",
        is_deleted: 0,
        deleted_at: "",
        deleted_by: "",
        amortization_from: text(c.amortization_begin_date),
        amortization_to: text(c.amortization_end_date),
        created_at: utcText(c.created_date),
        updated_at: utcText(c.created_date),
      }),
    )
    let position = 0
    for (const child of c.transaction_child ?? []) {
      const owner = (await client.query("SELECT entry_id FROM cash_entry_children WHERE id = $1", [child.id])).rows[0]
      if (owner && Number(owner.entry_id) !== c.id) throw new Error(`cash_entry_children ${child.id} belongs to entry ${owner.entry_id}`)
      stats.add("cash_entry_children", await putRow(client, run, "cash_entry_children", child.id, { entry_id: c.id, name: text(child.name), amount: money(child.amount), position: position++ }))
    }
    // The receiving leg of a transfer names the header's receiving organization and branch.
    if (op === 2 && transfer?.id) {
      const header = (await client.query("SELECT id FROM cash_transfers WHERE id = $1", [transfer.id])).rows[0]
      if (header) stats.add("cash_transfers", await putRow(client, run, "cash_transfers", transfer.id, { to_organization: text(c.division?.name), to_branch: text(c.branch?.name) }))
    }
  }

  // Sequences only move up (other rows may already have taken higher numbers).
  for (const table of ["cash_management_entries", "cash_entry_children"]) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${table}),
         (SELECT last_value FROM ${table}_id_seq)))`,
    )
  }
  await client.query("SELECT setval('cash_doc_seq', GREATEST((SELECT last_value FROM cash_doc_seq), (SELECT COALESCE(MAX(doc_no), 1) FROM cash_management_entries)))")
  await client.query(process.env.DRY_RUN === "1" ? "ROLLBACK" : "COMMIT")
  stats.print(`cash list facts: ${cashTx.length} cash transactions, ${unverified.length} unverified (Linko)`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
