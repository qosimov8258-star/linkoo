// The first step of run-all.sh: makes sure the target database can take this run before any importer writes to it.
// 1. The Linko account of the files and the database belong together (lib.mjs connect(): a database holds one account,
//    marked in linko_sync_source on its first import). A database that is not marked yet and already holds clients,
//    products or employees takes another account's files only with ALLOW_MIX=1: the base steps write rows under Linko's
//    ids, which would land on (and overwrite) rows of whatever account those rows came from. The first account's own
//    database (DATABASE_URL, never marked by the older imports) is the exception lib.mjs already makes.
// 2. The base rows (clients, products, employees and what they name) come from the base steps that follow this one in
//    run-all.sh (import-base-*.mjs): on a new account's copy they create them, on a copy that has them they update
//    them. A database without any of them therefore needs the download's lists those steps read (markets + clients,
//    products, an employees list); without them the run would attach the orders, documents and facts to nothing, so it
//    stops here (ALLOW_EMPTY_BASE=1 runs it anyway).
// 3. The tables and columns the app creates on first use and the importers write into (products.box_unit and the
//    order line columns, supplier_incomings.ref_items, the supplier, employee, branch and van-sell ledgers) are created
//    with the app's own code: each call below creates its tables first and only reads.
//
//   node node_modules/tsx/dist/cli.mjs --conditions=react-server --tsconfig tsconfig.json scripts/linko-sync/prepare-target.ts
//   (RAW / TARGET_DB as for every importer)
import pg from "pg"

import { FIRST_SERVER, appDatabase, connect, filesServer, hasRaw, rawEnv, tableExists, targetUrl } from "./lib.mjs"

const BASE_TABLES = ["clients", "products", "employees"]

/** The raw lists the base steps create the base rows from: each entry is satisfied by any one of its names. */
const BASE_LISTS = [
  ["markets"],
  ["clients"],
  ["products", "products_notraw"],
  ["employees_all", "employees_active", "employees_inactive"],
]

async function main() {
  const server = filesServer()
  // Read before connect(): connect() marks a database on its first import.
  const plain = new pg.Client({ connectionString: targetUrl().toString() })
  await plain.connect()
  const counts: Record<string, number> = {}
  let marked: string | null = null
  try {
    for (const table of BASE_TABLES) {
      counts[table] = (await tableExists(plain, table)) ? Number((await plain.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n) : 0
    }
    if (await tableExists(plain, "linko_sync_source")) marked = (await plain.query("SELECT server FROM linko_sync_source WHERE id = 1")).rows[0]?.server ?? null
  } finally {
    await plain.end()
  }
  const hasBase = BASE_TABLES.some((table) => counts[table] > 0)
  if (!marked && server !== FIRST_SERVER && hasBase && process.env.ALLOW_MIX !== "1") {
    console.error(
      `prepare: the database is not marked as the copy of any Linko account yet, but already holds ` +
        `${BASE_TABLES.map((table) => `${table} ${counts[table]}`).join(", ")}. They are not "${server}"'s (its first import marks ` +
        "the database), and the base steps would write this account's rows under Linko's ids over them. Stopped before " +
        "writing anything (ALLOW_MIX=1 if this database is meant to take them).",
    )
    process.exit(1)
  }
  const client = await connect()
  await client.end()
  const db = await appDatabase()
  console.log(`prepare: Linko account "${server}" (${rawEnv() ?? "backups/linko-raw/<date>"}) → database ${db}; ${BASE_TABLES.map((table) => `${table} ${counts[table]}`).join(", ")}`)
  if (!hasBase) {
    const missing = BASE_LISTS.filter((names) => !names.some((name) => hasRaw(name))).map((names) => `${names.join(" / ")}.json`)
    if (missing.length && process.env.ALLOW_EMPTY_BASE !== "1") {
      console.error(
        `prepare: ${db} has no clients, products or employees yet, and the download lacks ${missing.join(", ")}, from which the ` +
          "base steps (import-base-*.mjs) create them. The other steps attach orders, documents and facts to those rows, so " +
          "this run would leave the copy mostly empty. Stopped before writing anything else (ALLOW_EMPTY_BASE=1 runs it anyway).",
      )
      process.exit(1)
    }
    if (!missing.length) console.log(`prepare: ${db} has no base rows yet: the base steps create them from the download's lists`)
  }
  const [orderItems, incomings, suppliers, employees, branches, vansell] = await Promise.all([
    import("@/lib/order-items-repo"),
    import("@/lib/supplier-incomings-repo"),
    import("@/lib/supplier-balance-repo"),
    import("@/lib/employee-balance-repo"),
    import("@/lib/branch-balance-repo"),
    import("@/lib/vansell-transactions-repo"),
  ])
  await orderItems.listOrderItems(0)
  await incomings.ensureIncomingsSchema()
  await suppliers.listSupplierBalanceTransactions()
  await employees.listEmployeeBalanceTransactions()
  await branches.listBranchBalanceTransactions()
  await vansell.listVansellTransactions()
  console.log("prepare: the app's tables and columns are in place")
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
