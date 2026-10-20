import "server-only"

import type { StockTables } from "@/lib/stock/schema"

// The movement ledger: one UNION ALL of SELECTs over the warehouse documents,
// each emitting uniform rows
//   day        text   'YYYY-MM-DD' local (Asia/Tashkent) day of the movement
//   warehouse  text   warehouse name as written on the document
//   item_key   text   'product:<id>' | 'raw_material:<id>' | 'name:<fin_key>'
//   qty        double precision  signed quantity
//   value      double precision  signed value at document cost, base currency (0 when unknown)
//   kind       text   StockMoveKind
//   doc_type   text   source table
//   doc_id     integer
//   is_defect  integer 0/1 (production output booked as defective, and write-off /
//              transfer lines that move such defective units: "Брак")
// Document lines are JSON arrays in TEXT columns, keyed by product NAME: the
// name is matched to the catalog by fin_key() (products first, then raw
// materials); unmatched names keep a 'name:<key>' item so nothing disappears.
// Performance: per-document values (day, currency rate, parsed JSON) are
// computed once per document (MATERIALIZED CTEs), and names are normalised
// once per DISTINCT spelling (stk_raw), not once per line.
// Values are bound as @stk_* parameters, and no SQL here contains a question
// mark (the db shim would treat it as a positional placeholder).

/** Columns of every movement row, in order. */
export const MOVEMENT_COLUMNS = ["day", "warehouse", "item_key", "qty", "value", "kind", "doc_type", "doc_id", "is_defect"] as const

/** Kinds that bring goods in at a known unit cost (the average-cost basis). */
export const COST_RECEIPT_FILTER = `(qty > 0 AND (kind = 'supply' OR (kind = 'manufacture_in' AND is_defect = 0) OR (kind = 'inventory_in' AND value > 0)))`

/** The parsed JSON of a TEXT column, NULL when blank or invalid (parse once per document). */
function jsonDoc(column: string): string {
  return `CASE WHEN pg_input_is_valid(${column}, 'jsonb') THEN ${column}::jsonb END`
}

/** Elements of a parsed JSON document column ('[]' unless it is an array). */
function jsonElements(parsed: string): string {
  return `jsonb_array_elements(CASE WHEN jsonb_typeof(${parsed}) = 'array' THEN ${parsed} ELSE '[]'::jsonb END)`
}

/** The JSON array of a TEXT column; '[]' when blank, invalid or not an array. */
export function jsonLines(column: string): string {
  return `COALESCE(CASE WHEN pg_input_is_valid(${column}, 'jsonb') THEN CASE WHEN jsonb_typeof(${column}::jsonb) = 'array' THEN ${column}::jsonb END END, '[]'::jsonb)`
}

/** A JSON field (number, or numeric text with comma decimals) as a double; 0 otherwise. */
export function jsonNum(element: string, field: string): string {
  const text = `replace(btrim(${element} ->> '${field}'), ',', '.')`
  return `(CASE jsonb_typeof(${element} -> '${field}')
    WHEN 'number' THEN (${element} ->> '${field}')::double precision
    WHEN 'string' THEN CASE WHEN ${text} ~ '^-{0,1}([0-9]+([.][0-9]*){0,1}|[.][0-9]+)([eE][-+]{0,1}[0-9]+){0,1}$' THEN ${text}::double precision ELSE 0 END
    ELSE 0 END)`
}

/** First parseable date of the candidates as 'YYYY-MM-DD' ('1970-01-01' = undated: counts as always). */
function dayOf(...candidates: string[]): string {
  return `COALESCE(to_char(COALESCE(${candidates.join(", ")}), 'YYYY-MM-DD'), '1970-01-01')`
}

/** Units of base currency per unit of `currency` (1 when unknown, as the finance stock did). */
function rateOf(currency: string): string {
  return `COALESCE((@stk_rates::jsonb ->> COALESCE(fin_cur(${currency}), @stk_base))::double precision, 1)`
}

