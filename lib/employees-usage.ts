import "server-only"

import type { PgDb } from "@/lib/db"
import { keySql, listColumns, nameKey } from "@/lib/platform-refs"

// Where Сотрудники keep other master data by id (lib/employees-repo.ts): the job position and the access
// right in integer columns, the branches and organizations as JSON arrays of ids, and the lists of the
// employee form (stocks, price lists, currencies, cashboxes, supervisor / delivery man / audit agents) in
// the JSON `details` blob. The delete check of each of those records adds this count to its usage list
// (409 "Удаление невозможно из-за связи с другими данными" with a "Сотрудники" entry): one call,
// `withEmployeeLinks`, in the record's usage function. An employee in the "Удаленные" tab (active = 0)
// does not count; a stored id whose record is gone is dropped on that employee's next save.
//
// Employees saved before the job / branch ids existed keep the plain job name in `position` and the main
// branch name in `branch`; those are matched by name (the record's `name`), once per employee. Their
// organizations are only in `organizations` (a JSON array of names, still written on every save); an
// organization is matched there by its name as well.

export type EmployeeLinkTarget =
  | "branches"
  | "organizations"
  | "job_positions"
  | "access_rights"
  | "warehouses"
  | "price_lists"
  | "currencies"
  | "cashboxes"
  | "employees"

type Link = {
  /** employees column holding the id: an integer, a JSON array of ids, or the `details` blob. */
  column: string
  shape: "id" | "ids" | "details"
  /** `details` keys that hold an id or a list of ids. */
  keys?: readonly string[]
  /** Text column of older employees that stores the record's name. */
  nameColumn?: string
  /** Text column of older employees with a JSON array of record names. */
  nameListColumn?: string
}

const LINKS: Record<EmployeeLinkTarget, Link> = {
  job_positions: { column: "job_id", shape: "id", nameColumn: "position" },
  access_rights: { column: "access_right_id", shape: "id" },
  branches: { column: "branch_ids", shape: "ids", nameColumn: "branch" },
  organizations: { column: "organization_ids", shape: "ids", nameListColumn: "organizations" },
  warehouses: { column: "details", shape: "details", keys: ["stockIds", "requestStockIds"] },
  price_lists: { column: "details", shape: "details", keys: ["priceListIds", "marketPriceListIds"] },
  currencies: { column: "details", shape: "details", keys: ["currencyIds"] },
  cashboxes: { column: "details", shape: "details", keys: ["cashboxIds", "requestCashboxIds"] },
  // Another employee's supervisor, delivery man or audit agent (the employee's own row never counts).
  employees: { column: "details", shape: "details", keys: ["supervisorId", "deliveryManId", "auditAgentIds"] },
}

/** Usage entry label (a Russian i18n key) and table of the employees. */
export const EMPLOYEES_USAGE_LABEL = "Сотрудники"

