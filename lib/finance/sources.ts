import "server-only"

import type { FinanceSchema } from "@/lib/finance/schema"
import { MOVEMENT_COLUMNS, ORDER_EXCLUDED_STATUSES, ORDER_RELEASED_STATUSES, type BalanceDateMode, type BalanceEntityKind } from "@/lib/finance/types"

// The one ledger: for every entity kind, a UNION ALL of SELECTs over the real
// money tables, each emitting uniform "movement" rows:
//   ek       entity key (text): cashboxes.id / clients.id / suppliers.id or
//            'name:<fin_key(name)>' / employees.id / branches.id
//   cur      canonical currency code (fin_cur, base currency when unknown)
//   ts       local business timestamp (Asia/Tashkent) of the active date mode
//   col      movement column (MOVEMENT_COLUMNS[kind]) or an extra
//            ('money_request' for supplier fund requests)
//   amt      signed amount in the entity's sign convention
//   pending  customer payment not yet accepted into a cashbox
//   org/pt   organization name / payment type 'cash'|'bank'|'' (filters)
//   nm       display name of name-only entities (supplier documents)
//   + detail fields used by statements (src, src_id, title, doc, ...).
// (deliverer: employees.id, 'name:<fin_key(name)>' or 'none'.)
// Every SQL text here is static apart from schema-driven fragments; values
// are always bound as @named parameters (and no SQL contains a question
// mark, which the db shim would treat as a positional placeholder).

export type SourceOptions = {
  mode: BalanceDateMode
  /** Only emit the fields the aggregation needs. */
  lean: boolean
  /** Client orders: 'released' = only В пути/Доставлено, 'delivered' = only Доставлено. */
  orderScope?: "released" | "delivered" | null
  /** Lean rows also carry src / src_id (the deliverer ledger re-keys client movements by their document). */
  withSource?: boolean
}

const FIELD_TYPES = {
  ek: "text",
  cur: "text",
  ts: "timestamp",
  col: "text",
  amt: "double precision",
  pending: "boolean",
  org: "text",
  pt: "text",
  nm: "text",
  src: "text",
  src_id: "integer",
  title: "text",
  doc: "text",
  descr: "text",
  cmt: "text",
  cat: "text",
  cp: "text",
  br: "text",
  cb: "text",
  cby: "text",
  href: "text",
  editable: "boolean",
} as const

type Field = keyof typeof FIELD_TYPES

const LEAN_FIELDS: Field[] = ["ek", "cur", "ts", "col", "amt", "pending", "org", "pt", "nm"]
const ALL_FIELDS = Object.keys(FIELD_TYPES) as Field[]

const DEFAULTS: Record<Field, string> = {
  ek: "NULL",
  cur: "@base",
  ts: "NULL",
  col: "NULL",
  amt: "0",
  pending: "false",
  org: "''",
  pt: "''",
  nm: "''",
  src: "''",
  src_id: "NULL",
  title: "''",
  doc: "''",
  descr: "''",
  cmt: "''",
  cat: "''",
  cp: "''",
  br: "''",
  cb: "''",
  cby: "''",
  href: "''",
  editable: "false",
}

export type SourceContext = {
  s: FinanceSchema
  o: SourceOptions
  ctes: Map<string, string>
}

function select(ctx: SourceContext, fields: Partial<Record<Field, string>>, from: string): string {
  const names = ctx.o.lean ? (ctx.o.withSource ? [...LEAN_FIELDS, "src" as const, "src_id" as const] : LEAN_FIELDS) : ALL_FIELDS
  const list = names.map((name) => `(${fields[name] ?? DEFAULTS[name]})::${FIELD_TYPES[name]} AS ${name}`).join(", ")
  return `SELECT ${list} ${from}`
}

/** Column `alias.column` when it exists on `table`, else the SQL fallback. */
function col(ctx: SourceContext, alias: string, table: string, column: string, fallback: string): string {
  return ctx.s.col(table, column) ? `${alias}.${column}` : fallback
}

// Cash core (lib/cash) state columns: soft-deleted rows never count anywhere;
// unverified ("Подтвержденный приход/расход" unchecked) cash entries and
// supplier payments are listed on the cash page but excluded from balances.
// Customer payments keep their own pending state (accepted = 0).
function alive(ctx: SourceContext, alias: string, table: string): string {
  return ctx.s.col(table, "is_deleted") ? `COALESCE(${alias}.is_deleted, 0) = 0` : "true"
}

function verified(ctx: SourceContext, alias: string, table: string): string {
  return ctx.s.col(table, "is_verified") ? `COALESCE(${alias}.is_verified, 1) = 1` : "true"
}

const CME = "cash_management_entries"

/** Cash operation type of a cash entry (NULL = legacy row, typed by category/sign). */
function entryOp(ctx: SourceContext): string {
  return `COALESCE(${col(ctx, "e", CME, "op_type", "NULL::int")}, 0)`
}

/** Transfer leg: new rows carry op_type 1/2, legacy rows category 'Перевод'. */
function isTransfer(ctx: SourceContext): string {
  return `(e.category = 'Перевод' OR ${entryOp(ctx)} IN (1, 2))`
}

/** Live (not deleted) and verified cash entries. */
function entryCounts(ctx: SourceContext): string {
  return `${alive(ctx, "e", CME)} AND ${verified(ctx, "e", CME)}`
}

/** (id, org): the default organization of each client, for client documents that carry
 * none (opening balance, corrections without one), by the order rules (lib/orders-repo.ts
 * ORGANIZATION_BACKFILL): the client's not cancelled contracts when they name one
 * organization → the client's agent's single organization (first employee of that name)
 * → the only organization → ''. Also used by the corrections backfill
 * (lib/finance-store-reconciliation.ts). Needs the fin_* helpers (fin_single_org). */
export function clientDefaultOrgSql(s: FinanceSchema): string {
  const joins: string[] = []
  const picks: string[] = []
  if (s.has("contracts")) {
    joins.push(`LEFT JOIN (
      SELECT fin_key(to_jsonb(k) ->> 'client') AS ck, min(fin_place(to_jsonb(k) ->> 'organization')) AS org
        FROM contracts k
       WHERE COALESCE(to_jsonb(k) ->> 'status', '') <> 'cancelled' AND fin_place(to_jsonb(k) ->> 'organization') <> ''
       GROUP BY 1 HAVING count(DISTINCT fin_key(to_jsonb(k) ->> 'organization')) = 1) dko ON dko.ck = fin_key(c.name)`)
    picks.push("dko.org")
  }
  if (s.has("employees") && s.col("clients", "agent")) {
    joins.push(`LEFT JOIN (
      SELECT DISTINCT ON (fin_key(e.first_name || ' ' || e.last_name)) fin_key(e.first_name || ' ' || e.last_name) AS ek,
             NULLIF(fin_single_org(to_jsonb(e) ->> 'organizations'), '') AS org
        FROM employees e ORDER BY fin_key(e.first_name || ' ' || e.last_name), e.id) deo ON deo.ek = fin_key(c.agent) AND deo.ek <> ''`)
    picks.push("deo.org")
  }
  if (s.has("organizations") && s.col("organizations", "name")) {
    joins.push("CROSS JOIN (SELECT CASE WHEN count(*) = 1 THEN min(btrim(name)) END AS org FROM organizations) doo")
    picks.push("doo.org")
  }
  return `SELECT c.id, COALESCE(${[...picks, "''"].join(", ")}) AS org FROM clients c ${joins.join(" ")}`
}

