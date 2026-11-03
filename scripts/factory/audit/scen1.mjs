// Business scenarios with edge cases: orders vs stock, client balance, payments, cancellation.
import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const show = (label, r) => console.log(label, r.ok ? "OK" : `ERR ${r.status}`, JSON.stringify(r.d).slice(0, 300))

const stockOf = async (productId, warehouse) => {
  const d = await get(`/api/stock/balances?pageSize=0&unit=amount&mode=amount`)
  const row = d.rows.find((r) => r.key === `product:${productId}`)
  const w = row?.stocks.find((s) => s.warehouse === warehouse)
  return { total: w?.total ?? 0, reserved: w?.reserved ?? 0, available: w?.available ?? 0 }
}
const clientBal = async (id) => {
  const d = await get(`/api/balances/client-balance?pageSize=0&from=2020-01-01&to=2030-12-31`)
  return d.rows.find((r) => r.id === id)?.currencies.SUM.end_balance
}
const cashBal = async (id) => (await get("/api/cash/cashboxes")).cashboxes.find((c) => c.id === id).balance

const WH = "Tayyor mahsulot ombori"
const products = rowsOf(await get("/api/products"))
const P = products.find((p) => p.name === "Zilol Cola 1L") ?? products[0]
const client = rowsOf(await get("/api/clients")).find((c) => c.name.startsWith("Orzu do'koni (Mirzo"))
console.log("product", P.id, P.name, "client", client.id, client.name)
const base = { clientId: client.id, warehouse: WH, priceList: "Ulgurji", currency: "SUM", agent: "Aziz Ismoilov", organization: "Zilol Ichimliklar MChJ", paymentType: "cash", dealType: "standard", delivery: "2026-10-31" }

const s0 = await stockOf(P.id, WH)
console.log("stock0", s0, "clientBal0", await clientBal(client.id))

// 1. more than available
show("1 qty>stock", await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: s0.available + 1000, unitPrice: 5000, currency: "SUM" }] }))
// 2. qty 0 / negative / fractional / price negative
show("2a qty0", await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: 0, unitPrice: 5000 }] }))
show("2b qty-5", await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: -5, unitPrice: 5000 }] }))
show("2c price-1", await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: 1, unitPrice: -1 }] }))
show("2d discount150", await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: 1, unitPrice: 5000, discountPercent: 150 }] }))
show("2e no items", await q("POST", "/api/orders", { ...base, items: [] }))
show("2f bad client", await q("POST", "/api/orders", { ...base, clientId: 999999, items: [{ productId: P.id, quantity: 1, unitPrice: 5000 }] }))
show("2g bad product", await q("POST", "/api/orders", { ...base, items: [{ productId: 999999, quantity: 1, unitPrice: 5000 }] }))
show("2h bad warehouse", await q("POST", "/api/orders", { ...base, warehouse: "Yo'q ombor", items: [{ productId: P.id, quantity: 1, unitPrice: 5000 }] }))
show("2i huge price", await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: 1, unitPrice: 1e15 }] }))

// 3. normal order lifecycle
const created = await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: 10, unitPrice: 5000, currency: "SUM" }] })
show("3 create", created)
const oid = created.d?.id
console.log("after create (reserved?)", await stockOf(P.id, WH), "bal", await clientBal(client.id))
show("3b ->В пути", await q("PATCH", `/api/orders/${oid}`, { status: "В пути" }))
console.log("after В пути", await stockOf(P.id, WH), "bal", await clientBal(client.id))
show("3c ->Доставлено", await q("PATCH", `/api/orders/${oid}`, { status: "Доставлено", acceptedDate: "2026-10-31" }))
console.log("after delivered", await stockOf(P.id, WH), "bal", await clientBal(client.id))
// overpay
const cash0 = await cashBal(1)
const cats = rowsOf(await get("/api/income-categories"))
const cat = cats.find((c) => /Buyurtma/.test(c.name))
show("4a pay 0", await q("POST", `/api/cash/orders/${oid}/pay`, { date: "2026-10-31 12:00:00", cashboxId: 1, amount: 0, categoryId: cat.id, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ" }))
show("4b pay -100", await q("POST", `/api/cash/orders/${oid}/pay`, { date: "2026-10-31 12:00:00", cashboxId: 1, amount: -100, categoryId: cat.id, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ" }))
show("4c overpay 10x", await q("POST", `/api/cash/orders/${oid}/pay`, { date: "2026-10-31 12:00:00", cashboxId: 1, amount: 500000, categoryId: cat.id, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ" }))
show("4d pay full", await q("POST", `/api/cash/orders/${oid}/pay`, { date: "2026-10-31 12:00:00", cashboxId: 1, amount: 50000, categoryId: cat.id, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", isVerified: true }))
console.log("cash delta", (await cashBal(1)) - cash0, "bal", await clientBal(client.id))
show("4e pay again (already paid)", await q("POST", `/api/cash/orders/${oid}/pay`, { date: "2026-10-31 12:00:00", cashboxId: 1, amount: 1000, categoryId: cat.id, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", isVerified: true }))
// 5. cancel delivered+paid order
show("5 cancel delivered", await q("PATCH", `/api/orders/${oid}`, { status: "Отменен" }))
console.log("after cancel", await stockOf(P.id, WH), "bal", await clientBal(client.id), "cash", (await cashBal(1)) - cash0)
// 6. delete it
show("6 delete order", await q("DELETE", `/api/orders/${oid}`))
console.log("after delete", await stockOf(P.id, WH), "bal", await clientBal(client.id), "cash", (await cashBal(1)) - cash0)
console.log("ORDER_ID", oid)
