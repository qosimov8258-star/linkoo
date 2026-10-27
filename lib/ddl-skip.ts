// Lazy-schema DDL that has nothing to do never reaches Postgres (used by db.exec).
//
// Modules create their tables, columns and indexes lazily, on the first use per process
// (ensure…Schema). Postgres takes the table lock BEFORE it checks "IF NOT EXISTS":
//   ALTER TABLE … ADD COLUMN IF NOT EXISTS  → ACCESS EXCLUSIVE (conflicts even with reads),
//   CREATE INDEX IF NOT EXISTS              → SHARE (conflicts with writes),
//   CREATE OR REPLACE TRIGGER               → SHARE ROW EXCLUSIVE (conflicts with writes),
// even when the column / index / trigger is already there. The first request after a
// restart may run that DDL on a pool connection while a caller's transaction on another
// connection already read or wrote the table and now waits for the same ensure…Schema: the
// DDL waits for the transaction, the transaction for the DDL, and Postgres cannot see the
// cycle — the whole server hung. withoutCurrentDdl() asks the catalog first (one query) and
// leaves out exactly those statements that would do nothing, so a current schema takes no
// table lock at all. On a fresh or an older database the missing pieces still run as written.

type Query = (text: string, values: unknown[]) => Promise<Array<Record<string, unknown>>>