const CTE_SQL: Record<string, (ctx: SourceContext) => string> = {
  rates: () => "SELECT fin_cur(code) AS code, MAX(rate)::double precision AS rate FROM currencies WHERE fin_cur(code) IS NOT NULL GROUP BY 1",
  client_keys: () => "SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1",
  supplier_keys: () => "SELECT fin_key(name) AS k, MIN(id) AS id FROM suppliers GROUP BY 1",
  emp_keys: () => "SELECT fin_key(first_name || ' ' || last_name) AS k, MIN(id) AS id FROM employees GROUP BY 1",
  cashbox_keys: () => "SELECT fin_key(name) AS k, MIN(id) AS id FROM cashboxes GROUP BY 1",
  branch_keys: (ctx) => (ctx.s.has("branches") ? "SELECT fin_key(name) AS k, MIN(id) AS id FROM branches GROUP BY 1" : "SELECT NULL::text AS k, NULL::int AS id WHERE false"),
  // Currency of each price list by name (the first one of a duplicated name).
  price_list_cur: (ctx) =>
    ctx.s.has("price_lists") && ctx.s.col("price_lists", "currency")
      ? "SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, fin_cur(currency) AS cur FROM price_lists WHERE fin_key(name) <> '' ORDER BY fin_key(name), id"
      : "SELECT NULL::text AS k, NULL::text AS cur WHERE false",
  wh: () =>
    `SELECT DISTINCT ON (fin_key(w.name)) fin_key(w.name) AS k, fin_key(w.manager) AS manager_k, bk.id AS branch_id
     FROM warehouses w LEFT JOIN branch_keys bk ON bk.k = fin_key(w.branch) ORDER BY fin_key(w.name), w.id`,
  oi_tot: () =>
    `SELECT order_id, COALESCE(fin_cur(currency), @base) AS cur,
            SUM(quantity::double precision * unit_price::double precision * (1 - discount_percent::double precision / 100)) AS amount
     FROM order_items GROUP BY 1, 2`,
  oi_orders: () => "SELECT DISTINCT order_id FROM order_items",
  client_default_org: (ctx) => clientDefaultOrgSql(ctx.s),
  transfer_legs: (ctx) =>
    `SELECT e.id, e.cashbox_id, e.amount::double precision AS a, e.entry_date, e.created_at, cb.name, cb.branch,
            COALESCE(fin_cur(cb.currency), @base) AS cur, ${col(ctx, "e", CME, "transfer_id", "NULL::int")} AS tid
     FROM cash_management_entries e JOIN cashboxes cb ON cb.id = e.cashbox_id WHERE ${isTransfer(ctx)} AND ${entryCounts(ctx)}`,
  // Cash-core transfers link their two legs by transfer_id (cash_transfers.id;
  // the legs may differ in amount and currency). Legacy transfers are two
  // unlinked rows (source −X "Перевод в …", target +X "Перевод из …" with the
  // same entry_date): pair each source leg with the nearest-id matching
  // target leg. amount/cur = source side, to_amount/to_cur = target side.
  transfer_pairs: () =>
    `SELECT s.id AS sid, -s.a AS amount, s.cur, t.a AS to_amount, t.cur AS to_cur, s.entry_date, s.created_at,
            s.name AS from_name, t.name AS to_name, s.branch AS from_branch, t.branch AS to_branch
     FROM transfer_legs s JOIN transfer_legs t ON t.tid = s.tid AND t.a > 0 AND t.id <> s.id
     WHERE s.a < 0 AND s.tid IS NOT NULL
     UNION ALL
     (SELECT DISTINCT ON (s.id) s.id AS sid, -s.a AS amount, s.cur, -s.a AS to_amount, s.cur AS to_cur, s.entry_date, s.created_at,
            s.name AS from_name, t.name AS to_name, s.branch AS from_branch, t.branch AS to_branch
     FROM transfer_legs s JOIN transfer_legs t ON t.a = -s.a AND t.entry_date = s.entry_date AND t.cashbox_id <> s.cashbox_id AND t.tid IS NULL
     WHERE s.a < 0 AND s.tid IS NULL ORDER BY s.id, abs(t.id - s.id))`,
}

const CTE_DEPS: Record<string, string[]> = { wh: ["branch_keys"], transfer_pairs: ["transfer_legs"] }

function need(ctx: SourceContext, ...names: string[]) {
  for (const name of names) {
    if (ctx.ctes.has(name)) continue
    for (const dep of CTE_DEPS[name] ?? []) need(ctx, dep)
    ctx.ctes.set(name, CTE_SQL[name](ctx))
  }
}

// --- date expressions -------------------------------------------------------

const utcTs = (expr: string) => `fin_ts(${expr}, true)`
const ts = (...exprs: string[]) => `COALESCE(${exprs.join(", ")})`

// --- internal transfers (branch and van-sell ledgers) ------------------------

const IT = "internal_transfers"

/** One leg of an internal transfer `t`, booked like the stock core
 * (lib/stock/sources.ts): the goods leave the sender once the transfer was
 * given (в пути / принят), on the given moment; they reach the receiver only
 * once it was accepted (принят), on the acceptance moment. Rows from before
 * the given_at / accepted_at columns fall back to the document dates (the
 * planned «Дата доставки» only for the receiver, as the stock core does).
 * `side` = the warehouse column of the entity: "from" = sender, "to" = receiver. */
function transferLeg(ctx: SourceContext, side: "from" | "to"): { ts: string; where: string } {
  const local = (column: string) => (ctx.s.col(IT, column) ? [`fin_ts(t.${column})`] : [])
  const moments =
    side === "from"
      ? [...local("given_at"), ...local("created_at_label"), utcTs("t.created_at")]
      : [...local("accepted_at"), ...local("delivered_at"), ...local("created_at_label"), utcTs("t.created_at")]
  return { ts: ts(...moments), where: side === "from" ? "t.status IN ('в пути', 'принят')" : "t.status = 'принят'" }
}

/** Currency of an internal transfer's amount `t.amount`, with the join it needs
 * (alias plc). The amount is priced by the transfer module, not by the free
 * «Валюта» field of the form (internal_transfers.currency): without a price
 * list the lines are priced at the cost of goods, in the base currency; with
 * one, at that price list's prices, in its currency. Only a price list that no
 * longer resolves falls back to the stored currency, then to base. */
function transferCurrency(ctx: SourceContext): { cur: string; join: string } {
  if (!ctx.s.col(IT, "price_list")) return { cur: "@base", join: "" }
  need(ctx, "price_list_cur")
  const stored = ctx.s.col(IT, "currency") ? "fin_cur(t.currency), " : ""
  return {
    cur: `CASE WHEN fin_key(t.price_list) = '' THEN @base ELSE COALESCE(plc.cur, ${stored}@base) END`,
    join: "LEFT JOIN price_list_cur plc ON plc.k = fin_key(t.price_list)",
  }
}

// --- orders (shared by the client ledger, Долги с заказов, branch KPI, P&L) ---

const sqlList = (values: readonly string[]) => values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ")

/** Orders that count as a sale / debt at all: not cancelled, not unconfirmed. */
export function orderCountedSql(alias = "o"): string {
  return `${alias}.status NOT IN (${sqlList(ORDER_EXCLUDED_STATUSES)})`
}

/** SQL: `column` (an agent name: orders.agent, client_returns.agent …) names one of the @agentIds
 * employees by name key; always true while @scoped is false. */
export function ownAgentSql(column: string): string {
  return `(NOT @scoped::boolean OR (fin_key(${column}) <> '' AND fin_key(${column}) IN (SELECT fin_key(concat_ws(' ', btrim(e.first_name), btrim(e.last_name))) FROM employees e WHERE e.id = ANY(@agentIds::int[]))))`
}

/** Released (shipped) orders: В пути / Доставлено. */
export function orderReleasedSql(alias = "o"): string {
  return `${alias}.status IN (${sqlList(ORDER_RELEASED_STATUSES)})`
}

/** Realization moment (local timestamp) of a released order: the moment it
 * was shipped (orders.shipped_at, written by the orders module when the
 * status becomes В пути / Доставлено). Legacy rows without it: the planned
 * delivery day, but never later than the last change of the order (the status
 * change happened at or before updated_at, so a future planned day is not a
 * realization), else the creation moment. */
export function orderRealizationTs(s: FinanceSchema, alias = "o"): string {
  const parts: string[] = []
  if (s.col("orders", "shipped_at")) parts.push(utcTs(`${alias}.shipped_at::text`))
  const delivery = s.col("orders", "delivery") ? `fin_ts(${alias}.delivery)` : "NULL::timestamp"
  const updated = s.col("orders", "updated_at") ? utcTs(`${alias}.updated_at`) : "NULL::timestamp"
  parts.push(`LEAST(${delivery}, ${updated})`)
  parts.push(utcTs(`${alias}.created_at`))
  return ts(...parts)
}

/** Joins orders `o` to its existing client `c` (contract: by orders.client_id,
 * by name only for legacy rows without an id; orders of a client that does
 * not exist are dropped). Needs the CTE `keys` (k = fin_key(name), id). */
export function orderClientJoin(s: FinanceSchema, o = "o", c = "oc", keys = "client_keys"): string {
  return s.col("orders", "client_id")
    ? `LEFT JOIN ${keys} ${c}_k ON ${o}.client_id IS NULL AND ${c}_k.k = fin_key(${o}.client) JOIN clients ${c} ON ${c}.id = COALESCE(${o}.client_id, ${c}_k.id)`
    : `JOIN ${keys} ${c}_k ON ${c}_k.k = fin_key(${o}.client) JOIN clients ${c} ON ${c}.id = ${c}_k.id`
}

