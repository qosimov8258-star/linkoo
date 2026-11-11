// Конструктор отчетов: what its reports read and the earlier importers left out, so the same report gives the
// same numbers as in Linko —
//   - the saved reports of the old builder (main/report_config) into old_saved_reports, by Linko id, as the settings
//     the page opens (a model key, field ids, filters, the period, the view);
//   - the products' weight of a unit, units in a block, sequence number and code;
//   - the price-list price each order line was sold against (order_items.list_price = Linko's price − its
//     difference from the price list), the source of «Разница.Пр-лист» and «Цена по прайс листу»;
//   - the reason and the «при доставке» mark of the client returns;
//   - the creation moment of the orders as the app keeps it: UTC (the first copy kept Linko's local clock, which
//     moved an order made after 19:00 to the next day in every report by creation date).
//
//   node scripts/linko-sync/import-report-details.mjs      (raw files: report_configs, products, orders,
//                                                           orders_detail, order_returns)
import { bumpSequence, connect, ensureRegistry, raw, register, runId, upsertById, utcIso } from "./lib.mjs"

const run = runId("report-details")
const client = await connect()
await ensureRegistry(client)
const stats = { reports: { insert: 0, update: 0, same: 0 }, products: 0, listPrices: 0, returns: 0, orderMoments: 0 }
const utcText = (local) => (local ? utcIso(local).slice(0, 19).replace("T", " ") : null)
const VIEW = { line: 0, pie: 1, bar: 2, histogram: 2 }
const TABLE_VIEW = 3

/** The settings Linko saved for a report, in the form the old builder's page saves and opens (version 2). */
function reportConfig(report) {
  const code = report.code ?? {}
  const groups = Array.isArray(code.group_by) ? code.group_by : []
  const ids = (type) => groups.filter((item) => item.type === type).map((item) => item.field_name)
  const filters = {}
  const compare = []
  let from = ""
  let to = ""
  for (const filter of Array.isArray(code.filter) ? code.filter : []) {
    const field = typeof filter.field_name === "object" ? filter.field_name?.value : filter.field_name
    if (field === "created_date") {
      if (filter.operation === "greater_than") from = String(filter.value ?? "").slice(0, 10)
      if (filter.operation === "less_than") to = String(filter.value ?? "").slice(0, 10)
    } else if (Array.isArray(filter.valueIsArray) && filter.valueIsArray.length) {
      // A select of «Быстрый фильтр»: the chosen entries by their names.
      filters[field] = filter.valueIsArray.map((item) => String(item.text ?? "").trim()).filter(Boolean)
    } else if (field && filter.value !== undefined && filter.value !== null && String(filter.value) !== "") {
      const op = { equal: "contains", not_equal: "not_equal", greater_than: "gt", less_than: "lt", greater_than_or_equal: "gte", less_than_or_equal: "lte", exclude: "exclude" }[filter.operation] ?? "contains"
      compare.push({ field, op, value: String(filter.value) })
    }
  }
  const optimization = code.optimization ?? {}
  const chart = Array.isArray(code.charts) ? code.charts[0] : null
  return {
    v: 2,
    model: code.model?.key ?? "",
    modelName: code.model?.name ?? "",
    columns: (Array.isArray(code.select) ? code.select : []).filter((item) => !item.type).map((item) => item.field_name),
    vertical: ids("vertical"),
    horizontal: ids("horizontal"),
    filters,
    compare,
    options: {
      formatted: optimization.with_number_format !== false,
      totalsRight: optimization.with_total_right !== false,
      totalsBottom: optimization.with_total_bottom !== false,
      merge: optimization.with_merge_cells === true,
      activeFilter: false,
    },
    ...(from && to ? { from, to } : {}),
    view: chart ? (VIEW[chart.typeChart] ?? TABLE_VIEW) : TABLE_VIEW,
    type: report.report_type === "widget" ? "widget" : "table",
  }
}

