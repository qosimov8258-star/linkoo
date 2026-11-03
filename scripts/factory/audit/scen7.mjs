import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const show = (l, r) => { console.log(l, r.ok ? "OK" : `ERR ${r.status}`, JSON.stringify(r.d).slice(0, 230)); return r }
const W = "Samarqand ombori"
const bal = rowsOf(await get(`/api/stock/inventories/balances?warehouse=${encodeURIComponent(W)}&date=2026-10-31&forDayEnd=1`)).filter((r) => Number(r.qty) > 0)
const row = bal[0]
console.log("row", JSON.stringify(row).slice(0, 200))
show("I1 negative count", await q("POST", "/api/stock/inventories", { type: "custom_date", warehouse: W, invDate: "2026-10-31", forDayEnd: true, items: [{ key: row.key, amount: -5 }] }))
show("I2 future date", await q("POST", "/api/stock/inventories", { type: "custom_date", warehouse: W, invDate: "2027-01-01", forDayEnd: true, items: [{ key: row.key, amount: 1 }] }))
show("I3 unknown item", await q("POST", "/api/stock/inventories", { type: "custom_date", warehouse: W, invDate: "2026-10-31", forDayEnd: true, items: [{ key: "product:99999", amount: 1 }] }))
const inv = show("I4 count -2", await q("POST", "/api/stock/inventories", { type: "custom_date", warehouse: W, invDate: "2026-10-31", forDayEnd: true, items: [{ key: row.key, amount: Number(row.qty) - 2 }] }))
show("I5 confirm", await q("POST", `/api/stock/inventories/${inv.d.id}/confirm`, {}))
show("I6 confirm twice", await q("POST", `/api/stock/inventories/${inv.d.id}/confirm`, {}))
const after = rowsOf(await get(`/api/stock/inventories/balances?warehouse=${encodeURIComponent(W)}&date=2026-10-31&forDayEnd=1`)).find((r) => r.key === row.key)
console.log("qty before", row.qty, "after", after?.qty, "(expect -2)")
show("I7 delete confirmed", await q("DELETE", `/api/stock/inventories/${inv.d.id}`))
// supplier return more than stock
const raw = rowsOf(await get("/api/raw-materials")).find((r) => r.name === "Natriy benzoat")
show("SR1 supplier return > stock", await q("POST", "/api/supplier-returns", { fromWhom: "Kimyo Reagent MChJ", warehouse: "Xom ashyo ombori", organization: "Zilol Ichimliklar MChJ", branch: "Toshkent bosh zavod", currency: "SUM", date: "2026-10-31", items: [{ key: `raw_material:${raw.id}`, product: raw.name, qty: 1e7, price: 1 }] }))
const sr = show("SR2 supplier return 1", await q("POST", "/api/supplier-returns", { fromWhom: "Kimyo Reagent MChJ", warehouse: "Xom ashyo ombori", organization: "Zilol Ichimliklar MChJ", branch: "Toshkent bosh zavod", currency: "SUM", date: "2026-10-31", items: [{ key: `raw_material:${raw.id}`, product: raw.name, qty: 1, price: 1 }] }))
show("SR3 give", await q("PATCH", `/api/supplier-returns/${sr.d.id}`, { action: "give" }))
show("SR4 give twice", await q("PATCH", `/api/supplier-returns/${sr.d.id}`, { action: "give" }))