// --- cashboxes --------------------------------------------------------------

function cashboxSources(ctx: SourceContext): string[] {
  const out: string[] = []
  const cbCur = "COALESCE(fin_cur(cb.currency), @base)"
  if (ctx.s.has(CME)) {
    const op = entryOp(ctx)
    out.push(
      select(
        ctx,
        {
          ek: "cb.id",
          cur: cbCur,
          ts: ts("fin_ts(e.entry_date)", utcTs("e.created_at")),
          col: `CASE WHEN ${isTransfer(ctx)} THEN (CASE WHEN e.amount >= 0 THEN 'transfer_income' ELSE 'transfer_expense' END)
                ELSE (CASE WHEN e.amount >= 0 THEN 'income' ELSE 'expenses' END) END`,
          amt: "e.amount",
          org: "fin_place(e.organization)",
          pt: "fin_pt(cb.payment_type)",
          src: "'cash_entry'",
          src_id: "e.id",
          title: `CASE ${op} WHEN 1 THEN 'Перевод с кассы' WHEN 2 THEN 'Перевод на кассу' WHEN 4 THEN 'Приход' WHEN 5 THEN 'Расход'
                  WHEN 7 THEN 'Снято со счета клиента' WHEN 9 THEN 'Доп. расход на поставку' WHEN 22 THEN 'Выдача денег для кэшбека' ELSE
                  (CASE WHEN e.category = 'Перевод' THEN (CASE WHEN e.amount >= 0 THEN 'Перевод на кассу' ELSE 'Перевод с кассы' END)
                  WHEN e.category = 'Клиент' AND e.amount >= 0 THEN 'Приход на счет клиента'
                  WHEN e.client_name <> '' AND e.amount < 0 THEN 'Снято со счета клиента'
                  WHEN e.amount >= 0 THEN 'Приход' ELSE 'Расход' END) END`,
          descr: "e.description",
          cmt: "e.comment",
          cat: `CASE WHEN ${isTransfer(ctx)} THEN '' ELSE e.category END`,
          cp: "e.client_name",
          br: "fin_place(e.branch)",
          cb: "cb.name",
          cby: col(ctx, "e", CME, "created_by", "''"),
          href: "'/analytics/cash-management'",
        },
        `FROM cash_management_entries e JOIN cashboxes cb ON cb.id = e.cashbox_id WHERE ${entryCounts(ctx)}`,
      ),
    )
  }
  // Accepted customer payments land in their cashbox_id (legacy rows: the
  // cashbox named by `kassa`). The cashbox receives the cash really taken
  // (real_amount when it is in the cashbox currency), else `amount`
  // converted to the cashbox currency with current rates.
  need(ctx, "cashbox_keys", "rates")
  const converted = (amount: string, currency: string) =>
    `CASE WHEN fin_cur(${currency}) IS NULL OR fin_cur(${currency}) = ${cbCur} THEN ${amount}::double precision
     ELSE ${amount}::double precision * COALESCE((SELECT r.rate FROM rates r WHERE r.code = fin_cur(${currency}))
       / NULLIF((SELECT r2.rate FROM rates r2 WHERE r2.code = ${cbCur}), 0), 1) END`
  const cashSide = (alias: string, table: string) =>
    ctx.s.col(table, "real_amount") && ctx.s.col(table, "real_currency")
      ? `CASE WHEN ${alias}.real_amount IS NOT NULL AND fin_cur(NULLIF(${alias}.real_currency, '')) = ${cbCur} THEN ${alias}.real_amount::double precision
         ELSE ${converted(`${alias}.amount`, `${alias}.currency`)} END`
      : converted(`${alias}.amount`, `${alias}.currency`)
  const CP = "customer_payments"
  const cpCashbox = ctx.s.col(CP, "cashbox_id") ? "COALESCE(p.cashbox_id, ckb.id)" : "ckb.id"
  const cpOp = `COALESCE(${col(ctx, "p", CP, "op_type", "NULL::int")}, 0)`
  out.push(
    select(
      ctx,
      {
        ek: "cb.id",
        cur: cbCur,
        ts: ts("fin_ts(p.accepted_at)", "fin_ts(" + col(ctx, "p", CP, "payment_date", "''") + ")", "fin_ts(p.paid_at)", utcTs("p.created_at")),
        col: "'income'",
        amt: cashSide("p", CP),
        org: "fin_place(p.organization)",
        pt: "fin_pt(p.icon)",
        src: "'customer_payment'",
        src_id: "p.id",
        title: `CASE WHEN ${cpOp} = 3 THEN 'Оплата заказа' ELSE 'Приход на счет клиента' END`,
        doc: `CASE WHEN ${cpOp} = 3 THEN ${col(ctx, "p", CP, "order_id", "NULL::int")}::text ELSE '' END`,
        cmt: "CASE WHEN p.comment = 'Не указано' THEN '' ELSE p.comment END",
        cat: col(ctx, "p", CP, "income_category", "''"),
        cp: "p.client",
        br: col(ctx, "p", CP, "branch", "''"),
        cb: "cb.name",
        cby: "p.created_by",
        href: "'/analytics/customer-payments'",
      },
      `FROM customer_payments p LEFT JOIN cashbox_keys ckb ON ckb.k = fin_key(p.kassa) JOIN cashboxes cb ON cb.id = ${cpCashbox}
       WHERE p.accepted = 1 AND ${alive(ctx, "p", CP)}`,
    ),
  )
  // Supplier payments leave their cashbox_id (legacy: the cashbox named by
  // `kassa`); a provider refund (amount < 0) is cashbox income.
  const SP = "supplier_payments"
  const spCashbox = ctx.s.col(SP, "cashbox_id") ? "COALESCE(sp.cashbox_id, ckb.id)" : "ckb.id"
  const spOp = `COALESCE(${col(ctx, "sp", SP, "op_type", "NULL::int")}, 0)`
  out.push(
    select(
      ctx,
      {
        ek: "cb.id",
        cur: cbCur,
        ts: ts("fin_ts(sp.paid_at)", utcTs("sp.created_at")),
        col: `CASE WHEN (${cashSide("sp", SP)}) < 0 THEN 'income' ELSE 'expenses' END`,
        amt: `-(${cashSide("sp", SP)})`,
        org: "fin_place(sp.organization)",
        pt: "fin_pt(sp.icon)",
        src: "'supplier_payment'",
        src_id: "sp.id",
        title: `CASE ${spOp} WHEN 10 THEN 'Расход на поставку' WHEN 4 THEN 'Приход от поставщика' ELSE 'Оплата поставщику' END`,
        doc: `CASE WHEN ${spOp} = 10 THEN ${col(ctx, "sp", SP, "supply_id", "NULL::int")}::text ELSE '' END`,
        cmt: "CASE WHEN sp.comment = 'Не указано' THEN '' ELSE sp.comment END",
        cat: col(ctx, "sp", SP, "category", "''"),
        cp: "sp.supplier",
        br: `fin_place(${col(ctx, "sp", SP, "branch", "''")})`,
        cb: "cb.name",
        cby: "sp.created_by",
        href: "'/analytics/supplier-payments'",
      },
      `FROM supplier_payments sp LEFT JOIN cashbox_keys ckb ON ckb.k = fin_key(sp.kassa) JOIN cashboxes cb ON cb.id = ${spCashbox}
       WHERE ${alive(ctx, "sp", SP)} AND ${verified(ctx, "sp", SP)}`,
    ),
  )
  return out
}

// --- clients (and accounts, which roll clients up) --------------------------

function orderStatusFilter(ctx: SourceContext): string {
  if (ctx.o.orderScope === "delivered") return "o.status = 'Доставлено'"
  if (ctx.o.mode === "realization" || ctx.o.orderScope === "released") return orderReleasedSql("o")
  return orderCountedSql("o")
}