try {
  await client.query("BEGIN")

  // --- saved reports -------------------------------------------------------------------------------------
  await client.query(`CREATE TABLE IF NOT EXISTS old_saved_reports (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
  )`)
  for (const report of raw("report_configs")) {
    stats.reports[await upsertById(client, run, "old_saved_reports", report.id, { name: String(report.name ?? "").trim() || `№${report.id}`, config: JSON.stringify(reportConfig(report)) })]++
  }
  await bumpSequence(client, "old_saved_reports")

  // --- products: weight, block, sequence number, code -------------------------------------------------------
  const products = new Map((await client.query("SELECT id, weight, box_amount, order_number, integration_code FROM products")).rows.map((row) => [row.id, row]))
  for (const product of raw("products")) {
    const current = products.get(product.id)
    if (!current) continue
    const patch = {}
    const kg = Number(product.kg_value) || 0
    if (kg > 0 && (parseFloat(String(current.weight ?? "").replace(",", ".")) || 0) !== kg) patch.weight = String(kg)
    const box = Number(product.boxes?.[0]?.amount) || 0
    if (box > 0 && Number(current.box_amount) !== box) patch.box_amount = box
    const number = product.stock_number === null || product.stock_number === undefined ? "" : String(product.stock_number)
    if (number && String(current.order_number ?? "") !== number) patch.order_number = number
    const codeText = String(product.code ?? "").trim()
    if (codeText && String(current.integration_code ?? "") !== codeText) patch.integration_code = codeText
    const columns = Object.keys(patch)
    if (!columns.length) continue
    await client.query(`UPDATE products SET ${columns.map((column, index) => `${column} = $${index + 2}`).join(", ")} WHERE id = $1`, [product.id, ...columns.map((column) => patch[column])])
    await register(client, run, "products", product.id, "update", Object.fromEntries(columns.map((column) => [column, current[column]])))
    stats.products++
  }

  // --- order lines: the price-list price; orders: the creation moment in UTC ------------------------------------
  await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS list_price DOUBLE PRECISION")
  const details = raw("orders_detail")
  for (const order of Object.values(details)) {
    const lines = (await client.query("SELECT id, product_id, quantity, list_price FROM order_items WHERE order_id = $1 ORDER BY id", [order.id])).rows
    const used = new Set()
    for (const product of [...(order.products ?? [])].sort((a, b) => a.id - b.id)) {
      const quantity = Number(product.amount)
      const line =
        lines.find((item) => !used.has(item.id) && item.product_id === product.product?.id && Math.abs(item.quantity - quantity) < 1e-6) ??
        lines.find((item) => !used.has(item.id) && item.product_id === product.product?.id)
      if (!line) continue
      used.add(line.id)
      const listPrice = Math.round(((Number(product.price) || 0) - (Number(product.difference_price) || 0)) * 1e9) / 1e9
      if (line.list_price !== null && Math.abs(line.list_price - listPrice) < 1e-9) continue
      await client.query("UPDATE order_items SET list_price = $2 WHERE id = $1", [line.id, listPrice])
      stats.listPrices++
    }
  }
  if (stats.listPrices) await register(client, run, "order_items", "list_price", "update", { lines: stats.listPrices })
  const moments = new Map((await client.query("SELECT id, created_at FROM orders")).rows.map((row) => [row.id, row.created_at]))
  for (const order of raw("orders")) {
    const wanted = utcText(order.created_date)
    const current = moments.get(order.id)
    if (!wanted || current === undefined || current === wanted) continue
    await client.query("UPDATE orders SET created_at = $2 WHERE id = $1", [order.id, wanted])
    await register(client, run, "orders", order.id, "update", { created_at: current })
    stats.orderMoments++
  }

  // --- client returns: reason, «при доставке» --------------------------------------------------------------------
  await client.query("ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS on_delivery INTEGER NOT NULL DEFAULT 0")
  for (const item of raw("order_returns")) {
    const reason = String(item.reason ?? "").trim()
    const onDelivery = item.is_return_on_delivery ? 1 : 0
    const changed = await client.query("UPDATE client_returns SET reason = $2, on_delivery = $3 WHERE id = $1 AND (reason <> $2 OR on_delivery <> $3)", [item.id, reason, onDelivery])
    stats.returns += changed.rowCount
  }
  if (stats.returns) await register(client, run, "client_returns", "reason", "update", { rows: stats.returns })

  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
