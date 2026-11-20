import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { nowLocalIso } from "@/lib/finance/dates"

// Продажи → Бонусы клиентов, like Linko's sales/client_promotion/: one row per client (a financial account, Linko's
// "client") with its points and the moment of its last score, and the history of every score
// (sales/client_promotion/<id>/detail/).
//
// client_bonus_entries(id, client_id → financial_accounts.id, promotion_id → ref_records promo id, promotion_name,
// type, amount, ball, comment, order_id, order_product_id, product_id, product_name, created_by, created_at, linko_id):
// - type: Linko's kind of score: delivered (an order delivered), order_return_accept (a return accepted), order_prize
//   (balls spent on a prize order), custom_ball (added or taken by hand: «Добавить балл» and the Excel import);
// - amount: the product quantity of an order score (0 for a hand score); ball: the points, negative when taken;
// - created_at: a local wall time "YYYY-MM-DDTHH:mm:ss" (Asia/Tashkent);
// - linko_id: Linko's entry id for rows copied from Linko (scripts/linko-sync/import-client-bonuses.mjs).
// A client's points are the sum of its entries and its "Дата последнего бала" the newest entry, as in Linko.

export type ClientBonusRow = { id: number; name: string; ball: number; lastCreated: string | null }

export type ClientBonusEntry = {
  id: number
  type: string
  productName: string
  comment: string
  amount: number
  orderId: number | null
  promotionId: number | null
  promotionName: string
  ball: number
  createdAt: string
}

export type BallPromotion = { id: number; name: string }

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

declare global {
  var __linkoClientBonusesSchema: Promise<void> | undefined
}

/** Creates client_bonus_entries once per process (scripts/linko-sync/import-client-bonuses.mjs has the same DDL). */
export function ensureClientBonusesSchema(): Promise<void> {
  if (!globalThis.__linkoClientBonusesSchema) {
    globalThis.__linkoClientBonusesSchema = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_bonus_entries:schema'))")
        await tx.exec(DDL)
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoClientBonusesSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoClientBonusesSchema
}

const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** The financial accounts that have a shop whose responsible agent (Клиенты → «Агент») is this employee. */
const AGENT_ACCOUNTS = `
  SELECT COALESCE(m.financial_account_id, c.financial_account_id) AS account_id
    FROM clients c
    LEFT JOIN financial_account_markets m ON m.client_id = c.id
    JOIN employees e ON e.id = @agent
   WHERE btrim(c.agent) <> '' AND btrim(c.agent) = btrim(e.first_name || ' ' || e.last_name)`

/** Every client that is not deleted, newest first (Linko's order), with its points; `agent` keeps the clients of one
 * responsible agent (Linko's «Ответственный агент» filter, responsible_agent). */
export async function listClientBonuses(options: { agent?: number | null } = {}): Promise<ClientBonusRow[]> {
  await ensureClientBonusesSchema()
  const agent = options.agent ?? null
  const statement = getDb().prepare(
    `SELECT f.id, f.name, COALESCE(b.ball, 0) AS ball, b.last_created
       FROM financial_accounts f
       LEFT JOIN (SELECT client_id, SUM(ball) AS ball, MAX(created_at) AS last_created FROM client_bonus_entries GROUP BY client_id) b
         ON b.client_id = f.id
      WHERE COALESCE(f.deleted, 0) = 0
        ${agent === null ? "" : `AND f.id IN (${AGENT_ACCOUNTS})`}
      ORDER BY f.id DESC`,
  )
  const rows = (await (agent === null ? statement.all() : statement.all({ agent }))) as { id: number; name: string; ball: unknown; last_created: string | null }[]
  return rows.map((row) => ({ id: Number(row.id), name: row.name, ball: roundBall(num(row.ball)), lastCreated: row.last_created || null }))
}

/** Sums of float entries ("0.1 + 0.2"): kept to 9 decimals, Linko's precision. */
const roundBall = (value: number) => Math.round(value * 1e9) / 1e9

/** A client (financial account) that is not deleted, or null. */
export async function getBonusClient(id: number, db: PgDb = getDb()): Promise<{ id: number; name: string } | null> {
  const row = (await db.prepare("SELECT id, name FROM financial_accounts WHERE id = ? AND COALESCE(deleted, 0) = 0").get(id)) as { id: number; name: string } | undefined
  return row ? { id: Number(row.id), name: row.name } : null
}

/** The history of a client's points, newest first; `promotion` keeps one promotion's entries (the «Акция» filter). */
export async function listClientBonusEntries(clientId: number, options: { promotion?: number | null } = {}): Promise<ClientBonusEntry[]> {
  await ensureClientBonusesSchema()
  const promotion = options.promotion ?? null
  const rows = (await getDb()
    .prepare(
      `SELECT e.id, e.type, e.product_name, e.comment, e.amount, e.order_id, e.promotion_id, e.promotion_name, e.ball, e.created_at, p.data AS promo
         FROM client_bonus_entries e
         LEFT JOIN ref_records p ON p.kind = 'promo' AND p.id = e.promotion_id::text
        WHERE e.client_id = @client ${promotion === null ? "" : "AND e.promotion_id = @promotion"}
        ORDER BY e.created_at DESC, e.linko_id DESC NULLS FIRST, e.id DESC`,
    )
    .all({ client: clientId, promotion })) as {
    id: number
    type: string
    product_name: string
    comment: string
    amount: unknown
    order_id: number | null
    promotion_id: number | null
    promotion_name: string
    ball: unknown
    created_at: string
    promo: string | null
  }[]
  return rows.map((row) => ({
    id: Number(row.id),
    type: row.type,
    productName: row.product_name,
    comment: row.comment,
    amount: num(row.amount),
    orderId: row.order_id === null ? null : Number(row.order_id),
    promotionId: row.promotion_id === null ? null : Number(row.promotion_id),
    // The promotion's current name (renamed later: Linko shows the new one), else the one saved with the entry.
    promotionName: promoName(row.promo) ?? row.promotion_name,
    ball: num(row.ball),
    createdAt: row.created_at,
  }))
}

function promoName(data: string | null): string | null {
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as { name?: unknown }
    return typeof parsed.name === "string" && parsed.name ? parsed.name : null
  } catch {
    return null
  }
}

