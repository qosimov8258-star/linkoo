// Warehouse / production / cash edge cases.
import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const show = (label, r) => { console.log(label, r.ok ? "OK" : `ERR ${r.status}`, JSON.stringify(r.d).slice(0, 260)); return r }
const balances = async () => (await get(`/api/stock/balances?pageSize=0&unit=amount&mode=amount`)).rows
const st = async (key, wh) => { const r = (await balances()).find((x) => x.key === key); return r?.stocks.find((s) => s.warehouse === wh)?.total ?? 0 }
const cash = async (id) => (await get("/api/cash/cashboxes")).cashboxes.find((c) => c.id === id).balance

const RAW = "Xom ashyo ombori", SHOP = "Ishlab chiqarish sexi", GOODS = "Tayyor mahsulot ombori"
const raws = rowsOf(await get("/api/raw-materials"))
const sugar = raws.find((r) => /Shakar/.test(r.name))
const sk = `raw_material:${sugar.id}`
const s0 = await st(sk, RAW), sh0 = await st(sk, SHOP)
console.log("sugar", sugar.id, sugar.name, "raw", s0, "shop", sh0)

// write-offs
show("W1 writeoff > stock", await q("POST", "/api/write-offs", { warehouse: RAW, date: "2026-10-31", reason: "test", status: "закрыт", items: [{ key: sk, qty: s0 + 1 }] }))
show("W2 writeoff qty -3", await q("POST", "/api/write-offs", { warehouse: RAW, date: "2026-10-31", reason: "test", status: "закрыт", items: [{ key: sk, qty: -3 }] }))
show("W3 writeoff empty", await q("POST", "/api/write-offs", { warehouse: RAW, date: "2026-10-31", reason: "test", status: "закрыт", items: [] }))
show("W4 writeoff future date", await q("POST", "/api/write-offs", { warehouse: RAW, date: "2099-01-01", reason: "test", status: "закрыт", items: [{ key: sk, qty: 1 }] }))
console.log("raw after W*", await st(sk, RAW))

// transfers
show("T1 transfer > stock", await q("POST", "/api/internal-transfers", { fromWarehouse: RAW, toWarehouse: SHOP, createdAt: "2026-10-31 10:00:00", organization: "Zilol Ichimliklar MChJ", autoAccept: true, items: [{ key: sk, quantity: s0 + 1 }] }))
show("T2 transfer same wh", await q("POST", "/api/internal-transfers", { fromWarehouse: RAW, toWarehouse: RAW, createdAt: "2026-10-31 10:00:00", organization: "Zilol Ichimliklar MChJ", autoAccept: true, items: [{ key: sk, quantity: 1 }] }))
show("T3 transfer qty 0", await q("POST", "/api/internal-transfers", { fromWarehouse: RAW, toWarehouse: SHOP, createdAt: "2026-10-31 10:00:00", organization: "Zilol Ichimliklar MChJ", autoAccept: true, items: [{ key: sk, quantity: 0 }] }))
// non-auto transfer: give, then try to spend the goods in transit twice
const t4 = show("T4 transfer manual", await q("POST", "/api/internal-transfers", { fromWarehouse: RAW, toWarehouse: SHOP, createdAt: "2026-10-31 10:00:00", organization: "Zilol Ichimliklar MChJ", autoAccept: false, items: [{ key: sk, quantity: 5 }] }))
const tid = t4.d?.id
show("T4b accept before give", await q("POST", `/api/internal-transfers/${tid}/action`, { action: "accept", date: "2026-10-31" }))
show("T4c give", await q("POST", `/api/internal-transfers/${tid}/action`, { action: "give", date: "2026-10-31" }))
console.log("raw after give", await st(sk, RAW), "shop", await st(sk, SHOP))
show("T4d give again", await q("POST", `/api/internal-transfers/${tid}/action`, { action: "give", date: "2026-10-31" }))
show("T4e delete in transit", await q("DELETE", `/api/internal-transfers/${tid}`))
console.log("raw after del", await st(sk, RAW), "shop", await st(sk, SHOP))
show("T4f accept", await q("POST", `/api/internal-transfers/${tid}/action`, { action: "accept", date: "2026-10-31" }))
show("T4g accept twice", await q("POST", `/api/internal-transfers/${tid}/action`, { action: "accept", date: "2026-10-31" }))
console.log("raw after accept", await st(sk, RAW), "shop", await st(sk, SHOP), "(expect raw", s0 - 5, "shop", sh0 + 5, ")")

