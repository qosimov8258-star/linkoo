// Linked-record deletes, duplicates, payroll twice, concurrency. Run on a DB that is restored afterwards.
import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const show = (label, r) => { console.log(label, r.ok ? "OK" : `ERR ${r.status}`, JSON.stringify(r.d).slice(0, 220)); return r }
const first = async (path, pred = () => true) => rowsOf(await get(path)).find(pred)

// --- deletes of records that other documents use
const used = {
  product: [(await first("/api/products", (p) => p.name === "Zilol Cola 1L")).id, "/api/products/"],
  raw: [(await first("/api/raw-materials", (p) => p.name === "Shakar")).id, "/api/raw-materials/"],
  client: [60, "/api/clients/"],
  warehouse: [3, "/api/warehouses/"],
  cashbox: [1, "/api/cashboxes/"],
  supplier: [(await first("/api/suppliers", (s) => /Shakar/.test(s.name))).id, "/api/suppliers/"],
  employee: [(await first("/api/employees", (e) => e.job === "Savdo agenti")).id, "/api/employees/"],
  expenseCat: [(await first("/api/expense-categories", (c) => c.name === "Ofis xarajatlari")).id, "/api/expense-categories/"],
  incomeCat: [(await first("/api/income-categories", (c) => /Buyurtma/.test(c.name))).id, "/api/income-categories/"],
  priceList: [(await first("/api/price-lists?active=all", (c) => c.name === "Ulgurji")).id, "/api/price-lists/"],
  branch: [(await first("/api/branches")).id, "/api/branches/"],
  organization: [(await first("/api/organizations")).id, "/api/organizations/"],
  currencyUSD: [2, "/api/currencies/"],
  currencySUM: [1, "/api/currencies/"],
  productType: [(await first("/api/product-types")).id, "/api/product-types/"],
  brand: [(await first("/api/brands")).id, "/api/brands/"],
  unit: [(await first("/api/units-of-measure")).id, "/api/units-of-measure/"],
  stage: [1, "/api/production/stages/"],
  accessRight: [(await first("/api/access-rights")).id, "/api/access-rights/"],
  workShift: [(await first("/api/work-shifts")).id, "/api/work-shifts/"],
  clientType: [(await first("/api/client-types")).id, "/api/client-types/"],
  supplierCat: [(await first("/api/supplier-categories")).id, "/api/supplier-categories/"],
}
for (const [name, [id, path]] of Object.entries(used)) show(`D ${name} #${id}`, await q("DELETE", path + id))

// --- duplicates
const prod = await get(`/api/products/${used.product[0]}`)
show("U1 product same name", await q("POST", "/api/products", { ...prod, id: undefined, name: prod.name }))
show("U2 product same barcode", await q("POST", "/api/products", { ...prod, id: undefined, name: prod.name + " DUP", article: "DUP-1" }))
show("U3 warehouse same name", await q("POST", "/api/warehouses", { name: "Tayyor mahsulot ombori", branchId: used.branch[0], stockType: "basic", active: true }))
show("U4 cashbox same name", await q("POST", "/api/cashboxes", { name: "Asosiy kassa (naqd)", currency: "SUM", type: "cash" }))
show("U5 expense cat same name", await q("POST", "/api/expense-categories", { name: "Ofis xarajatlari" }))
const cl = await get(`/api/clients/60`)
show("U6 client same phone", await q("POST", "/api/clients", { name: "Dublikat mijoz", phone: cl.phone ?? cl.phoneNumber, type: cl.type, branch: cl.branch }))
const emp = await get(`/api/employees/${used.employee[0]}`)
show("U7 employee same login", await q("POST", "/api/employees", { ...emp, id: undefined, firstName: "Dub", lastName: "Likat", login: emp.login, username: emp.login ?? emp.username, password: "Qwerty-12345-x" }))

// --- payroll twice for the same month
show("S1 salary-records again", await q("POST", "/api/salary-records", { month: 10, year: 2026, currency: "SUM", salaries: [{ userId: used.employee[0], amount: 1000000 }] }))
show("S2 salary-records month 13", await q("POST", "/api/salary-records", { month: 13, year: 2026, currency: "SUM", salaries: [] }))
show("S3 salary negative", await q("POST", "/api/salary-records", { month: 11, year: 2026, currency: "SUM", salaries: [{ userId: used.employee[0], amount: -5 }] }))
