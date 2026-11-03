import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const show = (l, r) => { console.log(l, r.ok ? "OK" : `ERR ${r.status}`, JSON.stringify(r.d).slice(0, 230)); return r }
const bal = async (id) => (await get("/api/cash/cashboxes")).cashboxes.find((c) => c.id === id).balance
const inc = rowsOf(await get("/api/income-categories")).find((c) => !/Buyurtma/.test(c.name))
const B = await bal(4)
console.log("box4", B, "income cat", inc.name)
const common = { cashboxId: 4, branch: "Samarqand filiali", organization: "Zilol Ichimliklar MChJ", isVerified: true }
const i1 = show("income 10M", await q("POST", "/api/cash/operations", { ...common, kind: "income", date: "2026-10-31 13:00:00", categoryId: inc.id, amount: 10_000_000 }))
const e1 = show("spend almost all", await q("POST", "/api/cash/operations", { ...common, kind: "expense", date: "2026-10-31 14:00:00", categoryId: 10, amount: B + 10_000_000 - 1000 }))
console.log("box4 now", await bal(4))
const key = i1.d.key
const op = await get(`/api/cash/operations/${key}`)
console.log("op", JSON.stringify(op).slice(0, 300))
show("edit income down to 1M", await q("PUT", `/api/cash/operations/${key}`, { ...op, ...common, kind: "income", date: "2026-10-31 13:00:00", categoryId: inc.id, amount: 1_000_000 }))
console.log("box4 after edit", await bal(4))
show("delete the income", await q("DELETE", `/api/cash/operations/${key}`))
console.log("box4 after delete", await bal(4))
show("move income date after the expense", await q("PUT", `/api/cash/operations/${key}`, { ...op, ...common, kind: "income", date: "2026-10-31 15:00:00", categoryId: inc.id, amount: 10_000_000 }))
console.log("box4 after date move", await bal(4))
// transfer: delete an incoming transfer after the money was spent
const t = show("transfer 5M box1->box4", await q("POST", "/api/cash/transfers", { fromCashboxId: 1, toCashboxId: 4, amountFrom: 5_000_000, amountTo: 5_000_000, date: "2026-10-31 16:00:00" }))
show("spend it", await q("POST", "/api/cash/operations", { ...common, kind: "expense", date: "2026-10-31 16:30:00", categoryId: 10, amount: (await bal(4)) - 100 }))
console.log("transfer", JSON.stringify(t.d).slice(0, 200))
const tkey = t.d?.key ?? (t.d?.id ? `transfer-${t.d.id}` : null)
if (tkey) show("delete transfer", await q("DELETE", `/api/cash/operations/${tkey}`))
console.log("box4 end", await bal(4))