type Check =
  | { kind: "columns"; table: string; columns: string[] }
  | { kind: "relation"; name: string }
  | { kind: "trigger"; table: string; name: string; definition: string }

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`
const ALTER_RE = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${IDENT})\s+([\s\S]+)$`, "i")
const ADD_COLUMN_RE = new RegExp(String.raw`^ADD\s+(?:COLUMN\s+)?IF\s+NOT\s+EXISTS\s+(${IDENT})\s+\S`, "i")
const INDEX_RE = new RegExp(String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+(${IDENT})\s+ON\s`, "i")
const TRIGGER_RE = new RegExp(
  String.raw`^CREATE\s+OR\s+REPLACE\s+TRIGGER\s+(${IDENT})\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s[\s\S]*?\sON\s+(${IDENT})\s`,
  "i",
)
// Cheap pre-test: SQL without any of these runs untouched, with no catalog query.
const CANDIDATE_RE = /\bIF\s+NOT\s+EXISTS\b|\bREPLACE\s+TRIGGER\b/i

/** Unquoted identifiers fold to lower case; quoted ones keep their spelling. */
function identName(raw: string): string {
  return raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw.toLowerCase()
}

/** Index just past the quoted string, dollar-quoted body or comment starting at `i`
 * (or `i` itself when none starts there). */
function skipQuoted(sql: string, i: number): number {
  const ch = sql[i]
  const next = sql[i + 1]
  if (ch === "-" && next === "-") {
    const end = sql.indexOf("\n", i + 2)
    return end === -1 ? sql.length : end + 1
  }
  if (ch === "/" && next === "*") {
    let depth = 1
    let j = i + 2
    while (j < sql.length && depth > 0) {
      if (sql[j] === "/" && sql[j + 1] === "*") {
        depth++
        j += 2
      } else if (sql[j] === "*" && sql[j + 1] === "/") {
        depth--
        j += 2
      } else j++
    }
    return j
  }
  if (ch === "'") {
    // E'…' strings take backslash escapes.
    const escapes = i > 0 && (sql[i - 1] === "E" || sql[i - 1] === "e") && (i < 2 || !/[\w$]/.test(sql[i - 2]))
    let j = i + 1
    while (j < sql.length) {
      if (escapes && sql[j] === "\\") j += 2
      else if (sql[j] === "'" && sql[j + 1] === "'") j += 2
      else if (sql[j] === "'") return j + 1
      else j++
    }
    return j
  }
  if (ch === '"') {
    let j = i + 1
    while (j < sql.length) {
      if (sql[j] === '"' && sql[j + 1] === '"') j += 2
      else if (sql[j] === '"') return j + 1
      else j++
    }
    return j
  }
  if (ch === "$" && (i === 0 || !/[\w$]/.test(sql[i - 1]))) {
    const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))
    if (tag) {
      const end = sql.indexOf(tag[0], i + tag[0].length)
      return end === -1 ? sql.length : end + tag[0].length
    }
  }
  return i
}

/** Splits SQL at its top-level `;` (quotes, dollar-quoted DO / function bodies and comments
 * stay whole). Joining the parts with ";" gives the input back. */
export function splitStatements(sql: string): string[] {
  const parts: string[] = []
  let start = 0
  let i = 0
  while (i < sql.length) {
    const skipped = skipQuoted(sql, i)
    if (skipped !== i) {
      i = skipped
    } else if (sql[i] === ";") {
      parts.push(sql.slice(start, i))
      start = ++i
    } else i++
  }
  parts.push(sql.slice(start))
  return parts
}

/** The statement without its leading whitespace and comments ("" when nothing else). */
function code(statement: string): string {
  let i = 0
  for (;;) {
    while (i < statement.length && /\s/.test(statement[i])) i++
    if (statement.startsWith("--", i) || statement.startsWith("/*", i)) i = skipQuoted(statement, i)
    else return statement.slice(i).trim()
  }
}

/** Splits at top-level commas (not inside parentheses, quotes or comments). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < text.length) {
    const skipped = skipQuoted(text, i)
    if (skipped !== i) {
      i = skipped
      continue
    }
    const ch = text[i]
    if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
    i++
  }
  parts.push(text.slice(start))
  return parts.map((part) => code(part))
}

/** Same text for a CREATE OR REPLACE TRIGGER statement and pg_get_triggerdef() of the
 * trigger it made: one spacing, lower case, no "OR REPLACE", no schema qualifiers. */
export function triggerShape(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/;$/, "")
    .toLowerCase()
    .replace(/^create or replace trigger /, "create trigger ")
    .replace(/"?[a-z_][a-z0-9_$]*"?\.(?=["a-z_])/g, "")
}

/** What must already exist for the statement to be a no-op (null: always run it). */
export function ddlCheck(statement: string): Check | null {
  const text = code(statement)
  const alter = ALTER_RE.exec(text)
  if (alter) {
    const columns: string[] = []
    for (const action of splitTopLevel(alter[2])) {
      const add = ADD_COLUMN_RE.exec(action)
      if (!add) return null
      columns.push(identName(add[1]))
    }
    return columns.length ? { kind: "columns", table: identName(alter[1]), columns } : null
  }
  const index = INDEX_RE.exec(text)
  if (index) return { kind: "relation", name: identName(index[1]) }
  const trigger = TRIGGER_RE.exec(text)
  if (trigger) return { kind: "trigger", name: identName(trigger[1]), table: identName(trigger[2]), definition: triggerShape(text) }
  return null
}

const CATALOG_SQL = `
SELECT
  COALESCE((SELECT json_agg(c.relname || '.' || a.attname)
              FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
             WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind IN ('r', 'p')
               AND a.attnum > 0 AND NOT a.attisdropped AND c.relname = ANY($1::text[])), '[]'::json) AS columns,
  COALESCE((SELECT json_agg(c.relname) FROM pg_class c
             WHERE c.relnamespace = current_schema()::regnamespace AND c.relname = ANY($2::text[])), '[]'::json) AS relations,
  COALESCE((SELECT json_agg(json_build_array(c.relname, t.tgname, pg_get_triggerdef(t.oid)))
              FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
             WHERE c.relnamespace = current_schema()::regnamespace AND NOT t.tgisinternal
               AND t.tgname = ANY($3::text[])), '[]'::json) AS triggers`

/** `sql` without its ADD COLUMN / CREATE INDEX / CREATE OR REPLACE TRIGGER statements that
 * the catalog shows would change nothing; null when no statement is left to run. Every
 * other statement (CREATE TABLE IF NOT EXISTS, functions, DO blocks, backfills) is kept
 * as written and in order. `query` reads the catalog on the caller's own connection. */
export async function withoutCurrentDdl(sql: string, query: Query): Promise<string | null> {
  if (!CANDIDATE_RE.test(sql)) return sql
  const statements = splitStatements(sql)
  const checks = statements.map((statement) => ddlCheck(statement))
  if (!checks.some(Boolean)) return sql
  const tables = new Set<string>()
  const relations = new Set<string>()
  const triggers = new Set<string>()
  for (const check of checks) {
    if (check?.kind === "columns") tables.add(check.table)
    else if (check?.kind === "relation") relations.add(check.name)
    else if (check?.kind === "trigger") triggers.add(check.name)
  }
  const [row] = await query(CATALOG_SQL, [[...tables], [...relations], [...triggers]])
  const columns = new Set((row?.columns as string[] | undefined) ?? [])
  const existing = new Set((row?.relations as string[] | undefined) ?? [])
  const defined = new Set(((row?.triggers as Array<[string, string, string]> | undefined) ?? []).map(([table, name, def]) => `${table}|${name}|${triggerShape(def)}`))
  const current = (check: Check | null): boolean => {
    if (!check) return false
    if (check.kind === "columns") return check.columns.every((column) => columns.has(`${check.table}.${column}`))
    if (check.kind === "relation") return existing.has(check.name)
    return defined.has(`${check.table}|${check.name}|${check.definition}`)
  }
  const kept = statements.filter((_statement, index) => !current(checks[index]))
  if (kept.length === statements.length) return sql
  return kept.some((statement) => code(statement) !== "") ? kept.join(";") : null
}
