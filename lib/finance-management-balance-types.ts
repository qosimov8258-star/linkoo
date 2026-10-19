// Isomorphic types of GET /api/balances/management-balance ("Управленческий
// баланс по филиалам"). The report is the shared management balance
// (lib/finance/management.ts) plus what the page needs on top of it: a
// filter value per branch card and the branch filter options.

import type { ManagementBalanceResult, ManagementBranch } from "@/lib/finance/types"

/** Branch filter value of the virtual "Без филиала" card (entities without a branch). */
export const MANAGEMENT_NO_BRANCH = "none"
/** Name (i18n key) of that card; same text as NO_BRANCH_LABEL of lib/finance/management.ts. */
export const MANAGEMENT_NO_BRANCH_LABEL = "Без филиала"
/** Prefix of the filter value of a branch known only by name (not in the branches table). */
export const MANAGEMENT_NAME_PREFIX = "name:"

export type ManagementReportBranch = ManagementBranch & {
  /** Filter value: branches.id, "none" ("Без филиала") or "name:<branch name>". */
  value: string
  /** true for cards that are not rows of the branches table. */
  virtual: boolean
}

export type ManagementBranchOption = { value: string; name: string; virtual: boolean }

export type ManagementReport = Omit<ManagementBalanceResult, "branches"> & {
  /** Applied filters (organization names, branch filter value or ""). */
  organizations: string[]
  branch: string
  /** Every branch card of the period before the branch filter (select options). */
  options: ManagementBranchOption[]
  branches: ManagementReportBranch[]
}