// supplier incoming then delete after the goods were moved on
const inc = show("I1 incoming", await q("POST", "/api/supplier-incomings", { supplier: "Shakar Savdo MChJ", warehouse: RAW, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", paymentType: "Наличный", currency: "SUM", date: "2026-10-31", items: [{ key: sk, product: sugar.name, qty: 7, cost: 10000 }] }))
const iid = inc.d?.id
show("I1b incoming qty -1", await q("POST", "/api/supplier-incomings", { supplier: "Shakar Savdo MChJ", warehouse: RAW, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", paymentType: "Наличный", currency: "SUM", date: "2026-10-31", items: [{ key: sk, product: sugar.name, qty: -1, cost: 10000 }] }))
show("I1c incoming cost -1", await q("POST", "/api/supplier-incomings", { supplier: "Shakar Savdo MChJ", warehouse: RAW, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", paymentType: "Наличный", currency: "SUM", date: "2026-10-31", items: [{ key: sk, product: sugar.name, qty: 1, cost: -10000 }] }))
show("I1d unknown supplier", await q("POST", "/api/supplier-incomings", { supplier: "Yo'q MChJ", warehouse: RAW, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", paymentType: "Наличный", currency: "SUM", date: "2026-10-31", items: [{ key: sk, product: sugar.name, qty: 1, cost: 1 }] }))
show("I2 accept", await q("PATCH", `/api/supplier-incomings/${iid}`, { action: "accept", date: "2026-10-31" }))
show("I2b accept twice", await q("PATCH", `/api/supplier-incomings/${iid}`, { action: "accept", date: "2026-10-31" }))
const rawNow = await st(sk, RAW)
console.log("raw after incoming", rawNow)
// move everything away from RAW so that undoing the incoming would go negative
const all = show("I3 move all raw to shop", await q("POST", "/api/internal-transfers", { fromWarehouse: RAW, toWarehouse: SHOP, createdAt: "2026-10-31 11:00:00", organization: "Zilol Ichimliklar MChJ", autoAccept: true, items: [{ key: sk, quantity: rawNow }] }))
show("I4 delete accepted incoming", await q("DELETE", `/api/supplier-incomings/${iid}`))
show("I4b cancel accepted incoming", await q("PATCH", `/api/supplier-incomings/${iid}`, { action: "cancel" }))
console.log("raw after I4", await st(sk, RAW), "(negative = bug)")
// move back
if (all.ok) show("I5 move back", await q("POST", "/api/internal-transfers", { fromWarehouse: SHOP, toWarehouse: RAW, createdAt: "2026-10-31 11:05:00", organization: "Zilol Ichimliklar MChJ", autoAccept: true, items: [{ key: sk, quantity: rawNow }] }))

// cash
const c1 = await cash(1)
show("C1 transfer > balance", await q("POST", "/api/cash/transfers", { fromCashboxId: 1, toCashboxId: 4, amountFrom: c1 + 1_000_000, amountTo: c1 + 1_000_000, date: "2026-10-31 12:00:00" }))
show("C2 transfer same box", await q("POST", "/api/cash/transfers", { fromCashboxId: 1, toCashboxId: 1, amountFrom: 100, amountTo: 100, date: "2026-10-31 12:00:00" }))
show("C3 transfer 0", await q("POST", "/api/cash/transfers", { fromCashboxId: 1, toCashboxId: 4, amountFrom: 0, amountTo: 0, date: "2026-10-31 12:00:00" }))
const cats = rowsOf(await get("/api/expense-categories"))
const office = cats.find((c) => c.name === "Ofis xarajatlari")
show("C4 expense > balance", await q("POST", "/api/cash/operations", { kind: "expense", date: "2026-10-31 12:00:00", cashboxId: 1, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", categoryId: office.id, amount: c1 + 1_000_000, isVerified: true }))
show("C5 expense date bad", await q("POST", "/api/cash/operations", { kind: "expense", date: "31.10.2026", cashboxId: 1, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", categoryId: office.id, amount: 1000, isVerified: true }))
show("C6 expense wrong kind cat", await q("POST", "/api/cash/operations", { kind: "income", date: "2026-10-31 12:00:00", cashboxId: 1, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", categoryId: office.id, amount: 1000, isVerified: true }))
show("C7 USD box SUM amount fraction", await q("POST", "/api/cash/operations", { kind: "expense", date: "2026-10-31 12:00:00", cashboxId: 3, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", categoryId: office.id, amount: 0.001, isVerified: true }))
console.log("cash1 delta", (await cash(1)) - c1)

// production: finish consuming more than the shop floor has
const stage = rowsOf(await get("/api/production/stages"))[0]
const recipes = rowsOf(await get(`/api/production/recipes?stageId=${stage.id}`))
const rec = recipes[0]
const party = show("P1 party", await q("POST", "/api/production/parties", { stageId: stage.id, date: "2026-10-31", comment: "test" }))
const huge = rec.components.map((c) => ({ key: c.key ?? `${c.kind}:${c.itemId}`, amount: c.amount * 1e6 }))
show("P2 finish huge", await q("POST", `/api/production/parties/${party.d.id}/auto-finish`, { recipeId: rec.id, amount: rec.amount * 1e6, comment: "", components: huge }))
show("P3 finish amount 0", await q("POST", `/api/production/parties/${party.d.id}/auto-finish`, { recipeId: rec.id, amount: 0, comment: "", components: [] }))
show("P4 defect > made", await q("POST", `/api/production/parties/${party.d.id}/defects`, { type: "made", key: `product:${rec.itemId}`, amount: 1e9 }))
show("P5 delete party", await q("DELETE", `/api/production/parties/${party.d.id}`))
show("P6 party bad stage", await q("POST", "/api/production/parties", { stageId: 99999, date: "2026-10-31" }))