/** True for a promotion of the «Балл» type: copied from Linko (ref.type "ball") or created here (type "Балл"). */
function isBallPromotion(data: Record<string, unknown>): boolean {
  const ref = data.ref as { type?: unknown } | undefined
  return ref?.type === "ball" || data.type === "Балл"
}

/** The promotions balls are scored under (Linko's promotion field with type=ball), newest first. */
export async function listBallPromotions(db: PgDb = getDb()): Promise<BallPromotion[]> {
  const rows = (await db
    .prepare("SELECT id, data FROM ref_records WHERE kind = 'promo' AND deleted = 0 AND id ~ '^[0-9]{1,9}$' ORDER BY CAST(id AS INTEGER) DESC")
    .all()) as { id: string; data: string }[]
  return rows.flatMap((row) => {
    try {
      const data = JSON.parse(row.data) as Record<string, unknown>
      return isBallPromotion(data) ? [{ id: Number(row.id), name: typeof data.name === "string" ? data.name : "" }] : []
    } catch {
      return []
    }
  })
}

export class ClientBonusError extends Error {
  constructor(
    message: string,
    readonly field: string | null,
    readonly status = 400,
  ) {
    super(message)
    this.name = "ClientBonusError"
  }
}

export type CustomBall = { clientId: number; ball: number; comment: string }

/** Scores balls by hand under a «Балл» promotion (Linko's custom_ball: «Добавить балл» and the Excel import): one
 * entry per line, all in one transaction; an unknown client or promotion refuses the whole batch. */
export async function addCustomBalls(promotionId: number, lines: CustomBall[], userId: number | null): Promise<number> {
  await ensureClientBonusesSchema()
  return withTransaction(async (tx) => {
    const promotion = (await listBallPromotions(tx)).find((item) => item.id === promotionId)
    if (!promotion) throw new ClientBonusError("Акция не найдена", "promotion")
    const createdAt = nowLocalIso()
    for (const [index, line] of lines.entries()) {
      const client = await getBonusClient(line.clientId, tx)
      if (!client) throw new ClientBonusError("Клиент не найден", lines.length > 1 ? `rows.${index}` : "client")
      await tx
        .prepare(
          `INSERT INTO client_bonus_entries (client_id, promotion_id, promotion_name, type, amount, ball, comment, created_by, created_at)
           VALUES (@client, @promotion, @promotionName, 'custom_ball', 0, @ball, @comment, @user, @createdAt)`,
        )
        .run({ client: client.id, promotion: promotion.id, promotionName: promotion.name, ball: line.ball, comment: line.comment, user: userId, createdAt })
    }
    return lines.length
  })
}
