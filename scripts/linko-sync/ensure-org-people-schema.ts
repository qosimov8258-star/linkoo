// The tables and columns import-base-org-people.mjs writes into that the app creates lazily, on the first use of their
// page (a new account's database may not have them yet), created with the app's own code: the employees columns
// (access right, job, branch / organization ids, details) and users.employee_id, Филиалы, the Склады columns,
// Должности, the rate tables, Транспорт, Смены and the Подписки tables. Each call creates its tables first and then
// only reads. Two of them also do what the app does on a first use: Должности writes the default positions of a new
// company into an EMPTY table (import-base-org-people.mjs then replaces them with Linko's), and the rate tables drop
// the rates of a currency that does not exist (none yet on a new copy: the rates come later, import-finance-contracts).
// The bootstraps of lib/db.ts (currencies, organizations, warehouses, employees, capabilities, permissions,
// access_rights …) run with the first of them. The default roles (Права доступа) are not called: they would be written
// into a database without any access right, and Linko's own replace them anyway.
//
// import-base-org-people.mjs runs this file first (tsx, server-only modules allowed):
//   node node_modules/tsx/dist/cli.mjs --conditions=react-server --tsconfig tsconfig.json scripts/linko-sync/ensure-org-people-schema.ts
//   (RAW / TARGET_DB as for every importer)
import { appDatabase, filesServer } from "./lib.mjs"

async function main() {
  const db = await appDatabase()
  const [users, employees, branches, warehouses, jobs, rates, transport, shifts, billing] = await Promise.all([
    import("@/lib/auth-employee"),
    import("@/lib/employees-schema"),
    import("@/lib/branches-repo"),
    import("@/lib/warehouses-repo"),
    import("@/lib/job-positions-repo"),
    import("@/lib/currency-rates-repo"),
    import("@/lib/transport-repo"),
    import("@/lib/work-shifts-repo"),
    import("@/lib/subscriptions-repo"),
  ])
  await users.ensureUserEmployeeLink()
  await employees.ensureEmployeesSchema()
  await branches.listBranches()
  await warehouses.ensureWarehousesSchema()
  await jobs.ensureJobPositionsSchema()
  await rates.ensureRatesSchema()
  await transport.listTransport()
  await shifts.ensureWorkShiftsSchema()
  await billing.getBillingSummary()
  console.log(`org-people schema: the app's tables and columns are in place in ${db} (Linko account "${filesServer()}")`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
