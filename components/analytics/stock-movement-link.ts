/** «Движение товаров» of one item, as Linko's Остаток / Материальный отчет open it
 * (#/stock-receives/product-move?pageSize=25&product=176[&fromDate&toDate]); the page reads the bare id as the
 * item key "product:176" (stock-plan-state.ts). */
export function movementLink(itemKey: string, period?: { from: string; to: string }): string {
  const params = new URLSearchParams({ tab: "movement", pageSize: "25", product: itemKey.replace(/^product:(\d+)$/, "$1") })
  if (period?.from) params.set("fromDate", period.from)
  if (period?.to) params.set("toDate", period.to)
  return `/analytics/receipt-transfer-plan?${params.toString()}`
}
