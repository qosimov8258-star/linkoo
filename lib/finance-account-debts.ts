import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import type { AccountDebtOptions } from "@/lib/finance-account-debts-types"
import { nameKey } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// Filter options of "Долги по счетам" (and its act / group payment): the
// values the /api/balances/account filters actually match on — client
// attributes (clients.branch/zone/type/agent/deliverer/collector are free
// text) plus the branches / organizations / client types directories. One
// UNION ALL query instead of shipping the whole client list to the browser.

type OptionKind = "branch" | "organization" | "zone" | "type" | "agent" | "deliverer" | "collector"

export async function getAccountDebtOptions(db: PgDb = getDb()): Promise<AccountDebtOptions> {
  const s = await ensureFinanceSchema(db)
  const parts: string[] = []
  if (s.has("clients")) {
    for (const [kind, column] of [
      ["zone", "zone"],
      ["type", "type"],
      ["agent", "agent"],
      ["deliverer", "deliverer"],
      ["collector", "collector"],
      ["branch", "branch"],
    ] as const) {
      if (s.col("clients", column)) parts.push(`SELECT '${kind}' AS k, ${column} AS v FROM clients`)
    }
  }
  if (s.has("branches")) parts.push("SELECT 'branch' AS k, name AS v FROM branches")
  if (s.has("organizations")) parts.push("SELECT 'organization' AS k, name AS v FROM organizations")
  // Organizations named on client money rows (the organization filter is movement-level).
  if (s.col("customer_payments", "organization")) parts.push("SELECT 'organization' AS k, organization AS v FROM customer_payments")
  if (s.col("cash_management_entries", "organization")) parts.push("SELECT 'organization' AS k, organization AS v FROM cash_management_entries WHERE btrim(client_name) <> ''")
  if (s.has("client_types")) parts.push("SELECT 'type' AS k, name AS v FROM client_types")

  const options: Record<OptionKind, Map<string, string>> = {
    branch: new Map(),
    organization: new Map(),
    zone: new Map(),
    type: new Map(),
    agent: new Map(),
    deliverer: new Map(),
    collector: new Map(),
  }
  if (parts.length) {
    const rows = (await db
      .prepare(
        `SELECT k, fin_place(v) AS v FROM (${parts.join("\nUNION ALL ")}) o
         WHERE fin_place(v) <> '' GROUP BY k, fin_place(v)`,
      )
      .all()) as Array<{ k: OptionKind; v: string }>
    for (const row of rows) {
      const target = options[row.k]
      const key = nameKey(row.v)
      // Filters compare normalised names, so spelling variants are one option.
      if (target && key && !target.has(key)) target.set(key, row.v)
    }
  }
  const sorted = (map: Map<string, string>) => [...map.values()].sort((a, b) => a.localeCompare(b, "ru"))
  return {
    branches: sorted(options.branch),
    organizations: sorted(options.organization),
    zones: sorted(options.zone),
    clientTypes: sorted(options.type),
    agents: sorted(options.agent),
    deliverers: sorted(options.deliverer),
    collectors: sorted(options.collector),
  }
}
