import "server-only"

import { getDb } from "@/lib/db"

// Option lists of the "Клиенты" filter panel, from this company's own directories, each in the order the reference's
// selects use: client types by name, users by id, refusal types newest first, categories by id, zones by name.

export type ClientFilterOptions = {
  types: string[]
  users: string[]
  zones: string[]
  refusalTypes: string[]
  categories: string[]
  collectors: string[]
  channelCategories: string[]
}

// names sort ignoring case; Latin names come before Cyrillic ones like in the reference
const collator = new Intl.Collator("en", { sensitivity: "base" })

/** Directories created lazily by their own modules: on a fresh database a missing one lists nothing. */
const LAZY_TABLES = ["client_types", "refusal_types", "store_categories"] as const

export async function getClientFilterOptions(): Promise<ClientFilterOptions> {
  const db = getDb()
  const existing = new Set(
    ((await db.prepare("SELECT name FROM unnest(@tables::text[]) AS name WHERE to_regclass(name) IS NOT NULL").all({ tables: [...LAZY_TABLES] })) as { name: string }[]).map(
      (row) => row.name,
    ),
  )
  const names = async (sql: string, table?: (typeof LAZY_TABLES)[number]) =>
    table && !existing.has(table) ? [] : ((await db.prepare(sql).all()) as { name: string | null }[]).map((row) => (row.name ?? "").trim()).filter(Boolean)
  const types = (await names("SELECT t.name FROM client_types t WHERE (to_jsonb(t) ->> 'parent_id') IS NULL", "client_types")).sort((a, b) => collator.compare(a, b))
  // the user select: this company's active employees, by id
  const users = await names("SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name FROM employees WHERE active = 1 ORDER BY id")
  // zones: the directory behind the client's "Зона" (Клиенты → Зона, client_zones)
  const zones = (await names("SELECT name FROM client_zones")).sort((a, b) => collator.compare(a, b))
  const refusalTypes = await names("SELECT name FROM refusal_types ORDER BY id DESC", "refusal_types")
  const categories = await names("SELECT name FROM store_categories ORDER BY id", "store_categories")
  // collectors: the employees who can take money, i.e. with at least one cashbox
  const staff = (await db
    .prepare("SELECT TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name, details FROM employees WHERE active = 1 ORDER BY id")
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
  // channel categories: the sales channels this company's clients carry (clients.sales_channel). The reference
  // account's MarketChannelCategory rows (client_channel_categories) that the removed demo scripts wrote are not read.
  const channelCategories = (await names("SELECT DISTINCT btrim(sales_channel) AS name FROM clients WHERE btrim(COALESCE(sales_channel, '')) <> ''")).sort((a, b) => collator.compare(a, b))
  return { types, users, zones, refusalTypes, categories, collectors, channelCategories }
}
