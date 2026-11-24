// The schema import-base-catalog.mjs writes into, created by the app's own code on the target database (each call
// below creates its tables / columns first and only reads, as the pages do on their first request): the products and
// raw_materials columns with product_images / product_limits (lib/products-schema.ts catalogDb), the dictionaries'
// columns (product_types.position / image, units_of_measure.is_weighted), the price lists' columns, products.box_unit
// (lib/order-items-repo.ts), products.initial_cost (lib/supplier-incomings-repo.ts), «Характеристики» (product_attributes,
// product_attribute_values, product_attribute_assignments), «Продукты конкурентов» (rival_products) and the order
// Excel layouts (order_excel_settings). Run by import-base-catalog.mjs before it writes; on its own:
//
//   node node_modules/tsx/dist/cli.mjs --conditions=react-server --tsconfig tsconfig.json scripts/linko-sync/base-catalog-schema.ts
//   (RAW / TARGET_DB as for every importer: lib.mjs appDatabase() checks the account first)
import { appDatabase } from "./lib.mjs"

async function main() {
  const db = await appDatabase()
  const [catalog, dictionaries, priceLists, orderItems, incomings, attributes, attributeValues, assignments, rivals, excel] = await Promise.all([
    import("@/lib/products-schema"),
    import("@/lib/dictionaries-schema"),
    import("@/lib/price-lists-repo"),
    import("@/lib/order-items-repo"),
    import("@/lib/supplier-incomings-repo"),
    import("@/lib/product-attributes-repo"),
    import("@/lib/product-attribute-values-repo"),
    import("@/lib/product-attribute-assignments-repo"),
    import("@/lib/rival-products-repo"),
    import("@/lib/order-excel-repo"),
  ])
  await catalog.catalogDb()
  await dictionaries.dictionariesDb()
  await priceLists.ensurePriceListsSchema()
  await orderItems.listOrderItems(0)
  await incomings.ensureIncomingsSchema()
  await attributes.listProductAttributes()
  await attributeValues.listProductAttributeValues()
  await assignments.getProductAttributeAssignments(0)
  await rivals.listRivalProducts()
  await excel.listOrderExcelSettings("")
  console.log(`base catalog schema: the app's catalog tables and columns are in place in ${db}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
