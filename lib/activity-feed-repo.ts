import "server-only"

import { getDb } from "@/lib/db"

// "Активность": the agents' event feed (orders, deliveries, payments, reports, rejections) of a date range.
export type FeedKind = "order" | "delivery" | "payment" | "report" | "rejection" | "return"
export type FeedItem = {
  kind: FeedKind
  id: number
  userId: number | null
  userName: string
  at: string
  text: string
  marketId: number | null
  marketName: string | null
  extra: Record<string, unknown>
}

export const FEED_PAGE_SIZE = 25

async function ensure() {
  const db = getDb()
  await db.exec(
    "CREATE TABLE IF NOT EXISTS activity_feed (kind TEXT NOT NULL, id BIGINT NOT NULL, user_id INTEGER, user_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, range_date TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', market_id INTEGER, market_name TEXT, extra TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (kind, id))",
  )
  await db.exec("CREATE TABLE IF NOT EXISTS activity_summary_days (day TEXT PRIMARY KEY, order_count INTEGER NOT NULL DEFAULT 0, order_total DOUBLE PRECISION NOT NULL DEFAULT 0, tx_count INTEGER NOT NULL DEFAULT 0, tx_total DOUBLE PRECISION NOT NULL DEFAULT 0, delivery_count INTEGER NOT NULL DEFAULT 0, report_done INTEGER NOT NULL DEFAULT 0, rejection_count INTEGER NOT NULL DEFAULT 0, return_count INTEGER NOT NULL DEFAULT 0, return_total DOUBLE PRECISION NOT NULL DEFAULT 0)")
  await db.exec("ALTER TABLE activity_summary_days ADD COLUMN IF NOT EXISTS return_count INTEGER NOT NULL DEFAULT 0")
  await db.exec("ALTER TABLE activity_summary_days ADD COLUMN IF NOT EXISTS return_total DOUBLE PRECISION NOT NULL DEFAULT 0")
  await db.exec("CREATE TABLE IF NOT EXISTS activity_agent_days (day TEXT NOT NULL, agent_id INTEGER NOT NULL, sales DOUBLE PRECISION NOT NULL DEFAULT 0, visit_markets DOUBLE PRECISION NOT NULL DEFAULT 0, PRIMARY KEY (day, agent_id))")
  await db.exec("CREATE TABLE IF NOT EXISTS activity_delivery_days (id BIGINT PRIMARY KEY, day TEXT NOT NULL)")
  await db.exec("CREATE TABLE IF NOT EXISTS activity_agent_order (agent_id INTEGER PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '')")
  await db.exec("ALTER TABLE activity_agent_order ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''")
  return db
}

type Row = { kind: FeedKind; id: number | string; user_id: number | null; user_name: string; at: string; text: string; market_id: number | null; market_name: string | null; extra: string }

function toItem(row: Row): FeedItem {
  let extra: Record<string, unknown> = {}
  try {
    extra = JSON.parse(row.extra || "{}")
  } catch {
    extra = {}
  }
  return { kind: row.kind, id: Number(row.id), userId: row.user_id, userName: row.user_name, at: row.at, text: row.text, marketId: row.market_id, marketName: row.market_name, extra }
}

