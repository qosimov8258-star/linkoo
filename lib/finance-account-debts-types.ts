// Shared (client + server) types of the "Долги по счетам" page API.

/** GET /api/balances/account-debts/options — values the account list filters match on. */
export type AccountDebtOptions = {
  branches: string[]
  organizations: string[]
  zones: string[]
  clientTypes: string[]
  agents: string[]
  deliverers: string[]
  collectors: string[]
}