/** The rate snapshot of a document (contract 2: `rate_to_base` at acceptance) when it
 * has one, else the live rate of its currency. */
function snapshotRate(snapshot: string | null, currency: string): string {
  return snapshot ? `COALESCE(NULLIF(${snapshot}, 0), ${rateOf(currency)})` : rateOf(currency)
}

/** A JSON line flag ("defect": true) as 0/1. */
function jsonFlag(element: string, field: string): string {
  return `(CASE WHEN lower(COALESCE(${element} ->> '${field}', '')) IN ('true', '1') THEN 1 ELSE 0 END)`
}

const KEY_JOIN = (alias: string, name: string) => `LEFT JOIN stk_names ${alias} ON ${alias}.k = fin_key(${name})`
const KEY_OF = (alias: string, name: string) => `COALESCE(${alias}.item_key, 'name:' || fin_key(${name}))`

const EMPTY = `SELECT NULL::text AS day, NULL::text AS warehouse, NULL::text AS item_key, NULL::double precision AS qty, NULL::double precision AS value,
  NULL::text AS kind, NULL::text AS doc_type, NULL::integer AS doc_id, NULL::integer AS is_defect WHERE false`

function namesCte(t: StockTables): string {
  const parts: string[] = []
  if (t.has("products")) {
    const alive = t.col("products", "deleted") ? "WHERE COALESCE(deleted, 0) = 0" : ""
    parts.push(`SELECT fin_key(name) AS k, 'product:' || id AS item_key, 0 AS pri, id FROM products ${alive}`)
  }
  if (t.has("raw_materials")) {
    const alive = t.col("raw_materials", "deleted") ? "WHERE COALESCE(deleted, 0) = 0" : ""
    parts.push(`SELECT fin_key(name), 'raw_material:' || id, 1, id FROM raw_materials ${alive}`)
  }
  if (!parts.length) return "stk_names AS MATERIALIZED (SELECT NULL::text AS k, NULL::text AS item_key WHERE false)"
  return `stk_names AS MATERIALIZED (
    SELECT DISTINCT ON (k) k, item_key FROM (${parts.join(" UNION ALL ")}) x WHERE k <> '' ORDER BY k, pri, id
  )`
}

/** A line row of a JSON document: (day, warehouse, raw name, qty, value, kind, doc_type, doc_id, is_defect). */
function lineRow(day: string, warehouse: string, raw: string, qty: string, value: string, kind: string, docType: string, docId: string, from: string, isDefect = "0"): string {
  return `SELECT ${day} AS day, (${warehouse})::text AS warehouse, (${raw})::text AS raw, (${qty})::double precision AS qty,
    (${value})::double precision AS value, '${kind}'::text AS kind, '${docType}'::text AS doc_type, (${docId})::integer AS doc_id,
    (${isDefect})::integer AS is_defect
  ${from}`
}

function row(day: string, warehouse: string, key: string, qty: string, value: string, kind: string, docType: string, docId: string, isDefect: string, from: string): string {
  return `SELECT ${day} AS day, (${warehouse})::text AS warehouse, (${key})::text AS item_key, (${qty})::double precision AS qty,
    (${value})::double precision AS value, (${kind})::text AS kind, (${docType})::text AS doc_type, (${docId})::integer AS doc_id,
    (${isDefect})::integer AS is_defect
  ${from}`
}

/** SQL of the whole ledger (a WITH … SELECT usable as a subquery).
 * Parameters: @stk_base, @stk_rates (JSON {code: rate}), @stk_exclude_inv. */