function clientSources(ctx: SourceContext): string[] {
  const out: string[] = []
  need(ctx, "client_keys", "client_default_org")
  const realization = ctx.o.mode === "realization"

  out.push(
    select(
      ctx,
      {
        ek: "c.id",
        ts: utcTs("c.created_at"),
        col: "CASE WHEN c.balance >= 0 THEN 'none_type_plus' ELSE 'none_type_minus' END",
        amt: "c.balance",
        // No organization of its own: the client's default one, so the opening balance
        // stays under the Организация filter.
        org: "d.org",
        src: "'client_opening'",
        src_id: "c.id",
        title: "'Первоначальный баланс'",
        cp: "c.name",
        href: "'/clients'",
      },
      "FROM clients c JOIN client_default_org d ON d.id = c.id WHERE c.balance IS NOT NULL AND c.balance <> 0",
    ),
  )

  // Orders follow their client by orders.client_id (renaming a client keeps
  // its orders), legacy rows by name; they carry their own organization and
  // payment type, so the Организация / Тип оплаты filters keep them.
  const orderTs = realization ? orderRealizationTs(ctx.s, "o") : utcTs("o.created_at")
  const orderFields = (cur: string, amount: string): Partial<Record<Field, string>> => ({
    ek: "oc.id",
    cur,
    ts: orderTs,
    col: "'order'",
    amt: `-(${amount})`,
    org: ctx.s.col("orders", "organization") ? "fin_place(o.organization)" : "''",
    pt: ctx.s.col("orders", "payment_type") ? "fin_pt(o.payment_type)" : "''",
    src: "'order'",
    src_id: "o.id",
    title: "'Заказ'",
    doc: "o.id::text",
    descr: "o.product",
    cp: "oc.name",
    cby: "o.agent",
    href: "'/orders'",
  })
  const orderFrom = `FROM orders o ${orderClientJoin(ctx.s, "o", "oc", "client_keys")}`
  if (ctx.s.has("order_items")) {
    need(ctx, "oi_tot", "oi_orders")
    out.push(select(ctx, orderFields("t.cur", "t.amount"), `${orderFrom} JOIN oi_tot t ON t.order_id = o.id WHERE ${orderStatusFilter(ctx)}`))
    out.push(
      select(
        ctx,
        orderFields("COALESCE(a.currency, @base)", "a.amount"),
        `${orderFrom} CROSS JOIN LATERAL fin_amounts(o.amount) a
         WHERE ${orderStatusFilter(ctx)} AND NOT EXISTS (SELECT 1 FROM oi_orders z WHERE z.order_id = o.id)`,
      ),
    )
  } else {
    out.push(select(ctx, orderFields("COALESCE(a.currency, @base)", "a.amount"), `${orderFrom} CROSS JOIN LATERAL fin_amounts(o.amount) a WHERE ${orderStatusFilter(ctx)}`))
  }

  // Client returns (Продажи → Возвраты, owned by the sales module): an
  // accepted return credits the client by its amount on the acceptance day
  // (both date modes); pending and cancelled returns have no effect. The
  // organization is the return's own (client_returns.organization), else the
  // returned order's; the payment type comes from the returned order, if any.
  const CR = "client_returns"
  if (ctx.s.has(CR) && ctx.s.col(CR, "status") && ctx.s.col(CR, "amount")) {
    const returnOrder = ctx.s.col(CR, "order_id") && ctx.s.has("orders")
    const returnClient = ctx.s.col(CR, "client_id")
      ? ctx.s.col(CR, "client")
        ? "LEFT JOIN client_keys rk ON r.client_id IS NULL AND rk.k = fin_key(r.client) JOIN clients rc ON rc.id = COALESCE(r.client_id, rk.id)"
        : "JOIN clients rc ON rc.id = r.client_id"
      : "JOIN client_keys rk ON rk.k = fin_key(r.client) JOIN clients rc ON rc.id = rk.id"
    const acceptedTs = [
      ctx.s.col(CR, "accepted_at") ? utcTs("r.accepted_at::text") : "",
      ctx.s.col(CR, "return_date") ? "fin_ts(r.return_date::text)" : "",
      ctx.s.col(CR, "created_at") ? utcTs("r.created_at::text") : "",
    ].filter(Boolean)
    out.push(
      select(
        ctx,
        {
          ek: "rc.id",
          cur: `COALESCE(fin_cur(${col(ctx, "r", CR, "currency", "NULL")}), @base)`,
          ts: acceptedTs.length ? ts(...acceptedTs) : "NULL::timestamp",
          col: "'order_return'",
          amt: "r.amount",
          // The return's own organization first (returns without an order carry one too).
          org: ctx.s.col(CR, "organization")
            ? returnOrder && ctx.s.col("orders", "organization")
              ? "COALESCE(NULLIF(fin_place(r.organization), ''), fin_place(ro.organization))"
              : "fin_place(r.organization)"
            : returnOrder && ctx.s.col("orders", "organization")
              ? "fin_place(ro.organization)"
              : "''",
          pt: returnOrder && ctx.s.col("orders", "payment_type") ? "fin_pt(ro.payment_type)" : "''",
          src: "'client_return'",
          src_id: "r.id",
          title: "'Возврат'",
          doc: "r.id::text",
          descr: col(ctx, "r", CR, "warehouse", "''"),
          cmt: col(ctx, "r", CR, "comment", "''"),
          cp: "rc.name",
          cby: col(ctx, "r", CR, "accepted_by", "''"),
          href: "'/analytics/returns'",
        },
        `FROM ${CR} r ${returnClient} ${returnOrder ? "LEFT JOIN orders ro ON ro.id = r.order_id" : ""}
         WHERE r.status = 'accepted' AND COALESCE(r.amount, 0) <> 0`,
      ),
    )
  }

  if (ctx.s.has("client_payments")) {
    out.push(
      select(
        ctx,
        {
          ek: "c.id",
          ts: ts("fin_ts(cp.payment_date)", utcTs("cp.created_at")),
          col: "'payment'",
          amt: "cp.amount",
          src: "'client_payment'",
          src_id: "cp.id",
          title: "'Оплата'",
          cmt: "cp.comment",
          cp: "c.name",
          href: "'/clients'",
        },
        "FROM client_payments cp JOIN clients c ON c.id = cp.client_id",
      ),
    )
  }

  for (const [table, source] of [
    ["client_bulk_payments", "client_bulk_payment"],
    ["account_bulk_payments", "account_bulk_payment"],
  ] as const) {
    if (!ctx.s.has(table)) continue
    // Legacy group payments: one amount stored for N client ids = amount per client.
    out.push(
      select(
        ctx,
        {
          ek: "c.id",
          cur: "COALESCE(fin_cur(b.currency), @base)",
          ts: ts("fin_ts(b.payment_date)", utcTs("b.created_at")),
          col: "'payment'",
          amt: "b.amount",
          src: `'${source}'`,
          src_id: "b.id",
          title: "'Групповая оплата'",
          cmt: "b.comment",
          cp: "c.name",
        },
        // Cancelled rows (is_deleted = 1, amount already 0) are left out of the statements.
        `FROM ${table} b CROSS JOIN LATERAL fin_ids(b.client_ids) AS x(id) JOIN clients c ON c.id = x.id WHERE ${alive(ctx, "b", table)}`,
      ),
    )
  }

  if (ctx.s.has(CME)) {
    // Legacy cash entries by client name ('Клиент' income = payment, other
    // income = none_type_plus, outflow = none_type_minus) and cash-core
    // client withdrawals (op 7) by client_id. Other typed entries (cashback
    // payouts op 22, plain income/expense) do not touch the client debt.
    const hasClientId = ctx.s.col(CME, "client_id")
    const clientKey = hasClientId ? "COALESCE(e.client_id, ck.id)" : "ck.id"
    const op = col(ctx, "e", CME, "op_type", "NULL::int")
    out.push(
      select(
        ctx,
        {
          ek: clientKey,
          cur: "COALESCE(fin_cur(cb.currency), @base)",
          ts: ts("fin_ts(e.entry_date)", utcTs("e.created_at")),
          col: "CASE WHEN e.amount >= 0 AND e.category = 'Клиент' THEN 'payment' WHEN e.amount >= 0 THEN 'none_type_plus' ELSE 'none_type_minus' END",
          amt: "e.amount",
          org: "fin_place(e.organization)",
          pt: "fin_pt(cb.payment_type)",
          src: "'cash_entry'",
          src_id: "e.id",
          title: "CASE WHEN e.amount >= 0 AND e.category = 'Клиент' THEN 'Оплата' WHEN e.amount >= 0 THEN 'Приход' ELSE 'Снято со счета клиента' END",
          descr: "e.description",
          cmt: "e.comment",
          cat: "e.category",
          cp: "e.client_name",
          br: "fin_place(e.branch)",
          cb: "cb.name",
          cby: col(ctx, "e", CME, "created_by", "''"),
          href: "'/analytics/cash-management'",
        },
        `FROM cash_management_entries e LEFT JOIN client_keys ck ON ck.k = fin_key(e.client_name) JOIN cashboxes cb ON cb.id = e.cashbox_id
         WHERE NOT ${isTransfer(ctx)} AND ${clientKey} IS NOT NULL AND (${op} IS NULL OR ${op} = 7)
           AND (fin_key(e.client_name) <> ''${hasClientId ? " OR e.client_id IS NOT NULL" : ""}) AND ${entryCounts(ctx)}`,
      ),
    )
  }

  const hasClientId = ctx.s.col("customer_payments", "client_id")
  const paymentDate = col(ctx, "p", "customer_payments", "payment_date", "''")
  const createdTs = ts(`fin_ts(${paymentDate})`, "fin_ts(p.paid_at)", utcTs("p.created_at"))
  out.push(
    select(
      ctx,
      {
        ek: hasClientId ? "COALESCE(p.client_id, ck.id)" : "ck.id",
        cur: "COALESCE(fin_cur(p.currency), @base)",
        ts: realization ? `CASE WHEN p.accepted = 1 THEN ${ts("fin_ts(p.accepted_at)", createdTs)} ELSE ${createdTs} END` : createdTs,
        col: "'payment'",
        amt: "p.amount",
        pending: "p.accepted <> 1",
        org: "fin_place(p.organization)",
        pt: "fin_pt(p.icon)",
        src: "'customer_payment'",
        src_id: "p.id",
        title: "'Оплата'",
        cmt: "CASE WHEN p.comment = 'Не указано' THEN '' ELSE p.comment END",
        cp: "p.client",
        br: col(ctx, "p", "customer_payments", "branch", "''"),
        cb: "p.kassa",
        cby: "p.created_by",
        href: "'/analytics/customer-payments'",
      },
      (hasClientId
        ? "FROM customer_payments p LEFT JOIN client_keys ck ON ck.k = fin_key(p.client) WHERE COALESCE(p.client_id, ck.id) IN (SELECT id FROM clients)"
        : "FROM customer_payments p JOIN client_keys ck ON ck.k = fin_key(p.client) WHERE true") + ` AND ${alive(ctx, "p", "customer_payments")}`,
    ),
  )

  // Manual client corrections (demo client transaction type 9 "Произвольный"):
  // signed amount, created lazily by lib/finance-store-reconciliation.ts
  // ("Списать" / "Добавить", "Установить долг с Excel").
  if (ctx.s.has("client_balance_corrections")) {
    out.push(
      select(
        ctx,
        {
          ek: "c.id",
          cur: "COALESCE(fin_cur(k.currency), @base)",
          ts: ts("fin_ts(k.correction_date)", utcTs("k.created_at")),
          col: "CASE WHEN k.amount >= 0 THEN 'none_type_plus' ELSE 'none_type_minus' END",
          amt: "k.amount",
          org: "COALESCE(NULLIF(fin_place(k.organization), ''), d.org)",
          pt: "fin_pt(k.payment_type)",
          src: "'client_correction'",
          src_id: "k.id",
          title: "'Корректировка'",
          cmt: "k.comment",
          cp: "c.name",
          cby: "k.created_by",
          href: "'/analytics/store-reconciliation-bot'",
        },
        "FROM client_balance_corrections k JOIN clients c ON c.id = k.client_id JOIN client_default_org d ON d.id = c.id WHERE COALESCE(k.is_deleted, 0) = 0",
      ),
    )
  }
  return out
}

