// Concurrency: parallel orders for the last units, parallel payments, parallel transfers, double submit.
import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const WH = "Tayyor mahsulot ombori"
const bal = async (key) => (await get(`/api/stock/balances?pageSize=0&unit=amount&mode=amount`)).rows.find((r) => r.key === key)?.stocks.find((s) => s.warehouse === WH) ?? {}
const P = rowsOf(await get("/api/products")).find((p) => p.name === "Zilol Cola 1L")
const b0 = await bal(`product:${P.id}`)
console.log("before", b0)
const base = { clientId: 60, warehouse: WH, priceList: "Ulgurji", currency: "SUM", agent: "Aziz Ismoilov", organization: "Zilol Ichimliklar MChJ", paymentType: "cash", dealType: "standard", delivery: "2026-10-31" }
// What an order may still take: on hand minus the reservations of CONFIRMED orders. The balance
// row's `available` also subtracts the unconfirmed («Не подтвержден») orders, which show as
// reserved but block nothing, so it can be far lower (even negative) than what is really free.
// The server names the true figure when it refuses an order that asks for too much.
const probe = await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: 1e9, unitPrice: 5000 }] })
const free = probe.d?.shortage?.[0]?.available ?? b0.available
console.log("free for a confirmed order:", free, "(shown as available:", b0.available, ")")
const qty = Math.ceil(free * 0.6)
const res = await Promise.all(Array.from({ length: 5 }, () => q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: qty, unitPrice: 5000 }] })))
console.log("5 parallel orders of", qty, "→", res.map((r) => (r.ok ? `OK#${r.d.id}` : r.status)).join(" "))
console.log("after", await bal(`product:${P.id}`))
const okIds = res.filter((r) => r.ok).map((r) => r.d.id)
// ship it, then parallel payments of 60% each
const id = okIds[0]
await q("PATCH", `/api/orders/${id}`, { status: "В пути" })
await q("PATCH", `/api/orders/${id}`, { status: "Доставлено", acceptedDate: "2026-10-31" })
const total = qty * 5000
const cat = rowsOf(await get("/api/income-categories")).find((c) => /Buyurtma/.test(c.name))
const pays = await Promise.all(Array.from({ length: 4 }, () => q("POST", `/api/cash/orders/${id}/pay`, { date: "2026-10-31 12:00:00", cashboxId: 1, amount: Math.round(total * 0.6), categoryId: cat.id, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", isVerified: true })))
console.log("4 parallel payments of 60% →", pays.map((r) => (r.ok ? "OK" : r.status + " " + r.d?.error)).join(" | "))
const o = rowsOf(await get(`/api/orders?pageSize=50`)).find((r) => r.id === id)
console.log("order paid", o?.paidAmount, "of", o?.totalPrice, "rest", o?.payableRest)
// parallel transfers of the whole remaining stock
const probe2 = await q("POST", "/api/orders", { ...base, items: [{ productId: P.id, quantity: 1e9, unitPrice: 5000 }] })
const left = probe2.d?.shortage?.[0]?.available ?? (await bal(`product:${P.id}`)).available
const tr = await Promise.all(Array.from({ length: 3 }, () => q("POST", "/api/internal-transfers", { fromWarehouse: WH, toWarehouse: "Samarqand ombori", createdAt: "2026-10-31 13:00:00", organization: "Zilol Ichimliklar MChJ", autoAccept: true, items: [{ key: `product:${P.id}`, quantity: left }] })))
console.log("3 parallel transfers of all", left, "→", tr.map((r) => (r.ok ? "OK" : r.status)).join(" "))
console.log("final", await bal(`product:${P.id}`))
// cash: parallel expenses that together exceed the balance
const cb = (await get("/api/cash/cashboxes")).cashboxes.find((c) => c.id === 4)
const ex = await Promise.all(Array.from({ length: 3 }, () => q("POST", "/api/cash/operations", { kind: "expense", date: "2026-10-31 12:00:00", cashboxId: 4, branch: "Samarqand filiali", organization: "Zilol Ichimliklar MChJ", categoryId: 10, amount: Math.round(cb.balance * 0.6), isVerified: true })))
console.log("3 parallel expenses of 60% of", cb.balance, "→", ex.map((r) => (r.ok ? "OK" : r.status)).join(" "), "balance now", (await get("/api/cash/cashboxes")).cashboxes.find((c) => c.id === 4).balance)
