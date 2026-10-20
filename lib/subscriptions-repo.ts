import "server-only"

import { getDb } from "@/lib/db"

export type Subscription = {
  id: number
  planName: string
  price: number
  billingPeriod: string
  status: string
  renewsAt: string
  note: string
}

type Row = {
  id: number
  plan_name: string
  price: number
  billing_period: string
  status: string
  renews_at: string
  note: string
}

export const SUBSCRIPTION_PERIODS = ["Месяц", "Год"] as const
export const SUBSCRIPTION_STATUSES = ["Активна", "Приостановлена", "Отменена"] as const

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_name TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL DEFAULT 0,
      billing_period TEXT NOT NULL DEFAULT 'Месяц',
      status TEXT NOT NULL DEFAULT 'Активна',
      renews_at TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Money precision (contract 3): an older database created these columns as REAL (float4).
    DO $$
    DECLARE c text;
    BEGIN
      FOR c IN SELECT column_name FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND data_type = 'real' LOOP
        EXECUTE format('ALTER TABLE subscriptions ALTER COLUMN %I TYPE double precision USING (%I::text)::double precision', c, c);
      END LOOP;
    END $$;
  `)
}

function rowToSubscription(row: Row): Subscription {
  return {
    id: row.id,
    planName: row.plan_name,
    price: row.price,
    billingPeriod: row.billing_period,
    status: row.status,
    renewsAt: row.renews_at,
    note: row.note,
  }
}

export type SubscriptionInput = {
  planName: string
  price: number
  billingPeriod: string
  status: string
  renewsAt: string
  note: string
}

export function parseSubscriptionInput(body: unknown): SubscriptionInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const planName = typeof value.planName === "string" ? value.planName.trim() : ""
  if (!planName) return null
  const billingPeriod =
    typeof value.billingPeriod === "string" && SUBSCRIPTION_PERIODS.includes(value.billingPeriod as (typeof SUBSCRIPTION_PERIODS)[number])
      ? value.billingPeriod
      : SUBSCRIPTION_PERIODS[0]
  const status =
    typeof value.status === "string" && SUBSCRIPTION_STATUSES.includes(value.status as (typeof SUBSCRIPTION_STATUSES)[number])
      ? value.status
      : SUBSCRIPTION_STATUSES[0]
  return {
    planName,
    price: Number(value.price) || 0,
    billingPeriod,
    status,
    renewsAt: typeof value.renewsAt === "string" ? value.renewsAt : "",
    note: typeof value.note === "string" ? value.note.trim() : "",
  }
}

export async function listSubscriptions(): Promise<Subscription[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM subscriptions ORDER BY id ASC").all()) as Row[]).map(rowToSubscription)
}

export async function getSubscription(id: number): Promise<Subscription | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToSubscription(row) : null
}

export async function createSubscription(input: SubscriptionInput): Promise<Subscription> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        "INSERT INTO subscriptions (plan_name, price, billing_period, status, renews_at, note) VALUES (@planName, @price, @billingPeriod, @status, @renewsAt, @note)",
      )
      .run(input))
  return (await getSubscription(Number(result.lastInsertRowid)))!
}

export async function updateSubscription(id: number, input: SubscriptionInput): Promise<Subscription | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getSubscription(id))) return null
  await db.prepare(
        "UPDATE subscriptions SET plan_name = @planName, price = @price, billing_period = @billingPeriod, status = @status, renews_at = @renewsAt, note = @note, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, ...input })
  return (await getSubscription(id))
}

export async function deleteSubscription(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id)).changes > 0
}
