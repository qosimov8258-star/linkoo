import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { getBalanceList } from "@/lib/finance/ledger"

// Live client balances = the reference balance kept on the client (clients.balance / the "_balances" line, already
// equal to the reference's final balance) + whatever the app itself recorded AFTER the baseline was taken: new orders,
// payments, returns and their cancellations. The delta is (ledger end balance now) − (ledger end balance at the baseline),
// so the 4293 existing balances, "Баланс клиентов" and "ДОЛГ КЛИЕНТОВ" keep matching the reference until the app moves them.

type Currencies = Record<string, number>

const FAR_PAST = "1900-01-01"
const FAR_FUTURE = "2100-01-01"
const CACHE_MS = 500
const LABEL: Record<string, string> = { EUR: "Euro" }

let schemaReady: Promise<void> | undefined
let cache: { at: number; deltas: Map<number, Currencies> } | undefined

const round = (value: number) => Math.round(value * 1000) / 1000

function ensureSchema(db: PgDb): Promise<void> {
  schemaReady ??= (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS client_balance_baseline (client_id INTEGER NOT NULL, currency TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, PRIMARY KEY (client_id, currency))").run()
    await db.prepare("CREATE TABLE IF NOT EXISTS client_balance_baseline_meta (id INTEGER PRIMARY KEY, seeded_at TEXT NOT NULL)").run()
  })().catch((error) => {
    schemaReady = undefined
    throw error
  })
  return schemaReady
}

/** Ledger end balance of every client (all time, every currency). */
export async function clientLedgerEnds(db: PgDb = getDb()): Promise<Map<number, Currencies>> {
  const list = await getBalanceList("client", { from: FAR_PAST, to: FAR_FUTURE, mode: "created", orderScope: null, page: 1, pageSize: 0 } as Parameters<typeof getBalanceList>[1], db)
  const ends = new Map<number, Currencies>()
  for (const row of list.rows) {
    const balances: Currencies = {}
    for (const [code, value] of Object.entries(row.currencies ?? {})) {
      const end = Number((value as { end_balance?: number }).end_balance ?? 0)
      if (Math.abs(end) > 0.0005) balances[code] = end
    }
    ends.set(Number(row.id), balances)
  }
  return ends
}

/** Takes the baseline once (insert-only). Existing baselines are never rewritten. */
export async function ensureBaseline(db: PgDb = getDb()): Promise<void> {
  await ensureSchema(db)
  const meta = (await db.prepare("SELECT 1 FROM client_balance_baseline_meta WHERE id = 1").get()) as unknown
  if (meta) return
  const ends = await clientLedgerEnds(db)
  const values: string[] = []
  for (const [clientId, balances] of ends) {
    for (const [code, amount] of Object.entries(balances)) values.push(`(${Number(clientId)}, '${code.replace(/[^A-Za-z]/g, "")}', ${Number(amount)})`)
  }
  for (let i = 0; i < values.length; i += 500) {
    await db.prepare(`INSERT INTO client_balance_baseline (client_id, currency, amount) VALUES ${values.slice(i, i + 500).join(",")} ON CONFLICT DO NOTHING RETURNING 1`).run()
  }
  await db.prepare("INSERT INTO client_balance_baseline_meta (id, seeded_at) VALUES (1, ?) ON CONFLICT DO NOTHING RETURNING 1").run(new Date().toISOString())
}

async function loadBaseline(db: PgDb): Promise<Map<number, Currencies>> {
  const rows = (await db.prepare("SELECT client_id, currency, amount FROM client_balance_baseline").all()) as { client_id: number; currency: string; amount: number }[]
  const map = new Map<number, Currencies>()
  for (const row of rows) {
    const entry = map.get(Number(row.client_id)) ?? {}
    entry[row.currency] = Number(row.amount)
    map.set(Number(row.client_id), entry)
  }
  return map
}

