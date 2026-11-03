import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const show = (l, r) => { console.log(l, r.ok ? "OK" : `ERR ${r.status}`, JSON.stringify(r.d).slice(0, 230)); return r }
const c = await get("/api/clients/60")
const base = { name: "QA Mijoz", phone: "+998901112233", type: c.type, zone: c.zone, branch: c.branch, agent: c.agent, deliverer: c.deliverer }
show("C1 duplicate name", await q("POST", "/api/clients", { ...base, name: c.name }))
show("C2 duplicate phone", await q("POST", "/api/clients", { ...base, phone: c.phone }))
show("C3 bad gps", await q("POST", "/api/clients", { ...base, name: "QA gps", lat: 999, lng: -999 }))
show("C4 bad phone", await q("POST", "/api/clients", { ...base, name: "QA phone", phone: "12" }))
show("C5 unknown zone", await q("POST", "/api/clients", { ...base, name: "QA zone", zone: "Yo'q zona" }))
show("C6 unknown agent", await q("POST", "/api/clients", { ...base, name: "QA agent", agent: "Yo'q Agent" }))
const zones = rowsOf(await get("/api/clients/zones"))
show("Z1 delete used zone", await q("DELETE", `/api/clients/zones/${zones[0].id}`))
// returns
const orders = rowsOf(await get("/api/orders?pageSize=500"))
const delivered = orders.find((o) => o.status === "Доставлено" && o.clientId === 60)
const undelivered = orders.find((o) => o.status === "Не подтвержден")
const ret = await get(`/api/orders/${delivered.id}/returnable`)
const items = rowsOf(ret.items ?? ret)
const it = items[0]
console.log("returnable", JSON.stringify(it).slice(0, 200))
const rb = (o, extra) => ({ clientId: o.clientId, warehouse: "Qaytgan mahsulot ombori", orderId: o.id, returnDate: "2026-10-31", currency: "SUM", organization: "Zilol Ichimliklar MChJ", accept: true, ...extra })
const maxQ = it.quantity ?? it.returnable ?? it.available
show("R1 return more than sold", await q("POST", "/api/client-returns", rb(delivered, { items: [{ orderItemId: it.orderItemId ?? it.id, quantity: (maxQ ?? 1) + 1000, price: it.price ?? 1 }] })))
show("R2 return of undelivered order", await q("POST", "/api/client-returns", rb(undelivered, { items: [{ productId: 1, quantity: 1, price: 1 }] })))
show("R3 return qty 0", await q("POST", "/api/client-returns", rb(delivered, { items: [{ orderItemId: it.orderItemId ?? it.id, quantity: 0, price: 1 }] })))
show("R4 return of other client's order", await q("POST", "/api/client-returns", { ...rb(delivered, { items: [{ orderItemId: it.orderItemId ?? it.id, quantity: 1, price: 1 }] }), clientId: 1 }))
const r5 = show("R5 return all (ok)", await q("POST", "/api/client-returns", rb(delivered, { items: [{ orderItemId: it.orderItemId ?? it.id, quantity: maxQ, price: it.price ?? it.unitPrice }] })))
show("R6 return again (nothing left)", await q("POST", "/api/client-returns", rb(delivered, { items: [{ orderItemId: it.orderItemId ?? it.id, quantity: 1, price: it.price ?? it.unitPrice }] })))
if (r5.ok) show("R7 delete accepted return", await q("DELETE", `/api/client-returns/${r5.d.id}`))
show("R8 return price higher than sold", await q("POST", "/api/client-returns", rb(orders.find((o) => o.status === "Доставлено" && o.id !== delivered.id), { items: [{ productId: 1, quantity: 1, price: 999999999 }] })))