export async function listFeed(kind: FeedKind, begin: string, end: string, agent: number | null, page: number) {
  const db = await ensure()
  const args: unknown[] = [kind, begin, end]
  // The reference filters a delivery by the creation day of its order, not by the day it was delivered.
  let where = "f.kind = ? AND COALESCE(d.day, f.range_date) BETWEEN ? AND ?"
  if (agent) {
    where += " AND f.user_id = ?"
    args.push(agent)
  }
  const from = "activity_feed f LEFT JOIN activity_delivery_days d ON f.kind = 'delivery' AND d.id = f.id"
  const count = Number(((await db.prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE ${where}`).get(...args)) as { n: number | string }).n)
  const rows = (await db
    .prepare(`SELECT f.kind, f.id, f.user_id, f.user_name, f.at, f.text, f.market_id, f.market_name, f.extra FROM ${from} WHERE ${where} ORDER BY f.at DESC, f.id DESC LIMIT ? OFFSET ?`)
    .all(...args, FEED_PAGE_SIZE, (Math.max(1, page) - 1) * FEED_PAGE_SIZE)) as Row[]
  return { count, results: rows.map(toItem) }
}

const amountOf = (text: string) => {
  const match = /(?:на сумму|Принято)\s+([\d\s .,]+?)\s+[A-Za-z]{3}/.exec(text)
  return match ? Number(match[1].replace(/[\s ]/g, "").replace(",", ".")) || 0 : 0
}

/**
 * The counters above the columns. The reference asks market/today_plan_stat_sum, which is additive per day, so they are
 * the sum of the stored daily rows of the range (its order count / sum differ from the list lengths on purpose). With an
 * agent chosen the numbers fall back to the agent's own feed rows.
 */
export async function feedTotals(begin: string, end: string, agent: number | null) {
  const db = await ensure()
  if (!agent) {
    const row = (await db
      .prepare(
        "SELECT COALESCE(SUM(order_count),0) AS oc, COALESCE(SUM(order_total),0) AS ot, COALESCE(SUM(tx_count),0) AS tc, COALESCE(SUM(tx_total),0) AS tt, COALESCE(SUM(delivery_count),0) AS dc, COALESCE(SUM(report_done),0) AS rd, COALESCE(SUM(rejection_count),0) AS rj, COALESCE(SUM(return_count),0) AS rc, COALESCE(SUM(return_total),0) AS rt FROM activity_summary_days WHERE day BETWEEN ? AND ?",
      )
      .get(begin, end)) as Record<string, string | number>
    return { orders: Number(row.oc), ordersSum: Number(row.ot), rejections: Number(row.rj), reports: Number(row.rd), payments: Number(row.tc), paymentsSum: Number(row.tt), deliveries: Number(row.dc), returns: Number(row.rc), returnsSum: Number(row.rt) }
  }
  const rows = (await db.prepare("SELECT kind, text FROM activity_feed WHERE range_date BETWEEN ? AND ? AND user_id = ?").all(begin, end, agent)) as Array<{ kind: FeedKind; text: string }>
  const out = { orders: 0, ordersSum: 0, rejections: 0, reports: 0, payments: 0, paymentsSum: 0, deliveries: 0, returns: 0, returnsSum: 0 }
  for (const row of rows) {
    if (row.kind === "order") {
      out.orders += 1
      out.ordersSum += amountOf(row.text)
    } else if (row.kind === "payment") {
      out.payments += 1
      out.paymentsSum += amountOf(row.text)
    } else if (row.kind === "rejection") out.rejections += 1
    else if (row.kind === "report") out.reports += 1
    else if (row.kind === "delivery") out.deliveries += 1
    else if (row.kind === "return") out.returns += 1
  }
  return out
}

/** The agent strip (market/agent/done_plan): the reference's agents in its order, each with the visited markets and the sales of the range (summed per day). */
export async function agentTiles(begin: string, end: string) {
  const db = await ensure()
  const stats = (await db
    .prepare("SELECT agent_id, SUM(sales) AS sales, SUM(visit_markets) AS markets FROM activity_agent_days WHERE day BETWEEN ? AND ? GROUP BY agent_id")
    .all(begin, end)) as Array<{ agent_id: number; sales: number | string; markets: number | string }>
  const byId = new Map(stats.map((row) => [Number(row.agent_id), row]))
  const agents = (await db.prepare("SELECT agent_id, name FROM activity_agent_order ORDER BY position").all()) as Array<{ agent_id: number; name: string }>
  return agents.map((agent) => ({ id: Number(agent.agent_id), name: agent.name, count: Number(byId.get(Number(agent.agent_id))?.markets ?? 0), sales: Number(byId.get(Number(agent.agent_id))?.sales ?? 0) }))
}