// --- suppliers --------------------------------------------------------------

function supplierSources(ctx: SourceContext): string[] {
  const out: string[] = []
  need(ctx, "supplier_keys")
  const ek = (nameExpr: string) => `COALESCE(sk.id::text, 'name:' || fin_key(${nameExpr}))`
  const join = (nameExpr: string) => `LEFT JOIN supplier_keys sk ON sk.k = fin_key(${nameExpr})`

  out.push(
    select(
      ctx,
      {
        ek: ek("i.supplier"),
        nm: "i.supplier",
        cur: `COALESCE(fin_cur(${col(ctx, "i", "supplier_incomings", "currency", "NULL")}), @base)`,
        // The earlier of the document date and the acceptance (LEAST skips NULL), as
        // lib/stock/sources.ts books it, so the supplier act and stock-by-date agree.
        ts: ts("LEAST(fin_ts(i.date), fin_ts(" + col(ctx, "i", "supplier_incomings", "accepted_at", "''") + "))", utcTs("i.created_at")),
        col: "'supply'",
        amt: "-i.amount",
        org: "fin_place(i.organization)",
        pt: "fin_pt(i.payment_type)",
        src: "'supplier_incoming'",
        src_id: "i.id",
        title: "'Поставка'",
        doc: "i.id::text",
        descr: "i.warehouse",
        cmt: "i.comment",
        cp: "i.supplier",
        br: "fin_place(i.branch)",
        cby: col(ctx, "i", "supplier_incomings", "accepted_by", "i.initiator"),
        href: "'/analytics/supplier-incomings'",
      },
      `FROM supplier_incomings i ${join("i.supplier")} WHERE i.status = 'принят' AND fin_key(i.supplier) <> ''`,
    ),
  )
  out.push(
    select(
      ctx,
      {
        ek: ek("r.from_whom"),
        nm: "r.from_whom",
        cur: "COALESCE(fin_cur(r.currency), @base)",
        ts: ts("LEAST(fin_ts(r.date), fin_ts(r.transfer_time))", utcTs("r.updated_at")),
        col: "'supply_return'",
        amt: "r.amount",
        org: "fin_place(r.organization)",
        pt: "fin_pt(r.payment_type)",
        src: "'supplier_return'",
        src_id: "r.id",
        title: "'Возврат поставщику'",
        doc: "r.id::text",
        descr: "r.warehouse",
        cmt: "r.reason",
        cp: "r.from_whom",
        br: "fin_place(r.branch)",
        cby: "r.added_by",
        href: "'/analytics/supplier-returns'",
      },
      `FROM supplier_returns r ${join("r.from_whom")} WHERE r.status = 'завершен' AND fin_key(r.from_whom) <> ''`,
    ),
  )
  // Supplier payments: by supplier_id (cash core), else by name. amount/currency
  // = credited to the supplier (refunds are negative).
  const SP = "supplier_payments"
  const spSupplier = col(ctx, "sp", SP, "supplier_id", "NULL::int")
  const spOp = `COALESCE(${col(ctx, "sp", SP, "op_type", "NULL::int")}, 0)`
  out.push(
    select(
      ctx,
      {
        ek: `COALESCE(${spSupplier}::text, sk.id::text, 'name:' || fin_key(sp.supplier))`,
        nm: "sp.supplier",
        cur: "COALESCE(fin_cur(sp.currency), @base)",
        ts: ts("fin_ts(sp.paid_at)", utcTs("sp.created_at")),
        col: "'payment'",
        amt: "sp.amount",
        org: "fin_place(sp.organization)",
        pt: "fin_pt(sp.icon)",
        src: "'supplier_payment'",
        src_id: "sp.id",
        title: `CASE WHEN ${spOp} = 4 THEN 'Приход от поставщика' ELSE 'Оплата' END`,
        doc: `CASE WHEN ${spOp} = 10 THEN ${col(ctx, "sp", SP, "supply_id", "NULL::int")}::text ELSE '' END`,
        cmt: "CASE WHEN sp.comment = 'Не указано' THEN '' ELSE sp.comment END",
        cat: col(ctx, "sp", SP, "category", "''"),
        cp: "sp.supplier",
        br: `fin_place(${col(ctx, "sp", SP, "branch", "''")})`,
        cb: "sp.kassa",
        cby: "sp.created_by",
        href: "'/analytics/supplier-payments'",
      },
      `FROM supplier_payments sp ${join("sp.supplier")}
       WHERE (fin_key(sp.supplier) <> '' OR ${spSupplier} IS NOT NULL) AND ${alive(ctx, "sp", SP)} AND ${verified(ctx, "sp", SP)}`,
    ),
  )
  if (ctx.s.has("supplier_balance_transactions")) {
    const t = "supplier_balance_transactions"
    const status = col(ctx, "t", t, "status", "''")
    out.push(
      select(
        ctx,
        {
          ek: "s.id",
          cur: "COALESCE(fin_cur(t.currency), @base)",
          ts: ts("fin_ts(t.date)", utcTs("t.created_at")),
          col: `CASE t.kind WHEN 'add' THEN 'none_type_plus' WHEN 'expense' THEN 'none_type_minus' ELSE 'money_request' END`,
          amt: "CASE WHEN t.kind = 'expense' THEN -abs(t.amount) ELSE abs(t.amount) END",
          org: `fin_place(${col(ctx, "t", t, "organization", "''")})`,
          pt: `fin_pt(${col(ctx, "t", t, "payment_type", "''")})`,
          src: "'supplier_manual'",
          src_id: "t.id",
          title: "CASE WHEN t.kind = 'fund_request' THEN 'Запрос средств' ELSE 'Нет типа' END",
          cmt: "t.comment",
          cp: "s.name",
          br: `fin_place(${col(ctx, "t", t, "branch", "''")})`,
          cby: col(ctx, "t", t, "created_by", "''"),
          editable: "true",
        },
        // Fund requests count while they await payment: pending or approved
        // (status '' = legacy pending); given / cancelled (legacy rejected) do not.
        `FROM ${t} t JOIN suppliers s ON s.id = t.supplier_id
         WHERE t.kind IN ('add', 'expense') OR (t.kind = 'fund_request' AND ${status} IN ('', 'pending', 'approved'))`,
      ),
    )
  }
  return out
}

