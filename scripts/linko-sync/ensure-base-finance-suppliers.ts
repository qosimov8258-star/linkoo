// Run by import-base-finance-suppliers.mjs before it writes: the app's own code creates the tables and columns of that
// step which the app makes on first use (a page or an API call) — cashboxes.cashier_id, the categories' `options` column
// and its trigger (the cash core schema), doc_templates, notification_templates with their subscribers table (an empty
// table gets the platform's templates, as on a first page open), refusal_types with its unique name index. Currencies,
// cashboxes, suppliers and supplier_categories are created by the app's bootstrap (lib/db.ts) before the first query.
// Each call below only creates its schema and reads.
//
//   node node_modules/tsx/dist/cli.mjs --conditions=react-server --tsconfig tsconfig.json scripts/linko-sync/ensure-base-finance-suppliers.ts
//   (RAW / TARGET_DB as for every importer)
import { appDatabase } from "./lib.mjs"

async function main() {
  const db = await appDatabase()
  const [cashboxes, categories, docTemplates, notificationTemplates, refusalTypes] = await Promise.all([
    import("@/lib/cashboxes-repo"),
    import("@/lib/categories-common"),
    import("@/lib/doc-templates-repo"),
    import("@/lib/notification-templates-repo"),
    import("@/lib/refusal-types-repo"),
  ])
  await cashboxes.ensureCashboxesSchema()
  await categories.ensureCategorySchema()
  await docTemplates.listDocTemplates({ search: "", ordering: "", page: 1, pageSize: 1 })
  await notificationTemplates.listNotificationTemplates("", 1, 1)
  await refusalTypes.listRefusalTypes()
  console.log(`ensure: ${db}: the app's cashbox, category, document template, notification template and refusal type tables are in place`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