/** Per client: what the app moved since the baseline (only clients with a non-zero change). */
export async function getLiveBalanceDeltas(db: PgDb = getDb()): Promise<Map<number, Currencies>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.deltas
  await ensureBaseline(db)
  const [ends, baseline] = await Promise.all([clientLedgerEnds(db), loadBaseline(db)])
  const deltas = new Map<number, Currencies>()
  for (const clientId of new Set([...ends.keys(), ...baseline.keys()])) {
    const now = ends.get(clientId) ?? {}
    const before = baseline.get(clientId) ?? {}
    const delta: Currencies = {}
    for (const code of new Set([...Object.keys(now), ...Object.keys(before)])) {
      const change = round((now[code] ?? 0) - (before[code] ?? 0))
      if (Math.abs(change) > 0.005) delta[code] = change
    }
    if (Object.keys(delta).length) deltas.set(clientId, delta)
  }
  cache = { at: Date.now(), deltas }
  return deltas
}

/** Forget the cached deltas (called after writes so the next read is fresh). */
export function resetLiveBalanceCache(): void {
  cache = undefined
}

const codeOf = (token: string) => (/^(euro|eur)$/i.test(token) ? "EUR" : token.toUpperCase())

/** "-251 171 800 SUM" / "-17,6 USD" / "20 Euro" → { SUM: -251171800 }. */
export function parseBalanceLines(lines: string[] | undefined): Currencies {
  const result: Currencies = {}
  for (const line of lines ?? []) {
    const match = String(line).replace(/[\s ]/g, "").match(/^(-?[\d.,]+)([A-Za-zА-Яа-я]+)$/)
    if (!match) continue
    const code = codeOf(match[2])
    result[code] = (result[code] ?? 0) + Number(match[1].replace(",", "."))
  }
  return result
}

export function formatBalanceLine(code: string, amount: number): string {
  const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(Math.abs(amount)).replace(/[\s  ]/g, " ")
  return `${amount < 0 ? "-" : ""}${text} ${LABEL[code] ?? code}`
}

const ORDER = ["SUM", "USD", "EUR"]

/** Reference balance (static lines / number) + the app's delta, as the client list shows it. */
export function mergeBalance(base: { balance?: number | null; lines?: string[] }, delta: Currencies | undefined): { balance: number | undefined; lines: string[] | undefined } {
  if (!delta || !Object.keys(delta).length) return { balance: base.balance ?? undefined, lines: base.lines }
  const current = base.lines?.length ? parseBalanceLines(base.lines) : base.balance ? { SUM: Number(base.balance) } : {}
  const merged: Currencies = { ...current }
  for (const [code, change] of Object.entries(delta)) merged[code] = round((merged[code] ?? 0) + change)
  const codes = Object.keys(merged).filter((code) => Math.abs(merged[code]) > 0.0005).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99))
  return { balance: merged.SUM ?? 0, lines: codes.length ? codes.map((code) => formatBalanceLine(code, merged[code])) : undefined }
}

type DebtLine = { currency: string; amount: number }

/** The signed balance of one client (reference balance + delta) as order-card debt lines; null if the client is unknown. */
export async function liveClientDebtLines(clientName: string, db: PgDb = getDb()): Promise<DebtLine[] | null> {
  const row = (await db.prepare("SELECT id, balance, attributes FROM clients WHERE name = ? ORDER BY id DESC LIMIT 1").get(clientName)) as { id: number; balance: number | null; attributes: string | null } | undefined
  if (!row) return null
  let lines: string[] | undefined
  try {
    const raw = (JSON.parse(row.attributes ?? "{}") as Record<string, unknown>)._balances
    lines = typeof raw === "string" && raw ? raw.split("|") : undefined
  } catch {
    lines = undefined
  }
  const deltas = await getLiveBalanceDeltas(db)
  const merged = mergeBalance({ balance: row.balance, lines }, deltas.get(Number(row.id)))
  const parsed = merged.lines?.length ? parseBalanceLines(merged.lines) : merged.balance ? { SUM: merged.balance } : {}
  const result = Object.entries(parsed).map(([currency, amount]) => ({ currency: currency === "EUR" ? "EUR" : currency, amount }))
  return result.length ? result : [{ currency: "SUM", amount: 0 }]
}
