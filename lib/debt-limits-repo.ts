import "server-only"

import { getDb } from "@/lib/db"

export type Currency = "SUM" | "USD" | "Euro"
export type BalanceLine = { value: number; currency: Currency }
export type Category = "unconfirmed" | "problem" | "planned-okb" | "closure"

export type DebtLimitClient = {
  id: number
  name: string
  phone: string
  info: string[]
  type: string
  zoneLabel: string
  zoneCity: string
  agent: string
  courier: string
  collector: string
  balance: BalanceLine[]
  colorBar: "green" | "red" | "gray" | "none"
  category: Category
  debtLimitType: "unlimited" | "amount"
  debtLimit?: number
  debtLimitCurrency?: Currency
}

type Row = {
  id: number
  name: string
  phone: string
  info: string
  type: string
  zone_label: string
  zone_city: string
  agent: string
  courier: string
  collector: string
  balance: string
  color_bar: string
  category: string
  debt_limit_type: string
  debt_limit: number | null
  debt_limit_currency: string | null
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS debt_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      info TEXT NOT NULL DEFAULT '[]',
      type TEXT NOT NULL DEFAULT '',
      zone_label TEXT NOT NULL DEFAULT '',
      zone_city TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL DEFAULT '',
      courier TEXT NOT NULL DEFAULT '',
      collector TEXT NOT NULL DEFAULT '',
      balance TEXT NOT NULL DEFAULT '[]',
      color_bar TEXT NOT NULL DEFAULT 'none',
      category TEXT NOT NULL DEFAULT 'unconfirmed',
      debt_limit_type TEXT NOT NULL DEFAULT 'unlimited',
      debt_limit DOUBLE PRECISION,
      debt_limit_currency TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Money precision (contract 3): an older database created these columns as REAL (float4).
    DO $$
    DECLARE c text;
    BEGIN
      FOR c IN SELECT column_name FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'debt_limits' AND data_type = 'real' LOOP
        EXECUTE format('ALTER TABLE debt_limits ALTER COLUMN %I TYPE double precision USING (%I::text)::double precision', c, c);
      END LOOP;
    END $$;
  `)
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

function rowToClient(row: Row): DebtLimitClient {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    info: parseJsonArray<string>(row.info),
    type: row.type,
    zoneLabel: row.zone_label,
    zoneCity: row.zone_city,
    agent: row.agent,
    courier: row.courier,
    collector: row.collector,
    balance: parseJsonArray<BalanceLine>(row.balance),
    colorBar: (["green", "red", "gray", "none"].includes(row.color_bar) ? row.color_bar : "none") as DebtLimitClient["colorBar"],
    category: (["unconfirmed", "problem", "planned-okb", "closure"].includes(row.category) ? row.category : "unconfirmed") as Category,
    debtLimitType: row.debt_limit_type === "amount" ? "amount" : "unlimited",
    debtLimit: row.debt_limit ?? undefined,
    debtLimitCurrency: (row.debt_limit_currency as Currency | null) ?? undefined,
  }
}

export type DebtLimitClientInput = {
  name: string
  phone: string
  type: string
  info?: string[]
  zoneLabel?: string
  zoneCity?: string
  agent?: string
  courier?: string
  collector?: string
  category?: Category
  colorBar?: DebtLimitClient["colorBar"]
}

export async function listDebtLimitClients(): Promise<DebtLimitClient[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM debt_limits ORDER BY id DESC").all()) as Row[]).map(rowToClient)
}

export async function getDebtLimitClient(id: number): Promise<DebtLimitClient | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM debt_limits WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToClient(row) : null
}

export async function createDebtLimitClient(input: DebtLimitClientInput): Promise<DebtLimitClient> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO debt_limits (name, phone, info, type, zone_label, zone_city, agent, courier, collector, category)
       VALUES (@name, @phone, @info, @type, @zoneLabel, @zoneCity, @agent, @courier, @collector, @category)`,
      )
      .run({
        name: input.name,
        phone: input.phone,
        info: JSON.stringify(input.info ?? []),
        type: input.type,
        zoneLabel: input.zoneLabel ?? "",
        zoneCity: input.zoneCity ?? "",
        agent: input.agent ?? "",
        courier: input.courier ?? "",
        collector: input.collector ?? "",
        category: input.category ?? "unconfirmed",
      }))
  return (await getDebtLimitClient(Number(result.lastInsertRowid)))!
}

export async function deleteDebtLimitClient(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM debt_limits WHERE id = ?").run(id)).changes > 0
}

export type DebtLimitInput = { unlimited: boolean; limit: number; currency: Currency }

export async function setDebtLimit(id: number, input: DebtLimitInput): Promise<DebtLimitClient | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getDebtLimitClient(id))) return null
  await db.prepare(
        `UPDATE debt_limits SET debt_limit_type = @debtLimitType, debt_limit = @debtLimit, debt_limit_currency = @debtLimitCurrency, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        debtLimitType: input.unlimited ? "unlimited" : "amount",
        debtLimit: input.unlimited ? null : input.limit,
        debtLimitCurrency: input.unlimited ? null : input.currency,
      })
  return (await getDebtLimitClient(id))
}

export type PaymentInput = { amount: number; currency: Currency }

export async function addDebtLimitPayment(id: number, input: PaymentInput): Promise<DebtLimitClient | null> {
  const db = getDb()
  await ensureSchema(db)
  const existing = (await getDebtLimitClient(id))
  if (!existing) return null
  const hasLine = existing.balance.some((line) => line.currency === input.currency)
  const balance = hasLine
    ? existing.balance.map((line) => (line.currency === input.currency ? { ...line, value: line.value + input.amount } : line))
    : [...existing.balance, { value: input.amount, currency: input.currency }]
  await db.prepare("UPDATE debt_limits SET balance = @balance, updated_at = datetime('now') WHERE id = @id").run({
        id,
        balance: JSON.stringify(balance),
      })
  return (await getDebtLimitClient(id))
}