export function buildMovementsSql(t: StockTables): string {
  const ctes = [namesCte(t)]
  const lines: string[] = []
  const parts: string[] = []
  const col = (table: string, column: string, alias: string, fallback = "NULL") => (t.col(table, column) ? `${alias}.${column}` : fallback)

  // Поставки: accepted supplies; unit cost incl. the supply's additional
  // expenses spread over the lines (supplyCostLines), in base currency at the
  // rate saved on acceptance (rate_to_base) when there is one. Booked on the
  // document date (a back-dated supply counts from its date), never later
  // than the acceptance: the earlier of the two.
  if (t.has("supplier_incomings")) {
    const accepted = t.col("supplier_incomings", "accepted_at") ? "fin_ts(i.accepted_at)" : "NULL::timestamp"
    const currency = col("supplier_incomings", "currency", "i", "''")
    let expense = "0::double precision"
    if (t.has("supplier_incoming_expenses")) {
      const expCurrency = t.col("supplier_incoming_expenses", "currency") ? `COALESCE(NULLIF(btrim(e.currency), ''), ${currency})` : currency
      const expRate = snapshotRate(t.col("supplier_incoming_expenses", "rate_to_base") ? "e.rate_to_base" : null, expCurrency)
      expense = `(SELECT SUM(COALESCE(e.amount, 0) * ${expRate}) FROM supplier_incoming_expenses e WHERE e.incoming_id = i.id)`
    }
    const rate = snapshotRate(t.col("supplier_incomings", "rate_to_base") ? "i.rate_to_base" : null, currency)
    ctes.push(`stk_sup_doc AS MATERIALIZED (
      SELECT i.id, i.warehouse, ${dayOf(`LEAST(fin_ts(i.date), ${accepted})`, "fin_ts(i.created_at, true)")} AS day, ${rate} AS rate,
             COALESCE(${expense}, 0) AS expense, ${jsonDoc("i.items")} AS js
      FROM supplier_incomings i WHERE i.status = 'принят'
    )`)
    ctes.push(`stk_sup AS MATERIALIZED (
      SELECT d.id, d.warehouse, d.day, d.rate, d.expense, l.j ->> 'product' AS raw, ${jsonNum("l.j", "qty")} AS qty, ${jsonNum("l.j", "cost")} AS cost
      FROM stk_sup_doc d CROSS JOIN LATERAL ${jsonElements("d.js")} AS l(j)
    )`)
    ctes.push("stk_sup_tot AS (SELECT id, SUM(qty * cost) AS value, SUM(qty) AS qty FROM stk_sup GROUP BY id)")
    lines.push(
      lineRow(
        "s.day",
        "s.warehouse",
        "s.raw",
        "s.qty",
        "s.qty * s.cost * s.rate + s.expense * (CASE WHEN st.value > 0 THEN s.qty * s.cost / st.value WHEN st.qty > 0 THEN s.qty / st.qty ELSE 0 END)",
        "supply",
        "supplier_incomings",
        "s.id",
        "FROM stk_sup s JOIN stk_sup_tot st ON st.id = s.id",
      ),
    )
  }

  // Возврат по поставкам: handed back to the supplier ("завершен"), on the
  // document date like the supply (never later than the hand-over). The value
  // is the return price; the cost ledger (lib/stock/costs.ts) takes the goods
  // out at their moving-average cost.
  if (t.has("supplier_returns")) {
    const transfer = t.col("supplier_returns", "transfer_time") ? "fin_ts(r.transfer_time)" : "NULL::timestamp"
    const currency = col("supplier_returns", "currency", "r", "''")
    const rate = snapshotRate(t.col("supplier_returns", "rate_to_base") ? "r.rate_to_base" : null, currency)
    ctes.push(`stk_ret_doc AS MATERIALIZED (
      SELECT r.id, r.warehouse, ${dayOf(`LEAST(fin_ts(r.date), ${transfer})`, "fin_ts(r.created_at, true)")} AS day, ${rate} AS rate, ${jsonDoc("r.items")} AS js
      FROM supplier_returns r WHERE r.status = 'завершен'
    )`)
    lines.push(
      lineRow("d.day", "d.warehouse", "l.j ->> 'product'", `-${jsonNum("l.j", "qty")}`, `-${jsonNum("l.j", "qty")} * ${jsonNum("l.j", "price")} * d.rate`, "supply_return", "supplier_returns", "d.id", `FROM stk_ret_doc d CROSS JOIN LATERAL ${jsonElements("d.js")} AS l(j)`),
    )
  }

  // Списано: only finished write-offs ("закрыт") leave the warehouse;
  // pending ("ожидает", legacy "открыт") and cancelled ("отменен") do not.
  // Lines flagged "defect" take defective units (Брак) out.
  if (t.has("write_offs")) {
    const status = t.col("write_offs", "status") ? "w.status = 'закрыт'" : "true"
    ctes.push(`stk_wo_doc AS MATERIALIZED (
      SELECT w.id, w.warehouse, ${dayOf("fin_ts(w.date)", "fin_ts(w.created_at, true)")} AS day, ${jsonDoc("w.items")} AS js
      FROM write_offs w WHERE ${status}
    )`)
    lines.push(
      lineRow(
        "d.day",
        "d.warehouse",
        "l.j ->> 'product'",
        `-${jsonNum("l.j", "qty")}`,
        `-${jsonNum("l.j", "qty")} * ${jsonNum("l.j", "cost")}`,
        "writeoff",
        "write_offs",
        "d.id",
        `FROM stk_wo_doc d CROSS JOIN LATERAL ${jsonElements("d.js")} AS l(j)`,
        jsonFlag("l.j", "defect"),
      ),
    )
  }

  // Внутренние перемещения: leave the source once given ("в пути", on the
  // given day), reach the target once accepted ("принят", on the accepted
  // day). "ожидает" / "потвержден" / "отменен" do not move goods. Rows from
  // before the given / accepted columns fall back to the document dates. Line
  // prices are price-list (or cost) prices, so the value is unknown here (0);
  // the cost ledger values both legs at the moving-average cost. Lines
  // flagged "defect" move defective units (Брак) on both sides.
  if (t.has("internal_transfers")) {
    const created = t.col("internal_transfers", "created_at_label") ? "fin_ts(tr.created_at_label)" : "NULL::timestamp"
    const delivered = t.col("internal_transfers", "delivered_at") ? "fin_ts(tr.delivered_at)" : "NULL::timestamp"
    const given = t.col("internal_transfers", "given_at") ? "fin_ts(tr.given_at)" : "NULL::timestamp"
    const accepted = t.col("internal_transfers", "accepted_at") ? "fin_ts(tr.accepted_at)" : "NULL::timestamp"
    ctes.push(`stk_tr_doc AS MATERIALIZED (
      SELECT tr.id, tr.status, tr.from_warehouse, tr.to_warehouse, ${dayOf(given, created, "fin_ts(tr.created_at, true)")} AS out_day,
             ${dayOf(accepted, delivered, created, "fin_ts(tr.created_at, true)")} AS in_day, ${jsonDoc("tr.items")} AS js
      FROM internal_transfers tr WHERE tr.status IN ('в пути', 'принят')
    )`)
    ctes.push(`stk_tr AS MATERIALIZED (
      SELECT d.id, d.status, d.from_warehouse, d.to_warehouse, d.out_day, d.in_day, l.j ->> 'product' AS raw, ${jsonNum("l.j", "quantity")} AS qty,
             ${jsonFlag("l.j", "defect")} AS defect
      FROM stk_tr_doc d CROSS JOIN LATERAL ${jsonElements("d.js")} AS l(j)
    )`)
    lines.push(lineRow("x.out_day", "x.from_warehouse", "x.raw", "-x.qty", "0", "transfer_out", "internal_transfers", "x.id", "FROM stk_tr x", "x.defect"))
    lines.push(lineRow("x.in_day", "x.to_warehouse", "x.raw", "x.qty", "0", "transfer_in", "internal_transfers", "x.id", "FROM stk_tr x WHERE x.status = 'принят'", "x.defect"))
  }

  if (lines.length) {
    ctes.push(`stk_lines AS MATERIALIZED (${lines.join("\nUNION ALL\n")})`)
    // One fin_key() per distinct spelling; empty names are dropped.
    ctes.push(`stk_raw AS MATERIALIZED (
      SELECT r.raw, COALESCE(n.item_key, 'name:' || r.k) AS item_key
      FROM (SELECT raw, fin_key(raw) AS k FROM (SELECT DISTINCT raw FROM stk_lines) d) r
      LEFT JOIN stk_names n ON n.k = r.k
      WHERE r.k <> ''
    )`)
    parts.push(row("l.day", "l.warehouse", "r.item_key", "l.qty", "l.value", "l.kind", "l.doc_type", "l.doc_id", "l.is_defect", "FROM stk_lines l JOIN stk_raw r ON r.raw = l.raw"))
  }

  // Производство: output (+, defects flagged), raw-material use (−) and
  // inventory adjustments (±) of batches that were not cancelled.
  // Брак carries no value: the good output of a batch absorbs the value of
  // everything the batch made (Σ made value = Σ raw value, however the batch
  // spread it over its good and defective lines), so a good unit costs
  // made value ÷ good units and defective units are worth 0. A batch with no
  // good output (yet) books its output at the document cost.
  if (t.has("production_movements")) {
    const parties = t.has("production_parties")
    const exact = t.col("production_movements", "item_kind") && t.col("production_movements", "item_id")
    const isExact = "m.item_kind IN ('product', 'raw_material') AND m.item_id IS NOT NULL"
    const key = exact ? `CASE WHEN ${isExact} THEN m.item_kind || ':' || m.item_id ELSE ${KEY_OF("n", "m.item_name")} END` : KEY_OF("n", "m.item_name")
    // The name join only runs for rows without an exact item reference.
    const join = exact ? `LEFT JOIN stk_names n ON n.k = (CASE WHEN ${isExact} THEN NULL ELSE fin_key(m.item_name) END)` : KEY_JOIN("n", "m.item_name")
    const amount = "COALESCE(m.amount, 0)"
    const cost = "COALESCE(m.cost, 0)"
    const hasDefect = t.col("production_movements", "is_defect")
    const defect = hasDefect ? "COALESCE(m.is_defect, 0) = 1" : "false"
    const byParty = hasDefect && t.col("production_movements", "party_id")
    // fin_ts once per distinct date text (many movements share a day).
    ctes.push("stk_pm_dates AS MATERIALIZED (SELECT DISTINCT date FROM production_movements)")
    ctes.push("stk_pm_days AS MATERIALIZED (SELECT date, to_char(fin_ts(date), 'YYYY-MM-DD') AS day FROM stk_pm_dates)")
    if (byParty) {
      ctes.push(`stk_pm_made AS MATERIALIZED (
        SELECT party_id,
               SUM(COALESCE(amount, 0) * COALESCE(cost, 0)) AS made_value,
               SUM(CASE WHEN COALESCE(is_defect, 0) = 1 THEN 0 ELSE COALESCE(amount, 0) END) AS good_qty
        FROM production_movements WHERE direction = 'made' AND party_id IS NOT NULL GROUP BY party_id
      )`)
    }
    const madeValue = byParty
      ? `CASE WHEN ${defect} THEN 0 WHEN pm.good_qty > 0 THEN ${amount} * pm.made_value / pm.good_qty ELSE ${amount} * ${cost} END`
      : `CASE WHEN ${defect} THEN 0 ELSE ${amount} * ${cost} END`
    parts.push(
      row(
        "COALESCE(pd.day, " + dayOf("fin_ts(m.created_at, true)") + ")",
        "m.warehouse",
        key,
        `CASE WHEN m.direction = 'raw' THEN -${amount} ELSE ${amount} END`,
        // Defective (brak) units carry no value, so a brak adjustment moves 0 value too.
        `CASE WHEN m.direction = 'raw' THEN -${amount} * ${cost} WHEN m.direction = 'made' THEN ${madeValue} WHEN ${defect} THEN 0 ELSE ${amount} * ${cost} END`,
        `CASE m.direction WHEN 'made' THEN 'manufacture_in' WHEN 'raw' THEN 'manufacture_out' ELSE CASE WHEN ${amount} >= 0 THEN 'none_in' ELSE 'none_out' END END`,
        "'production_movements'",
        "m.id",
        `CASE WHEN m.direction IN ('made', 'adjust') AND ${defect} THEN 1 ELSE 0 END`,
        `FROM production_movements m ${parties ? "LEFT JOIN production_parties p ON p.id = m.party_id" : ""} ${join}
         LEFT JOIN stk_pm_days pd ON pd.date = m.date
         ${byParty ? "LEFT JOIN stk_pm_made pm ON pm.party_id = m.party_id" : ""}
         WHERE m.direction IN ('made', 'raw', 'adjust') AND ${parties ? "(p.id IS NULL OR p.status <> 'cancelled')" : "true"}`,
      ),
    )
  }

  // Инвентаризация: the difference of confirmed counts (tables created lazily
  // by the inventory module, so only when they exist). Non-catalog lines
  // ("name:<name>") are keyed like every other document ('name:' + fin_key).
  if (t.has("stock_inventories") && t.has("stock_inventory_items")) {
    parts.push(
      row(
        dayOf("fin_ts(si.inv_date)", "fin_ts(si.created_at, true)"),
        "si.warehouse",
        "CASE WHEN ii.item_key LIKE 'name:%' THEN 'name:' || fin_key(substr(ii.item_key, 6)) ELSE ii.item_key END",
        "ii.diff",
        "ii.diff * COALESCE(ii.cost, 0)",
        "CASE WHEN ii.diff >= 0 THEN 'inventory_in' ELSE 'inventory_out' END",
        "'stock_inventories'",
        "si.id",
        "0",
        `FROM stock_inventories si JOIN stock_inventory_items ii ON ii.inventory_id = si.id
         WHERE si.status = 'confirmed' AND COALESCE(ii.diff, 0) <> 0 AND si.id <> @stk_exclude_inv`,
      ),
    )
  }

  // Выдано по заказу: client orders that name their warehouse and left it
  // ("В пути" / "Доставлено"; "Есть на складе" = reserved, see pending). The
  // day is the real ship moment (orders.shipped_at, ISO UTC) when the orders
  // module recorded one, else the delivery / order date. The value is unknown
  // here (0, the orders module leaves cost_price at 0): the cost ledger issues
  // the goods at the moving-average cost of contract 1 (lib/stock/costs.ts),
  // which this module cannot import (balances.ts reads it).
  if (t.has("orders") && t.has("order_items") && t.col("orders", "warehouse")) {
    const shipped = t.col("orders", "shipped_at") ? "fin_ts(o.shipped_at::text, true)" : "NULL::timestamp"
    const created = t.col("orders", "created") ? "fin_ts(o.created)" : "NULL::timestamp"
    const delivery = t.col("orders", "delivery") ? "fin_ts(o.delivery)" : "NULL::timestamp"
    const name = t.col("order_items", "product_name") ? "oi.product_name" : "''"
    const key = t.col("order_items", "product_id") ? `CASE WHEN oi.product_id IS NOT NULL THEN 'product:' || oi.product_id ELSE ${KEY_OF("n", name)} END` : KEY_OF("n", name)
    parts.push(
      row(
        dayOf(shipped, delivery, created, "fin_ts(o.created_at, true)"),
        "o.warehouse",
        key,
        "-COALESCE(oi.quantity, 0)",
        "0",
        "'order'",
        "'orders'",
        "o.id",
        "0",
        `FROM orders o JOIN order_items oi ON oi.order_id = o.id ${KEY_JOIN("n", name)}
         WHERE btrim(o.warehouse) <> '' AND o.status IN ('В пути', 'Доставлено')`,
      ),
    )
  }

  // Возврат: accepted client returns (contract 5; tables owned by SALES and
  // created lazily, so only when they exist): + quantity at the return's
  // warehouse on the accepted day. The value is unknown here (0): the cost
  // ledger brings the goods back at the moving-average cost (lib/stock/costs.ts).
  if (t.has("client_returns") && t.has("client_return_items") && t.col("client_returns", "warehouse") && t.col("client_return_items", "return_id")) {
    const accepted = t.col("client_returns", "accepted_at") ? "fin_ts(cr.accepted_at)" : "NULL::timestamp"
    const dated = t.col("client_returns", "return_date") ? "fin_ts(cr.return_date)" : "NULL::timestamp"
    const created = t.col("client_returns", "created_at") ? "fin_ts(cr.created_at, true)" : "NULL::timestamp"
    const name = t.col("client_return_items", "product_name") ? "ci.product_name" : "''"
    const key = t.col("client_return_items", "product_id") ? `CASE WHEN ci.product_id IS NOT NULL THEN 'product:' || ci.product_id ELSE ${KEY_OF("n", name)} END` : KEY_OF("n", name)
    const status = t.col("client_returns", "status") ? "cr.status = 'accepted'" : "false"
    parts.push(
      row(
        dayOf(accepted, dated, created),
        "cr.warehouse",
        key,
        "COALESCE(ci.quantity, 0)",
        "0",
        "'return'",
        "'client_returns'",
        "cr.id",
        "0",
        `FROM client_returns cr JOIN client_return_items ci ON ci.return_id = cr.id ${KEY_JOIN("n", name)}
         WHERE ${status} AND btrim(COALESCE(cr.warehouse, '')) <> ''`,
      ),
    )
  }

  return `WITH ${ctes.join(",\n")}\n${parts.length ? parts.join("\nUNION ALL\n") : EMPTY}`
}

