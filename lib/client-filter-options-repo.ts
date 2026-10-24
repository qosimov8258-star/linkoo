import "server-only"

import { getDb } from "@/lib/db"

// Option lists of the "Клиенты" filter panel. The demo loads them from its own selects, each in the order its
// API returns: client types by name, users by id, refusal types newest first, categories by id, zones by name.

export type ClientFilterOptions = {
  types: string[]
  users: string[]
  zones: string[]
  refusalTypes: string[]
  categories: string[]
  collectors: string[]
  channelCategories: string[]
}

// names sort ignoring case; Latin names come before Cyrillic ones like in the demo's database
const collator = new Intl.Collator("en", { sensitivity: "base" })

export async function getClientFilterOptions(): Promise<ClientFilterOptions> {
  const db = getDb()
  const names = async (sql: string) => ((await db.prepare(sql).all()) as { name: string | null }[]).map((row) => (row.name ?? "").trim()).filter(Boolean)
  const types = (await names("SELECT name FROM client_types WHERE parent_id IS NULL")).sort((a, b) => collator.compare(a, b))
  // the demo's user select: active employees except the account itself, 50 of them, by id
  const users = (await names("SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name FROM employees WHERE active = 1 AND id >= 200 ORDER BY id LIMIT 50"))
  const zones = (await names("SELECT title AS name FROM zone_options")).sort((a, b) => collator.compare(a, b))
  const refusalTypes = await names("SELECT name FROM refusal_types ORDER BY id DESC")
  const categories = await names("SELECT name FROM store_categories ORDER BY id")
  // collectors: the employees who can take money, i.e. with at least one cashbox
  const staff = (await db
    .prepare("SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name, details FROM employees WHERE active = 1 AND id >= 200 ORDER BY id")
    .all()) as { name: string; details: string | null }[]
  const collectors = staff
    .filter((row) => {
      try {
        const ids = (JSON.parse(row.details || "{}") as { cashboxIds?: unknown[] }).cashboxIds
        return Array.isArray(ids) && ids.length > 0
      } catch {
        return false
      }
    })
    .map((row) => row.name)
    .filter(Boolean)
  // channel categories of the demo's MarketChannelCategory select
  await db.exec("CREATE TABLE IF NOT EXISTS client_channel_categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL)")
  const channelCategories = await names("SELECT name FROM client_channel_categories ORDER BY id")
  return { types, users, zones, refusalTypes, categories, collectors, channelCategories }
}
