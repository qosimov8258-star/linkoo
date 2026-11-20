import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { getBalanceFilterOptions } from "@/lib/finance-client-balance"
import type { AccountDebtOptions } from "@/lib/finance-account-debts-types"

// Filter options of "Долги по счетам" (and its act / group payment). Linko's
// account page uses the same pickers as Баланс клиентов (branches, zones,
// organizations and top-level client types by name; deliverers / collectors /
// agents = the staff with that capability, by id), so the lists come from
// getBalanceFilterOptions. The filters compare normalised names.
export async function getAccountDebtOptions(db: PgDb = getDb()): Promise<AccountDebtOptions> {
  const options = await getBalanceFilterOptions(db)
  return {
    branches: options.branches,
    organizations: options.organizations,
    zones: options.zones,
    clientTypes: options.types,
    agents: options.agents,
    deliverers: options.deliverers,
    collectors: options.collectors,
  }
}