/** Pending quantities: reserved by orders still in the warehouse, and
 * internal transfers given but not yet accepted ("в пути", towards the target). Columns:
 * warehouse, item_key, reserved, transit. No parameters. */
export function buildPendingSql(t: StockTables): string {
  const parts: string[] = []
  if (t.has("orders") && t.has("order_items") && t.col("orders", "warehouse")) {
    const name = t.col("order_items", "product_name") ? "oi.product_name" : "''"
    const key = t.col("order_items", "product_id") ? `CASE WHEN oi.product_id IS NOT NULL THEN 'product:' || oi.product_id ELSE ${KEY_OF("n", name)} END` : KEY_OF("n", name)
    parts.push(`SELECT o.warehouse::text AS warehouse, (${key})::text AS item_key, COALESCE(oi.quantity, 0)::double precision AS reserved, 0::double precision AS transit
      FROM orders o JOIN order_items oi ON oi.order_id = o.id ${KEY_JOIN("n", name)}
      WHERE btrim(o.warehouse) <> '' AND o.status = 'Есть на складе'`)
  }
  if (t.has("internal_transfers")) {
    // Every part names its columns: the orders part may be missing (order_items is created lazily).
    parts.push(`SELECT tr.to_warehouse::text AS warehouse, (${KEY_OF("n", "l.j ->> 'product'")})::text AS item_key, 0::double precision AS reserved,
        (${jsonNum("l.j", "quantity")})::double precision AS transit
      FROM internal_transfers tr CROSS JOIN LATERAL jsonb_array_elements(${jsonLines("tr.items")}) AS l(j)
      ${KEY_JOIN("n", "l.j ->> 'product'")}
      WHERE tr.status = 'в пути' AND fin_key(l.j ->> 'product') <> ''`)
  }
  const body = parts.length
    ? parts.join("\nUNION ALL\n")
    : "SELECT NULL::text AS warehouse, NULL::text AS item_key, NULL::double precision AS reserved, NULL::double precision AS transit WHERE false"
  return `WITH ${namesCte(t)}\n${body}`
}