// --- van-sell agents --------------------------------------------------------

function vansellSources(ctx: SourceContext): string[] {
  const out: string[] = []
  need(ctx, "emp_keys")
  if (ctx.s.has("vansell_transactions")) {
    const t = "vansell_transactions"
    const type = col(ctx, "v", t, "type", "'none_type'")
    const columns = MOVEMENT_COLUMNS.vansell.map((name) => `'${name}'`).join(", ")
    out.push(
      select(
        ctx,
        {
          ek: "v.employee_id",
          cur: "COALESCE(fin_cur(v.currency), @base)",
          ts: ts(`fin_ts(${col(ctx, "v", t, "created_date", "''")})`, utcTs("v.created_at")),
          col: `CASE WHEN ${type} IN (${columns}) THEN ${type} WHEN v.amount >= 0 THEN 'none_type_plus' ELSE 'none_type_minus' END`,
          amt: "v.amount",
          src: "'vansell_manual'",
          src_id: "v.id",
          title: "'Нет типа'",
          cmt: col(ctx, "v", t, "comment", "''"),
          cby: col(ctx, "v", t, "created_by", "''"),
          editable: "true",
        },
        `FROM ${t} v WHERE ${alive(ctx, "v", t)}`,
      ),
    )
  }
  // Goods: a van is a warehouse whose manager is the agent (heuristic link).
  // Loading the van (side "to") is booked when the van accepted the goods,
  // unloading it (side "from") when the van gave them (transferLeg).
  need(ctx, "wh")
  for (const side of ["to", "from"] as const) {
    const other = side === "to" ? "from" : "to"
    const leg = transferLeg(ctx, side)
    const currency = transferCurrency(ctx)
    out.push(
      select(
        ctx,
        {
          ek: "ek.id",
          cur: currency.cur,
          ts: leg.ts,
          col: side === "to" ? "'stock_transfer_minus'" : "'stock_transfer_plus'",
          amt: side === "to" ? "-t.amount" : "t.amount",
          org: "fin_place(t.organization)",
          src: "'internal_transfer'",
          src_id: "t.id",
          title: "'Передача склада'",
          doc: "t.id::text",
          descr: "t.from_warehouse || ' → ' || t.to_warehouse",
          cmt: "t.comment",
          cby: "t.created_by",
          href: "'/analytics/internal-transfers'",
        },
        `FROM internal_transfers t JOIN wh w ON w.k = fin_key(t.${side}_warehouse) JOIN emp_keys ek ON ek.k = w.manager_k
         LEFT JOIN wh w2 ON w2.k = fin_key(t.${other}_warehouse) ${currency.join}
         WHERE ${leg.where} AND w.manager_k <> '' AND w2.manager_k IS DISTINCT FROM w.manager_k`,
      ),
    )
  }
  // Money handed in: transfers out of the agent's van-sell cashbox are +,
  // transfers into it are −; cash or bank by the cashbox payment type.
  if (ctx.s.has("cash_management_entries")) {
    out.push(
      select(
        ctx,
        {
          ek: "ek.id",
          cur: "COALESCE(fin_cur(cb.currency), @base)",
          ts: ts("fin_ts(e.entry_date)", utcTs("e.created_at")),
          col: "CASE WHEN fin_pt(cb.payment_type) = 'bank' THEN 'bank_transfer_plus' ELSE 'cash_transfer_plus' END",
          amt: "-e.amount",
          org: "fin_place(e.organization)",
          pt: "fin_pt(cb.payment_type)",
          src: "'cash_entry'",
          src_id: "e.id",
          title: "'Оплата на кассу'",
          doc: "e.id::text",
          descr: "e.description",
          cmt: "e.comment",
          cb: "cb.name",
          cby: col(ctx, "e", "cash_management_entries", "created_by", "''"),
          href: "'/analytics/cash-management'",
        },
        `FROM cash_management_entries e JOIN cashboxes cb ON cb.id = e.cashbox_id JOIN emp_keys ek ON ek.k = fin_key(cb.cashier)
         WHERE ${isTransfer(ctx)} AND cb.vansell = 1 AND ${entryCounts(ctx)}`,
      ),
    )
  }
  return out
}

// --- branches ---------------------------------------------------------------

function branchSources(ctx: SourceContext): string[] {
  const out: string[] = []
  if (!ctx.s.has("branches")) return out
  need(ctx, "branch_keys", "wh")
  if (ctx.s.has("branch_balance_transactions")) {
    const t = "branch_balance_transactions"
    out.push(
      select(
        ctx,
        {
          ek: "b.id",
          cur: "COALESCE(fin_cur(t.currency), @base)",
          ts: ts("fin_ts(t.date)", utcTs("t.created_at")),
          col: "CASE t.kind WHEN 'expense' THEN 'none_type_minus' WHEN 'payments' THEN 'payments' ELSE 'none_type_plus' END",
          amt: "CASE WHEN t.kind = 'expense' THEN -abs(t.amount) ELSE abs(t.amount) END",
          src: "'branch_manual'",
          src_id: "t.id",
          title: "CASE WHEN t.kind = 'payments' THEN 'Оплата' ELSE 'Нет типа' END",
          cmt: "t.comment",
          cby: col(ctx, "t", t, "created_by", "''"),
          editable: "true",
        },
        `FROM ${t} t JOIN branches b ON b.id = t.branch_id`,
      ),
    )
  }
  // Goods moved between warehouses of different branches: the sender is
  // credited (stock_transfer_plus) when the goods left its warehouse (given),
  // the receiver owes (stock_transfer_minus) once it accepted them — the
  // moments the stock core moves the goods (transferLeg), so each branch's
  // claim / debt appears together with its stock change.
  for (const side of ["to", "from"] as const) {
    const other = side === "to" ? "from" : "to"
    const leg = transferLeg(ctx, side)
    const currency = transferCurrency(ctx)
    out.push(
      select(
        ctx,
        {
          ek: "w.branch_id",
          cur: currency.cur,
          ts: leg.ts,
          col: side === "to" ? "'stock_transfer_minus'" : "'stock_transfer_plus'",
          amt: side === "to" ? "-t.amount" : "t.amount",
          org: "fin_place(t.organization)",
          src: "'internal_transfer'",
          src_id: "t.id",
          title: "'Передача склада'",
          doc: "t.id::text",
          descr: "t.from_warehouse || ' → ' || t.to_warehouse",
          cmt: "t.comment",
          cby: "t.created_by",
          href: "'/analytics/internal-transfers'",
        },
        `FROM internal_transfers t JOIN wh w ON w.k = fin_key(t.${side}_warehouse) LEFT JOIN wh w2 ON w2.k = fin_key(t.${other}_warehouse) ${currency.join}
         WHERE ${leg.where} AND w.branch_id IS NOT NULL AND w2.branch_id IS DISTINCT FROM w.branch_id`,
      ),
    )
  }
  // Money sent between cashboxes of different branches: the paying branch is
  // credited (+ amount sent, source currency), the receiving branch is
  // debited (− amount received, target currency; equal for legacy pairs).
  if (ctx.s.has("cash_management_entries")) {
    need(ctx, "transfer_pairs")
    for (const side of ["from", "to"] as const) {
      out.push(
        select(
          ctx,
          {
            ek: "bk.id",
            cur: side === "from" ? "p.cur" : "p.to_cur",
            ts: ts("fin_ts(p.entry_date)", utcTs("p.created_at")),
            col: "'payments'",
            amt: side === "from" ? "p.amount" : "-p.to_amount",
            pt: "''",
            src: "'cash_transfer'",
            src_id: "p.sid",
            title: "'Оплата на кассу'",
            doc: "p.sid::text",
            descr: "p.from_name || ' → ' || p.to_name",
            cb: side === "from" ? "p.from_name" : "p.to_name",
            href: "'/analytics/cash-management'",
          },
          `FROM transfer_pairs p JOIN branch_keys bk ON bk.k = fin_key(p.${side}_branch)
           LEFT JOIN branch_keys ob ON ob.k = fin_key(p.${side === "from" ? "to" : "from"}_branch)
           WHERE ob.id IS DISTINCT FROM bk.id`,
        ),
      )
    }
  }
  return out
}