function parseJson(text: unknown): unknown {
  if (typeof text !== "string" || !text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** True when `value` is `id` or a list that contains it (numbers only, as the employee form stores them). */
function holds(value: unknown, id: number): boolean {
  if (Array.isArray(value)) return value.some((item) => item === id)
  return value === id
}

/** True when `text` is a JSON array that holds a name whose key (lib/platform-refs.ts nameKey) is `key`. */
function namesHold(text: unknown, key: string): boolean {
  const parsed = parseJson(text)
  return Array.isArray(parsed) && parsed.some((item) => typeof item === "string" && nameKey(item) === key)
}

function linksRow(link: Link, text: unknown, id: number): boolean {
  const parsed = parseJson(text)
  if (link.shape === "ids") return holds(parsed, id)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
  const details = parsed as Record<string, unknown>
  return (link.keys ?? []).some((key) => holds(details[key], id))
}

/**
 * How many active employees refer to the record `target`/`id` (by id, or for older employees by `name`).
 * 0 while the employees table or the column does not exist yet. Read-only; run it inside the delete's
 * transaction after the record's row is locked FOR UPDATE (an employee save takes FOR KEY SHARE on the
 * rows it refers to, so a save running in parallel is either seen here or refused afterwards).
 */
export async function countEmployeeLinks(db: PgDb, target: EmployeeLinkTarget, record: { id: number; name?: string }): Promise<number> {
  const link = LINKS[target]
  const id = Number(record.id)
  if (!Number.isInteger(id) || id <= 0) return 0
  const wanted = [link.column, ...(link.nameColumn ? [link.nameColumn] : []), ...(link.nameListColumn ? [link.nameListColumn] : [])]
  const columns = new Set(
    (await listColumns(db, "c.table_name = 'employees' AND c.column_name = ANY(@columns::text[])", { columns: [...wanted, "active"] })).map(
      (row) => row.column_name,
    ),
  )
  if (!columns.has("active")) return 0
  const self = target === "employees" ? id : 0
  const name = link.nameColumn && columns.has(link.nameColumn) ? (record.name ?? "").trim() : ""
  const byName = name ? `${keySql(`e.${link.nameColumn}`)} = ${keySql("@name::text")}` : "FALSE"
  const listKey = link.nameListColumn && columns.has(link.nameListColumn) ? nameKey(record.name ?? "") : ""
  const hasColumn = columns.has(link.column)
  if (!hasColumn && !listKey) {
    if (!name) return 0
    const row = (await db.prepare(`SELECT COUNT(*)::int AS n FROM employees e WHERE e.active = 1 AND e.id <> @self AND ${byName}`).get({ self, name })) as
      | { n: number }
      | undefined
    return Number(row?.n ?? 0)
  }
  if (link.shape === "id" && hasColumn && !listKey) {
    const row = (await db
      .prepare(`SELECT COUNT(*)::int AS n FROM employees e WHERE e.active = 1 AND e.id <> @self AND (e.${link.column} = @id OR ${byName})`)
      .get({ id, self, name })) as { n: number } | undefined
    return Number(row?.n ?? 0)
  }
  // JSON text: the rows whose text holds the digits (or the name matches, or that list names), then parsed
  // here, so a malformed value never fails the delete.
  const byId = hasColumn ? `strpos(coalesce(e.${link.column}, ''), @digits) > 0` : "FALSE"
  const byList = listKey ? `coalesce(e.${link.nameListColumn}, '') NOT IN ('', '[]')` : "FALSE"
  const rows = (await db
    .prepare(
      `SELECT ${hasColumn ? `e.${link.column}` : "NULL"} AS v, ${listKey ? `e.${link.nameListColumn}` : "NULL"} AS names, (${byName}) AS by_name
         FROM employees e
        WHERE e.active = 1 AND e.id <> @self AND (${byId} OR ${byName} OR ${byList})`,
    )
    .all({ self, name, digits: String(id) })) as Array<{ v: string | null; names: string | null; by_name: boolean }>
  return rows.filter((row) => row.by_name === true || (hasColumn && linksRow(link, row.v, id)) || (listKey !== "" && namesHold(row.names, listKey))).length
}

type UsageLike = { table: string; label: string; count: number }

/**
 * The usage list of a record with the employees that refer to it (countEmployeeLinks) as one
 * "Сотрудники" entry. An employees entry already in `usage` (a name match found by the caller's own
 * column scan, e.g. employees.branch or employees.position) is replaced, so an employee is counted once.
 */
export async function withEmployeeLinks<T extends UsageLike>(
  db: PgDb,
  target: EmployeeLinkTarget,
  record: { id: number; name?: string },
  usage: T[],
): Promise<T[]> {
  const count = await countEmployeeLinks(db, target, record)
  const rest = usage.filter((item) => item.table !== "employees")
  return count > 0 ? [...rest, { table: "employees", label: EMPLOYEES_USAGE_LABEL, count } as T] : rest
}

/** The employees.position text other pages show and match on: "access right · job", empty parts left out. */
export function composePosition(accessRight: string | null | undefined, job: string | null | undefined): string {
  return [accessRight, job].map((part) => String(part ?? "").trim()).filter(Boolean).join(" · ")
}

/** SQL twin of composePosition (concat_ws skips the NULLs). */
const positionSql = (access: string, job: string) => `concat_ws(' · ', NULLIF(btrim(${access}), ''), NULLIF(btrim(${job}), ''))`

/**
 * Re-composes the "access right · job" text (employees.position, read by tracking, attendance, cashboxes …)
 * of the employees linked to a renamed job position or access right. Call it in the rename's transaction.
 */
export async function refreshEmployeePositions(db: PgDb, target: "job_positions" | "access_rights", id: number): Promise<number> {
  const column = target === "job_positions" ? "job_id" : "access_right_id"
  const present = new Set(
    (await listColumns(db, "c.table_name = 'employees' AND c.column_name = ANY(@columns::text[])", { columns: ["position", "job_id", "access_right_id"] })).map(
      (row) => row.column_name,
    ),
  )
  if (present.size < 3) return 0
  const tables = (await db
    .prepare("SELECT to_regclass('access_rights') IS NOT NULL AS rights, to_regclass('job_positions') IS NOT NULL AS jobs")
    .get()) as { rights: boolean; jobs: boolean } | undefined
  const access = tables?.rights ? "coalesce((SELECT a.name FROM access_rights a WHERE a.id = e.access_right_id), '')" : "''"
  const job = tables?.jobs ? "coalesce((SELECT j.name FROM job_positions j WHERE j.id = e.job_id), '')" : "''"
  const result = await db
    .prepare(`UPDATE employees e SET position = ${positionSql(access, job)} WHERE e.${column} = @id AND e.position IS DISTINCT FROM ${positionSql(access, job)}`)
    .run({ id })
  return result.changes
}
