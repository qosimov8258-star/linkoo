// Shared (client + server) shapes of "Организация" (demo #/division, API main/division/).
// See lib/organizations-repo.ts for the storage rules (unique names, rename cascade,
// delete refused while referenced).

/** Element of the plain GET /api/organizations array used by every organization select. */
export type Organization = { id: number; name: string; limitByDebt: boolean }

/** Row of the paged list (demo {id, name, created_date, use_limit_for_debt}). */
export type OrganizationListItem = Organization & { createdDate: string }

/** GET /api/organizations?page=&pageSize=&search=&ordering= (demo {count, results}). */
export type OrganizationListResult = { count: number; results: OrganizationListItem[] }

/** Where an organization is referenced (label = Russian i18n key of the section). */
export type OrganizationUsage = { table: string; label: string; count: number }

/** GET /api/organizations/[id] (`usage` only with ?usage=1). */
export type OrganizationDetail = OrganizationListItem & { usage?: OrganizationUsage[] }

/** Error body of the organization endpoints (`fields.name` = inline error of the dialog). */
export type OrganizationErrorBody = {
  error?: string
  fields?: { name?: string }
  usage?: OrganizationUsage[]
  details?: { fieldErrors?: Record<string, string[] | undefined> }
}

export const ORGANIZATIONS_API = "/api/organizations"

/** Header sorting of the grid: only "Наименование" is sortable in the demo. */
export type OrganizationOrdering = "" | "name" | "-name"