// --- employees --------------------------------------------------------------

function employeeSources(ctx: SourceContext): string[] {
  const out: string[] = []
  if (ctx.s.has("employee_balance_transactions")) {
    const t = "employee_balance_transactions"
    const type = col(ctx, "t", t, "type", "'none_type'")
    out.push(
      select(
        ctx,
        {
          ek: "e.id",
          cur: "COALESCE(fin_cur(t.currency), @base)",
          ts: ts("fin_ts(t.date)", utcTs("t.created_at")),
          col: `CASE WHEN ${type} IN ('monthly', 'performance_bonus', 'payment', 'penalty') THEN ${type} ELSE 'none_type' END`,
          amt: "CASE WHEN t.kind = 'expense' THEN -abs(t.amount) ELSE abs(t.amount) END",
          src: "'employee_manual'",
          src_id: "t.id",
          title: `CASE ${type} WHEN 'monthly' THEN 'Зарплата' WHEN 'performance_bonus' THEN 'Зачислено KPI' WHEN 'payment' THEN 'Введено с кассы'
                  WHEN 'penalty' THEN 'Штраф' ELSE 'Нет типа' END`,
          cmt: "t.comment",
          cby: col(ctx, "t", t, "created_by", "''"),
          editable: `${type} IN ('none_type', 'penalty', '')`,
        },
        `FROM ${t} t JOIN employees e ON e.id = t.employee_id`,
      ),
    )
  }
  // "Введено с кассы": per-employee allocations of cash-core staff entries
  // (Расход на сотрудников = money paid out −, staff income = money returned +),
  // in the entry's (cashbox) currency, dated by the entry.
  if (ctx.s.has("cash_entry_staff") && ctx.s.has(CME)) {
    out.push(
      select(
        ctx,
        {
          ek: "s.employee_id",
          cur: "COALESCE(fin_cur(NULLIF(s.currency, '')), fin_cur(cb.currency), @base)",
          ts: ts("fin_ts(e.entry_date)", utcTs("e.created_at")),
          col: "'payment'",
          amt: "CASE WHEN e.amount < 0 THEN -abs(s.amount) ELSE abs(s.amount) END",
          org: "fin_place(e.organization)",
          pt: "fin_pt(cb.payment_type)",
          src: "'cash_staff'",
          src_id: "s.id",
          title: "CASE WHEN e.amount < 0 THEN 'Введено с кассы' ELSE 'Возврат в кассу' END",
          doc: `${col(ctx, "e", CME, "doc_no", "e.id")}::text`,
          descr: "e.description",
          cmt: "e.comment",
          cat: "e.category",
          br: "fin_place(e.branch)",
          cb: "cb.name",
          cby: col(ctx, "e", CME, "created_by", "''"),
          href: "'/analytics/cash-management'",
        },
        `FROM cash_entry_staff s JOIN cash_management_entries e ON e.id = s.entry_id JOIN cashboxes cb ON cb.id = e.cashbox_id
         WHERE ${entryCounts(ctx)}`,
      ),
    )
  }
  // "Зачислить" of "Зарплата и установка планов": the salary ("Зарплата") and the KPI bonus ("Зачислено KPI") of an approved record,
  // dated with the last day of its month (lib/salary-records-repo.ts, table salary_credits).
  if (ctx.s.has("salary_credits")) {
    const creditType = "c.type"
    out.push(
      select(
        ctx,
        {
          ek: "e.id",
          cur: "COALESCE(fin_cur(c.currency), @base)",
          ts: ts("fin_ts(c.created_date)"),
          col: "c.type",
          amt: "c.amount",
          src: "'salary_credit'",
          src_id: "c.id",
          title: `CASE ${creditType} WHEN 'monthly' THEN 'Зарплата' WHEN 'performance_bonus' THEN 'Зачислено KPI'
                  ELSE 'Нет типа' END`,
          href: "'/analytics/salary-planning'",
        },
        "FROM salary_credits c JOIN employees e ON e.id = c.user_id WHERE c.amount <> 0 AND c.type IN ('monthly', 'performance_bonus')",
      ),
    )
  }
  if (ctx.s.has("salary_plans")) {
    // Salary planning: a credited plan accrues its month's salary / KPI bonus.
    // Dated when it was credited (credited_at), kept inside its own month
    // (year, month), so editing a plan later never moves a past accrual.
    // Legacy rows (no period / credited_at): the last change of the plan.
    need(ctx, "emp_keys")
    const SPT = "salary_plans"
    const credited = ctx.s.col(SPT, "credited_at") ? ts(utcTs("sp.credited_at"), utcTs("sp.updated_at")) : utcTs("sp.updated_at")
    const hasPeriod = ctx.s.col(SPT, "year") && ctx.s.col(SPT, "month")
    const start = "make_timestamp(sp.year, sp.month, 1, 0, 0, 0)"
    const accrualTs = hasPeriod
      ? `CASE WHEN sp.year BETWEEN 1900 AND 2200 AND sp.month BETWEEN 1 AND 12
           THEN LEAST(GREATEST(${credited}, ${start}), ${start} + interval '1 month' - interval '1 second') ELSE ${credited} END`
      : credited
    const employee = ctx.s.col(SPT, "employee_id")
      ? "LEFT JOIN emp_keys ek ON sp.employee_id IS NULL AND ek.k = fin_key(sp.employee) JOIN employees se ON se.id = COALESCE(sp.employee_id, ek.id)"
      : "JOIN emp_keys ek ON ek.k = fin_key(sp.employee) JOIN employees se ON se.id = ek.id"
    // One accrual per employee and month: a month that "Зарплата и установка планов" credited (salary_credits, above)
    // replaces the legacy plan's salary and KPI bonus of that month instead of adding to them.
    const replaced =
      hasPeriod && ctx.s.has("salary_credits")
        ? " AND NOT EXISTS (SELECT 1 FROM salary_credits c WHERE c.user_id = se.id AND c.year = sp.year AND c.month = sp.month)"
        : ""
    for (const [field, column, title] of [
      ["salary", "monthly", "Зарплата"],
      ["bonus", "performance_bonus", "Зачислено KPI"],
    ] as const) {
      out.push(
        select(
          ctx,
          {
            ek: "se.id",
            ts: accrualTs,
            col: `'${column}'`,
            amt: `sp.${field}`,
            src: "'salary_plan'",
            src_id: "sp.id",
            title: `'${title}'`,
            descr: hasPeriod ? "CASE WHEN sp.month BETWEEN 1 AND 12 THEN lpad(sp.month::text, 2, '0') || '.' || sp.year::text ELSE '' END" : "''",
            href: "'/analytics/salary-planning'",
          },
          `FROM salary_plans sp ${employee} WHERE sp.credited = 1 AND sp.${field} <> 0${replaced}`,
        ),
      )
    }
  }
  return out
}

// --- delivery men ("Долги доставщиков") ---------------------------------------

/** Manual corrections of a deliverer's balance ("Корректировка", demo client
 * transaction type 9 with only delivery_man set); created lazily by
 * lib/finance-deliverer-debts.ts. amount is signed. */
export const DELIVERER_CORRECTIONS_TABLE = "deliverer_balance_transactions"

/** Rows (id, dk, dn[, pass-through columns]) of a deliverer name column:
 * dk = the employee with that full name (emp_keys, lowest id) or
 * 'name:<fin_key(name)>', NULL when the name is empty / a placeholder (same
 * list as fin_place); dn = the name. fin_key runs once per row (OFFSET 0
 * keeps the inner query from being flattened) and emp_keys is hash-joined. */
