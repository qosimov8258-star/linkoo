// READ-ONLY report: which demo / reference rows the removed scripts/demo seed and apply scripts left in a database,
// and which of the rollback-*.mjs tools in this folder still has something to undo there. Nothing is changed (the
// whole report runs in a READ ONLY transaction).
//
//   node scripts/demo/demo-seed-status.mjs            (reads DATABASE_URL from the environment, else from .env)
//
// Background: the seed / apply scripts were deleted (a fresh install never gets another company's data), but a
// database where they ran still holds what they wrote. Every seed registered its rows in demo_seed_rows
// (table_name, row_id, domain); the apply scripts that changed existing rows kept the old values in
// demo_seed_updates or in demo_seed_backup_* tables. The rollback-*.mjs scripts undo exactly that, domain by domain.
// They are one-off tools, never run by the app. Run them in the order printed below (the undo of the apply scripts
// first, then the seeds, newest registration first), and read a script's header first: the ones that "restore" put
// an earlier state back (for example demo rows a later script had removed, or values a later script had changed).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envFile = path.join(root, ".env")
  const match = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m) : null
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

// What every rollback script refers to: the domains (quoted literals next to "domain"), the backup tables and the
// tables it drops. Read from the scripts themselves, so the report follows them.
const scripts = fs
  .readdirSync(here)
  .filter((name) => /^rollback-.*\.mjs$/.test(name))
  .sort()
  .map((name) => {
    const text = fs.readFileSync(path.join(here, name), "utf8")
    const domains = new Set()
    for (const match of text.matchAll(/domain\s*=\s*['"]([a-z0-9-]+)['"]/gi)) domains.add(match[1])
    for (const match of text.matchAll(/DOMAIN\s*=\s*['"]([a-z0-9-]+)['"]/g)) domains.add(match[1])
    const backups = new Set([...text.matchAll(/demo_seed_backup_[a-z0-9_]+/g)].map((match) => match[0]))
    const drops = new Set([...text.matchAll(/DROP TABLE(?: IF EXISTS)? ([a-z0-9_]+)/g)].map((match) => match[1]))
    for (const match of text.matchAll(/for \(const t of \[([^\]]+)\]\) await c\.query\(`DROP TABLE/g)) {
      for (const table of match[1].matchAll(/'([a-z0-9_]+)'/g)) drops.add(table[1])
    }
    const header = text.split("\n").find((line) => line.startsWith("//"))?.replace(/^\/\/\s*/, "") ?? ""
    return { name, header, domains: [...domains], backups: [...backups], drops: [...drops] }
  })

const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN TRANSACTION READ ONLY")
  const exists = async (table) => Boolean((await client.query("SELECT to_regclass($1) AS t", [table])).rows[0].t)
  const count = async (table) => Number((await client.query(`SELECT count(*)::int AS n FROM "${table.replace(/"/g, '""')}"`)).rows[0].n)

  const registry = new Map()
  if (await exists("demo_seed_rows")) {
    const rows = (
      await client.query(
        `SELECT domain, table_name, count(*)::int AS n, min(created_at) AS first, max(created_at) AS last
           FROM demo_seed_rows WHERE table_name <> '_marker' GROUP BY domain, table_name ORDER BY domain, table_name`,
      )
    ).rows
    for (const row of rows) {
      const entry = registry.get(row.domain) ?? { tables: [], last: null }
      entry.tables.push(`${row.table_name} ${row.n}`)
      if (!entry.last || row.last > entry.last) entry.last = row.last
      registry.set(row.domain, entry)
    }
  }
  const updates = new Map()
  if (await exists("demo_seed_updates")) {
    for (const row of (await client.query("SELECT domain, table_name, count(*)::int AS n FROM demo_seed_updates GROUP BY 1, 2 ORDER BY 1, 2")).rows) {
      updates.set(row.domain, [...(updates.get(row.domain) ?? []), `${row.table_name} ${row.n}`])
    }
  }
  const backupTables = (
    await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'demo_seed_backup_%' ORDER BY 1")
  ).rows.map((row) => row.table_name)

  if (!registry.size && !updates.size && !backupTables.length) {
    console.log("No demo seed registry, saved old values or backups: no demo script left anything to undo in this database.")
  } else {
    console.log("Registered demo rows (demo_seed_rows), by domain:")
    for (const [domain, entry] of registry) console.log(`  ${domain}: ${entry.tables.join(", ")}  (last registered ${new Date(entry.last).toISOString()})`)
    if (updates.size) {
      console.log("\nOld values kept by apply scripts (demo_seed_updates), by domain:")
      for (const [domain, tables] of updates) console.log(`  ${domain}: ${tables.join(", ")}`)
    }
    if (backupTables.length) {
      console.log("\nBackup tables (demo_seed_backup_*):")
      for (const table of backupTables) console.log(`  ${table}: ${await count(table)} rows`)
    }
  }

  // Which rollback scripts have something to do here, newest registration first.
  const pending = []
  for (const script of scripts) {
    const domains = script.domains.filter((domain) => registry.has(domain) || updates.has(domain))
    // A name ending in "_" is a prefix the script completes at run time (demo_seed_backup_drift_<table>).
    const backups = backupTables.filter((table) => script.backups.some((name) => (name.endsWith("_") ? table.startsWith(name) : table === name)))
    const drops = []
    for (const table of script.drops) if (await exists(table)) drops.push(table)
    if (!domains.length && !backups.length && !drops.length) continue
    const last = domains.map((domain) => registry.get(domain)?.last).filter(Boolean).sort().pop() ?? null
    pending.push({ ...script, found: [...domains.map((d) => `domain ${d}`), ...backups, ...drops.map((t) => `table ${t}`)], last })
  }
  // The apply scripts (old values / backups, no registration time) ran after the seeds they changed, so their undo
  // comes first; then the seeds, newest registration first.
  pending.sort((a, b) => (a.last && b.last ? (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) : a.last ? 1 : b.last ? -1 : a.name.localeCompare(b.name)))
  console.log(
    pending.length
      ? "\nRollback scripts with something to undo, in the order to run them (read each header first; a script that restores an earlier state is needed only if you want that state back):"
      : "\nNo rollback script has anything to undo here.",
  )
  for (const script of pending) console.log(`  node scripts/demo/${script.name}\n      ${script.header}\n      found: ${script.found.join(", ")}`)
  const unchecked = scripts.filter((script) => !script.domains.length && !script.backups.length && !script.drops.length)
  if (unchecked.length) {
    console.log("\nNot checked automatically (no registry domain, backup or table to look for):")
    for (const script of unchecked) console.log(`  node scripts/demo/${script.name}\n      ${script.header}`)
  }
  await client.query("ROLLBACK")
} finally {
  await client.end()
}
