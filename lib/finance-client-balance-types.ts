// Shared (client + server) shapes of the "Баланс клиентов" page API
// (GET /api/balances/client-balance and …/options). The list itself is a
// regular BalanceListResult (lib/finance/types.ts).

/** Filter value meaning "clients without a type" (placeName("-") === ""). */
export const NO_CLIENT_TYPE = "-"

/** Lookup values of the filter popup, taken from the reference tables and
 * the values actually stored on clients / money rows. */
export type ClientBalanceOptions = {
  branches: string[]
  organizations: string[]
  zones: string[]
  /** Client type names (client_types ∪ clients.type). */
  types: string[]
  /** True when some clients have no type (option NO_CLIENT_TYPE). */
  untyped: boolean
  /** "Клиенты агента": clients.agent ∪ employees with an agent position. */
  agents: string[]
  /** "Доставщик" / "Ответственные доставщики": clients.deliverer ∪ delivery employees. */
  deliverers: string[]
  /** "Ответственный инкасатор": clients.collector ∪ collector employees. */
  collectors: string[]
}