function delivererNames(alias: string, nameExpr: string, table: string, where: string, passThrough: string[] = []): string {
  const extra = passThrough.map((column) => `, ${alias}.${column}`).join("")
  return `SELECT x.id, CASE WHEN x.dn <> '' THEN COALESCE(ek.id::text, 'name:' || x.k) END AS dk, x.dn${passThrough.map((column) => `, x.${column}`).join("")}
    FROM (SELECT z.*, CASE WHEN z.k IN ('', '-', '—', 'не указано', 'не указан', 'все', 'все филиалы', 'все организации') THEN '' ELSE btrim(z.name) END AS dn
          FROM (SELECT ${alias}.id, ${nameExpr} AS name, fin_key(${nameExpr}) AS k${extra} FROM ${table} ${alias} WHERE ${where} OFFSET 0) z) x
    LEFT JOIN emp_keys ek ON ek.k = x.k`
}

// The client ledger (every source of clientSources, same filters and dates)
// re-keyed by the delivery man responsible for each movement: the order's
// delivery_man, the payment's delivery_man_id / delivery_man, else the
// client's deliverer (clients.deliverer — the fallback lib/cash uses for
// orders); movements without any deliverer go to the 'none' row. Client
// none_type_plus / none_type_minus become none_type. Orders also carry their
// own organization / payment type here (the client ledger has none for
// orders). Plus the deliverer's own corrections. Keys are resolved once per
// client / order / payment (small CTEs), not per movement row.
function delivererSources(ctx: SourceContext): string[] {
  const inner: SourceContext = { s: ctx.s, o: { ...ctx.o, withSource: true }, ctes: ctx.ctes }
  ctx.ctes.set("client_mv", clientSources(inner).join("\nUNION ALL\n"))
  need(ctx, "emp_keys")
  const CP = "customer_payments"
  ctx.ctes.set("dlv_clients", delivererNames("c", "c.deliverer", "clients", "COALESCE(c.deliverer, '') <> ''"))

  const orderName = ctx.s.col("orders", "delivery_man")
  const orderOrg = ctx.s.col("orders", "organization")
  const orderPt = ctx.s.col("orders", "payment_type")
  const orderWhere = [orderName && "o.delivery_man <> ''", orderOrg && "o.organization <> ''", orderPt && "o.payment_type <> ''"].filter(Boolean)
  const orderColumns = [orderOrg && "organization", orderPt && "payment_type"].filter((column): column is string => Boolean(column))
  ctx.ctes.set(
    "dlv_orders",
    orderWhere.length
      ? `SELECT n.id, n.dk, n.dn, ${orderOrg ? "fin_place(n.organization)" : "''"} AS org, ${orderPt ? "fin_pt(n.payment_type)" : "''"} AS pt
         FROM (${delivererNames("o", orderName ? "o.delivery_man" : "''", "orders", orderWhere.join(" OR "), orderColumns)}) n`
      : "SELECT NULL::int AS id, NULL::text AS dk, ''::text AS dn, ''::text AS org, ''::text AS pt WHERE false",
  )

  const payId = ctx.s.col(CP, "delivery_man_id")
  const payName = ctx.s.col(CP, "delivery_man")
  const payWhere = [payId && "p.delivery_man_id IS NOT NULL", payName && "p.delivery_man <> ''"].filter(Boolean)
  ctx.ctes.set(
    "dlv_payments",
    payWhere.length
      ? `SELECT n.id, COALESCE(${payId ? "pe.id::text" : "NULL::text"}, n.dk) AS dk, CASE WHEN ${payId ? "pe.id IS NOT NULL" : "false"} THEN '' ELSE n.dn END AS dn
         FROM (${delivererNames("p", payName ? "p.delivery_man" : "''", CP, payWhere.join(" OR "), payId ? ["delivery_man_id"] : [])}) n
         ${payId ? "LEFT JOIN employees pe ON pe.id = n.delivery_man_id" : ""}`
      : "SELECT NULL::int AS id, NULL::text AS dk, ''::text AS dn WHERE false",
  )
  // Client balance corrections (Сверка магазина через бот: Списать / Добавить,
  // "Установить долг с Excel") are not the deliverer's business: they count
  // only for the delivery man written on the correction itself.
  const CC = "client_balance_corrections"
  ctx.ctes.set(
    "dlv_client_corrections",
    ctx.s.col(CC, "delivery_man")
      ? delivererNames("k", "k.delivery_man", CC, "k.delivery_man <> ''")
      : "SELECT NULL::int AS id, NULL::text AS dk, ''::text AS dn WHERE false",
  )
  const attributed = `SELECT m.*,
      CASE WHEN m.src = 'client_correction' THEN dcc.dk ELSE COALESCE(dp.dk, dor.dk, dc.dk) END AS dk,
      CASE WHEN m.src = 'client_correction' THEN dcc.dn WHEN dp.dk IS NOT NULL THEN dp.dn WHEN dor.dk IS NOT NULL THEN dor.dn ELSE COALESCE(dc.dn, '') END AS dn,
      COALESCE(dor.org, '') AS order_org,
      COALESCE(dor.pt, '') AS order_pt
    FROM client_mv m
    LEFT JOIN dlv_orders dor ON m.src = 'order' AND dor.id = m.src_id
    LEFT JOIN dlv_payments dp ON m.src = 'customer_payment' AND dp.id = m.src_id
    LEFT JOIN dlv_client_corrections dcc ON m.src = 'client_correction' AND dcc.id = m.src_id
    LEFT JOIN dlv_clients dc ON dc.id = m.ek::int
    WHERE m.src <> 'client_correction' OR dcc.dk IS NOT NULL`
  const out = [
    select(
      ctx,
      {
        ek: "COALESCE(d.dk, 'none')",
        nm: "d.dn",
        cur: "d.cur",
        ts: "d.ts",
        col: "CASE WHEN d.col IN ('none_type_plus', 'none_type_minus') THEN 'none_type' ELSE d.col END",
        amt: "d.amt",
        pending: "d.pending",
        org: "CASE WHEN d.order_org <> '' THEN d.order_org ELSE d.org END",
        pt: "CASE WHEN d.order_pt <> '' THEN d.order_pt ELSE d.pt END",
        src: "d.src",
        src_id: "d.src_id",
        title: "d.title",
        doc: "d.doc",
        descr: "d.descr",
        cmt: "d.cmt",
        cat: "d.cat",
        cp: "d.cp",
        br: "d.br",
        cb: "d.cb",
        cby: "d.cby",
        href: "d.href",
        editable: "false",
      },
      `FROM (${attributed}) d`,
    ),
  ]
  if (ctx.s.has(DELIVERER_CORRECTIONS_TABLE)) {
    out.push(
      select(
        ctx,
        {
          ek: "t.employee_id",
          cur: "COALESCE(fin_cur(t.currency), @base)",
          ts: ts("fin_ts(t.date)", utcTs("t.created_at")),
          col: "'none_type'",
          amt: "t.amount",
          org: "fin_place(t.organization)",
          pt: "fin_pt(t.payment_type)",
          src: "'deliverer_manual'",
          src_id: "t.id",
          title: "'Корректировка'",
          cmt: "t.comment",
          cby: "t.created_by",
          editable: "true",
        },
        `FROM ${DELIVERER_CORRECTIONS_TABLE} t`,
      ),
    )
  }
  return out
}

const BUILDERS: Record<BalanceEntityKind, (ctx: SourceContext) => string[]> = {
  cashbox: cashboxSources,
  client: clientSources,
  account: clientSources,
  supplier: supplierSources,
  vansell: vansellSources,
  branch: branchSources,
  employee: employeeSources,
  deliverer: delivererSources,
  // Client movements; the ledger rolls the client rows up by clients.agent.
  agent: clientSources,
}

/** SQL prefix "WITH <ctes>, mv AS (<union>)" producing the movement rows of
 * `kind`. Bind @base (base currency code) when executing. */
export function movementCte(kind: BalanceEntityKind, s: FinanceSchema, options: SourceOptions): string {
  const ctx: SourceContext = { s, o: options, ctes: new Map() }
  const parts = BUILDERS[kind](ctx)
  const union = parts.length ? parts.join("\nUNION ALL\n") : select(ctx, {}, "WHERE false")
  const ctes = [...ctx.ctes.entries()].map(([name, sql]) => `${name} AS (${sql})`)
  ctes.push(`mv AS (${union})`)
  return `WITH ${ctes.join(",\n")}`
}
