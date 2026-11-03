#!/usr/bin/env node
// Factory simulation: builds a working soft-drink plant in the LOCAL factory instance
// (scripts/factory/dev.sh → http://localhost:3001, database linko_factory) through the
// app's own API, the same calls its pages make, then runs a month of day-to-day work.
//
//   node scripts/factory/simulate.mjs            # every phase, in order
//   node scripts/factory/simulate.mjs setup staff  # chosen phases only
//
// Phases are idempotent where the API allows it (dictionaries are found by name first),
// so a run can be repeated after a fix. Failed calls are listed at the end.

import { del, ensure, failures, get, log, login, post, put, rowsOf } from "./api.mjs"
import * as D from "./data.mjs"
import { ledger, runClosing, runMonth, stats } from "./month.mjs"

const R = D.rng()
const state = {}

async function capabilities() {
  const permissions = (await get("/api/permissions")).permissions ?? []
  const byCode = new Map(permissions.map((row) => [row.code, row.id]))
  const groups = {
    "Агент": ["orders.manage", "clients.manage", "payments.manage"],
    "Доставщик": ["orders.manage", "payments.manage"],
    "Кассир": ["cash.manage", "payments.manage"],
    "Бухгалтер": ["finance.manage", "payments.manage", "cash.manage", "reports.manage"],
    "Завсклад": ["stock.manage", "procurement.manage", "catalog.manage"],
    "Производство": ["production.manage", "stock.manage", "catalog.manage"],
    "Снабжение": ["procurement.manage", "catalog.manage"],
    "Руководитель": [...byCode.keys()],
  }
  const result = {}
  for (const [name, codes] of Object.entries(groups)) {
    const permissionIds = codes.map((code) => byCode.get(code)).filter(Boolean)
    if (permissionIds.length !== codes.length) throw new Error(`unknown permission codes in ${name}: ${codes}`)
    const found = rowsOf(await get("/api/capabilities")).find((row) => row.name === name)
    // An existing group gets its permissions (again): an access right without them grants nothing.
    result[name] = found ? await put(`/api/capabilities/${found.id}`, { name, permissionIds }) : await post("/api/capabilities", { name, permissionIds })
  }
  return result
}

async function setup() {
  log("setup: currencies, organization, branches, dictionaries")
  for (const currency of D.CURRENCIES) await ensure("/api/currencies", "/api/currencies", currency.name, currency)
  for (const name of [D.COMPANY.organization, D.COMPANY.tradeOrganization]) {
    await ensure("/api/organizations", "/api/organizations", name, { name, limitByDebt: false })
  }
  for (const list of D.PRICE_LISTS) await ensure("/api/price-lists?active=all", "/api/price-lists", list.name, { ...list, isActive: true })
  await ensure("/api/branches", "/api/branches", D.COMPANY.mainBranch, {
    name: D.COMPANY.mainBranch, priceList: "Ulgurji", currency: "SUM", debtTracking: true, isMain: true, locationLat: 41.2995, locationLng: 69.2401,
  })
  await ensure("/api/branches", "/api/branches", D.COMPANY.branch2, {
    name: D.COMPANY.branch2, priceList: "Ulgurji", currency: "SUM", debtTracking: true, isMain: false, locationLat: 39.6542, locationLng: 66.9597,
  })
  for (const unit of D.UNITS) await ensure("/api/units-of-measure", "/api/units-of-measure", unit.name, unit)
  for (const type of D.PRODUCT_TYPES) {
    const parent = await ensure("/api/product-types", "/api/product-types", type.name, { name: type.name, organization: D.COMPANY.organization, showInBot: true })
    for (const child of type.children) {
      await ensure("/api/product-types", "/api/product-types", child, { name: child, organization: D.COMPANY.organization, parentId: parent.id, showInBot: true })
    }
  }
  for (const name of D.BRANDS) await ensure("/api/brands", "/api/brands", name, { name, organization: D.COMPANY.organization })
  for (const shift of D.WORK_SHIFTS) await ensure("/api/work-shifts", "/api/work-shifts", shift.name, shift)
  for (const category of D.EXPENSE_CATEGORIES) await ensure("/api/expense-categories", "/api/expense-categories", category.name, category)
  for (const category of D.INCOME_CATEGORIES) await ensure("/api/income-categories", "/api/income-categories", category.name, category)
  for (const name of D.CLIENT_TYPES) await ensure("/api/client-types", "/api/client-types", name, { name })
  for (const zone of D.ZONES) await ensure("/api/clients/zones", "/api/clients/zones", zone.name, zone)
  for (const name of D.SUPPLIER_CATEGORIES) await ensure("/api/supplier-categories", "/api/supplier-categories", name, { name })
  for (const job of D.JOBS) await ensure("/api/job-positions", "/api/job-positions", job.name, { name: job.name })

  const caps = await capabilities()
  const rights = {
    "Rahbariyat": ["Руководитель"],
    "Hisobchi": ["Бухгалтер"],
    "Kassir": ["Кассир"],
    "Ishlab chiqarish": ["Производство"],
    "Omborchi": ["Завсклад"],
    "Yetkazib beruvchi": ["Доставщик"],
    "Savdo agenti": ["Агент"],
    "Supervayzer": ["Агент"],
    "Ta'minot": ["Снабжение"],
  }
  for (const [name, groups] of Object.entries(rights)) {
    await ensure("/api/access-rights", "/api/access-rights", name, { name, capabilityIds: groups.map((group) => caps[group].id) })
  }
}

const usedNames = new Set()

/** A unique Uzbek first + last name (orders and cash pick employees by name). */
function personName(index) {
  for (;;) {
    const female = R.chance(0.22)
    const first = female ? R.pick(D.FEMALE_NAMES) : R.pick(D.MALE_NAMES)
    let last = R.pick(D.LAST_NAMES)
    if (female) last = last.endsWith("v") ? `${last}a` : last
    if (usedNames.has(`${first} ${last}`)) continue
    usedNames.add(`${first} ${last}`)
    return { first, last, female, index }
  }
}

async function refs() {
  const [branches, organizations, jobs, rights, warehouses, priceLists, cashboxes] = await Promise.all([
    get("/api/branches"), get("/api/organizations"), get("/api/job-positions"), get("/api/access-rights"),
    get("/api/warehouses?active=all"), get("/api/price-lists?active=all"), get("/api/cashboxes"),
  ])
  const byName = (rows) => new Map(rowsOf(rows).map((row) => [row.name, row]))
  return {
    branches: byName(branches), organizations: byName(organizations), jobs: byName(jobs), rights: byName(rights),
    warehouses: byName(warehouses), priceLists: byName(priceLists), cashboxes: byName(cashboxes),
  }
}

async function staff() {
  log("staff: 100 employees")
  const ref = await refs()
  const main = ref.branches.get(D.COMPANY.mainBranch).id
  const second = ref.branches.get(D.COMPANY.branch2).id
  const org = ref.organizations.get(D.COMPANY.organization).id
  const existing = rowsOf(await get("/api/employees"))
  const existingPhones = new Set(existing.map((row) => String(row.phone ?? "").replace(/\D/g, "")))
  let index = 0
  let created = 0
  for (const job of D.JOBS) {
    for (let n = 0; n < job.count; n++, index++) {
      const person = personName(index)
      const phone = `+99890${String(1000000 + index * 7919).slice(-7)}`
      if (existingPhones.has(phone.replace(/\D/g, ""))) continue
      const inSamarkand = job.branch === "both" && n % 2 === 1
      const body = {
        firstName: person.first,
        lastName: person.last,
        phone,
        jobId: ref.jobs.get(job.name).id,
        branchIds: [inSamarkand ? second : main],
        organizationIds: [org],
        showInTracking: ["Savdo agenti", "Haydovchi-yetkazib beruvchi", "Supervayzer"].includes(job.name),
        gpsCheck: ["Savdo agenti", "Haydovchi-yetkazib beruvchi"].includes(job.name),
      }
      if (job.login) {
        body.systemAccess = true
        body.login = `${person.first}.${person.last}${index}`.toLowerCase().replace(/[^a-z0-9._-]/g, "")
        body.password = `Zilol-${2026 + index}-xodim`
        body.accessRightId = ref.rights.get(job.access).id
      }
      await post("/api/employees", body)
      created++
    }
  }
  log(`staff: ${created} created`)
}

/** Employees of one job, in creation order. */
async function employeesOf(jobName) {
  return rowsOf(await get("/api/employees")).filter((row) => row.job === jobName)
}

export const WAREHOUSES = {
  raw: "Xom ashyo ombori",
  shop: "Ishlab chiqarish sexi",
  goods: "Tayyor mahsulot ombori",
  samarkand: "Samarqand ombori",
  returns: "Qaytgan mahsulot ombori",
}

async function catalog() {
  log("catalog: warehouses, cashboxes, suppliers, raw materials, products")
  const ref = await refs()
  const main = ref.branches.get(D.COMPANY.mainBranch).id
  const second = ref.branches.get(D.COMPANY.branch2).id
  const keepers = await employeesOf("Omborchi")
  const productionHead = (await employeesOf("Ishlab chiqarish boshlig'i"))[0]
  const warehouses = [
    { name: WAREHOUSES.raw, branchId: main, managerId: keepers[0].id, stockType: "basic", address: "Toshkent, Bektemir, Zavod ko'chasi 1 (A blok)", trackMinAmount: true },
    { name: WAREHOUSES.shop, branchId: main, managerId: productionHead.id, stockType: "manufacturing", address: "Toshkent, Bektemir, Zavod ko'chasi 1 (sex)" },
    { name: WAREHOUSES.goods, branchId: main, managerId: keepers[2].id, stockType: "basic", address: "Toshkent, Bektemir, Zavod ko'chasi 1 (B blok)", online: true, trackMinAmount: true },
    { name: WAREHOUSES.samarkand, branchId: second, managerId: keepers[1].id, stockType: "basic", address: "Samarqand, Registon ko'chasi 45", online: true },
    { name: WAREHOUSES.returns, branchId: main, managerId: keepers[0].id, stockType: "basic", address: "Toshkent, Bektemir, Zavod ko'chasi 1 (C blok)", forReturn: true },
  ]
  for (const warehouse of warehouses) await ensure("/api/warehouses?active=all", "/api/warehouses", warehouse.name, { ...warehouse, active: true })

  const cashiers = await employeesOf("Kassir")
  const cashboxes = [
    { name: "Asosiy kassa (naqd)", currency: "SUM", cashierId: cashiers[0].id, branchId: main, paymentType: "cash", orderNumber: 1 },
    { name: "Bank hisobi (Kapitalbank)", currency: "SUM", cashierId: cashiers[0].id, branchId: main, paymentType: "bank", orderNumber: 2 },
    { name: "Valyuta kassa (USD)", currency: "USD", cashierId: cashiers[0].id, branchId: main, paymentType: "cash", orderNumber: 3 },
    { name: "Samarqand kassa", currency: "SUM", cashierId: cashiers[1].id, branchId: second, paymentType: "cash", orderNumber: 4 },
  ]
  for (const cashbox of cashboxes) await ensure("/api/cashboxes", "/api/cashboxes", cashbox.name, cashbox)

  for (const supplier of D.SUPPLIERS) {
    await ensure("/api/suppliers", "/api/suppliers", supplier.name, {
      name: supplier.name,
      category: supplier.category,
      address: supplier.address,
      branch: D.COMPANY.mainBranch,
      organization: D.COMPANY.organization,
      contacts: [{ name: "Menejer", phone: supplier.phone, email: "" }],
    })
  }

  const rawRows = rowsOf(await get("/api/raw-materials"))
  for (const [index, [name, subcategory, unit, supplier, cost]] of D.RAW_MATERIALS.entries()) {
    if (rawRows.some((row) => row.name === name)) continue
    await post("/api/raw-materials", {
      name,
      type: "Xom ashyo",
      subcategory,
      unit,
      supplier,
      organization: D.COMPANY.organization,
      article: `XA-${String(index + 1).padStart(3, "0")}`,
      minStock: unit === "kg" ? 200 : 20000,
      canSell: false,
      description: `Taxminiy narx ${cost} so'm / ${unit}`,
    })
  }

  const productRows = rowsOf(await get("/api/products"))
  for (const [index, [name, type, subcategory, brand, perBox, wholesale, retail, dealer, barcode]] of D.PRODUCTS.entries()) {
    if (productRows.some((row) => row.name === name)) continue
    const litres = Number((name.match(/([\d,]+)L/)?.[1] ?? "1").replace(",", "."))
    await post("/api/products", {
      name,
      fullName: `${name} (PET)`,
      type,
      subcategory,
      brand,
      unit: "dona",
      boxUnit: perBox > 1 ? "blok" : "",
      boxAmount: perBox > 1 ? perBox : 0,
      organization: D.COMPANY.organization,
      barcodes: [barcode],
      article: `ZL-${String(index + 1).padStart(3, "0")}`,
      orderNumber: String(index + 1),
      weight: Math.round(litres * 1.04 * 1000) / 1000,
      volume: litres,
      minStock: 500,
      vat: "12",
      canSell: true,
      showInBot: true,
      trackExpiry: true,
      expirationDays: type === "Sharbatlar" ? 270 : 365,
      priceLists: [
        { name: "Ulgurji", cash: wholesale, nonCash: Math.round(wholesale * 1.05), min: 0, max: 0, currency: "SUM", nonCashCurrency: "SUM" },
        { name: "Chakana", cash: retail, nonCash: Math.round(retail * 1.05), min: 0, max: 0, currency: "SUM", nonCashCurrency: "SUM" },
        { name: "Diler", cash: dealer, nonCash: Math.round(dealer * 1.05), min: 0, max: 0, currency: "SUM", nonCashCurrency: "SUM" },
      ],
    })
  }
}

export const STAGE = "PET quyish liniyasi"

/** Components of one bottle (raw material name → amount per 1 dona). */
export function recipeOf(productName) {
  const litres = Number((productName.match(/([\d,]+)L/)?.[1] ?? "1").replace(",", "."))
  const preform = litres <= 0.5 ? "PET preforma 18g (0,5L)" : litres <= 1 ? "PET preforma 28g (1L)" : litres <= 1.5 ? "PET preforma 38g (1,5L)" : "PET preforma 85g (5L)"
  const cap = litres >= 5 ? "Qopqoq 48mm (5L)" : "Qopqoq 28mm"
  const label = productName.startsWith("Bahor") ? "Etiketka Bahor" : productName.startsWith("Toza") ? "Etiketka Toza Suv" : "Etiketka Zilol"
  const parts = { [preform]: 1, [cap]: 1, [label]: 1 }
  if (litres < 5) parts["Termo plyonka"] = Math.round(litres * 0.002 * 10000) / 10000
  const add = (name, perLitre) => (parts[name] = Math.round(perLitre * litres * 100000) / 100000)
  if (productName.includes("Cola")) {
    add("Shakar", 0.1)
    add("Cola konsentrati", 0.004)
    add("CO2 gazi", 0.008)
  } else if (productName.includes("Zilol Apelsin")) {
    add("Shakar", 0.09)
    add("Apelsin konsentrati", 0.012)
    add("CO2 gazi", 0.008)
    add("Limon kislotasi", 0.002)
  } else if (productName.includes("Zilol Limon")) {
    add("Shakar", 0.09)
    add("Limon kislotasi", 0.004)
    add("CO2 gazi", 0.008)
  } else if (productName.includes("nektari")) {
    add(productName.includes("Olma") ? "Olma konsentrati" : productName.includes("Apelsin") ? "Apelsin konsentrati" : "Shaftoli pyuresi", 0.15)
    add("Shakar", 0.06)
    add("Limon kislotasi", 0.002)
    add("Natriy benzoat", 0.0004)
  } else if (productName.includes("100%")) {
    add("Olma konsentrati", 0.25)
  } else if (productName.includes("gazli")) {
    add("CO2 gazi", 0.006)
  }
  return parts
}

async function production() {
  log("production: stage, equipment, operations, staff, recipes")
  const head = (await employeesOf("Ishlab chiqarish boshlig'i"))[0]
  const stages = rowsOf(await get("/api/production/stages"))
  const stage = stages.find((row) => row.name === STAGE) ?? (await post("/api/production/stages", { name: STAGE, warehouse: WAREHOUSES.shop, responsible: `${head.firstName} ${head.lastName}`, responsibleId: head.id }))
  const machines = ["Preforma puflash mashinasi", "Quyish-qopqoqlash bloki", "Etiketlash mashinasi", "Termo-paketlash mashinasi"]
  const equipment = rowsOf(await get(`/api/production/equipment?stageId=${stage.id}`))
  for (const name of machines) {
    if (!equipment.some((row) => row.name === name)) equipment.push(await post("/api/production/equipment", { stageId: stage.id, name }))
  }
  const operations = rowsOf(await get(`/api/production/operations?stageId=${stage.id}`))
  const steps = [["Preformani puflash", 4, machines[0]], ["Quyish va qopqoqlash", 3, machines[1]], ["Etiketka yopishtirish", 2, machines[2]], ["Sifat nazorati", 5, null], ["Blokka paketlash", 3, machines[3]]]
  for (const [title, duration, machine] of steps) {
    if (operations.some((row) => row.title === title)) continue
    const equipmentId = machine ? equipment.find((row) => row.name === machine).id : null
    await post("/api/production/operations", { stageId: stage.id, title, duration, type: machine ? "equipment" : "human", equipmentId })
  }
  const staffRows = rowsOf(await get(`/api/production/staff?stageId=${stage.id}`))
  const workers = [...(await employeesOf("Smena boshlig'i")), ...(await employeesOf("Liniya operatori")).slice(0, 12)]
  for (const [index, worker] of workers.entries()) {
    if (staffRows.some((row) => row.employeeId === worker.id)) continue
    const day = index % 2 === 0
    await post("/api/production/staff", {
      stageId: stage.id,
      employeeId: worker.id,
      employeeName: `${worker.firstName} ${worker.lastName}`,
      position: worker.job,
      shift: day ? "1-smena (kunduzgi)" : "2-smena (tungi)",
      beginTime: day ? "08:00" : "20:00",
      endTime: day ? "20:00" : "08:00",
    })
  }
  const raws = new Map(rowsOf(await get("/api/raw-materials")).map((row) => [row.name, row.id]))
  const recipes = rowsOf(await get(`/api/production/recipes?stageId=${stage.id}`))
  for (const product of rowsOf(await get("/api/products"))) {
    if (product.name.includes("19L") || recipes.some((row) => row.itemId === product.id && row.kind === "product")) continue
    const components = Object.entries(recipeOf(product.name)).map(([name, amount]) => {
      if (!raws.has(name)) throw new Error(`raw material missing: ${name}`)
      return { role: "raw", key: `raw_material:${raws.get(name)}`, amount }
    })
    await post("/api/production/recipes", { stageId: stage.id, key: `product:${product.id}`, equipmentId: equipment.find((row) => row.name === machines[1]).id, amount: 1, components })
  }
}

const fullName = (employee) => `${employee.firstName} ${employee.lastName}`

async function clients() {
  log("clients: 60 shops, supermarkets, dealers and cafes")
  const ref = await refs()
  const second = ref.branches.get(D.COMPANY.branch2).id
  const agents = await employeesOf("Savdo agenti")
  const drivers = await employeesOf("Haydovchi-yetkazib beruvchi")
  const inBranch = (rows, samarkand) => rows.filter((row) => row.branchIds.includes(second) === samarkand)
  const existing = new Set(rowsOf(await get("/api/clients")).map((row) => row.name))
  const usedNames = new Set(existing)
  for (let index = 0; index < 60; index++) {
    const zone = D.ZONES[index % D.ZONES.length]
    const samarkand = zone.branch === D.COMPANY.branch2
    const type = index % 12 === 0 ? "Diler" : index % 7 === 0 ? "Supermarket" : index % 5 === 0 ? "Kafe va restoran" : index % 17 === 0 ? "Ulgurji baza" : "Do'kon"
    const prefix = { "Do'kon": "", Supermarket: "Supermarket ", Diler: "Diler ", "Kafe va restoran": "Kafe ", "Ulgurji baza": "Ulgurji baza " }[type]
    let name
    do name = `${prefix}${R.pick(D.SHOP_WORDS)}${type === "Do'kon" ? " do'koni" : ""} (${zone.name})`
    while (usedNames.has(name) && !existing.has(name) && (name = `${name} ${index}`) && usedNames.has(name))
    if (existing.has(name)) continue
    usedNames.add(name)
    const agent = R.pick(inBranch(agents, samarkand))
    const driver = R.pick(inBranch(drivers, samarkand))
    const [lat, lng] = samarkand ? [39.65 + R.next() * 0.05, 66.93 + R.next() * 0.07] : [41.25 + R.next() * 0.1, 69.18 + R.next() * 0.15]
    await post("/api/clients", {
      name,
      phone: `+99893${String(2000000 + index * 104729).slice(-7)}`,
      type,
      zone: zone.name,
      branch: zone.branch,
      agent: fullName(agent),
      zoneAgent: fullName(agent),
      deliverer: fullName(driver),
      address: `${samarkand ? "Samarqand" : "Toshkent"}, ${R.pick(D.STREETS)} ko'chasi ${R.int(1, 120)}`,
      contactPerson: `${R.pick(D.MALE_NAMES)} aka`,
      inn: type === "Do'kon" ? "" : String(300000000 + index * 7331),
      locationLat: Math.round(lat * 1e6) / 1e6,
      locationLng: Math.round(lng * 1e6) / 1e6,
      note: type === "Diler" ? "Diler shartnomasi asosida, 7 kunlik muddatli to'lov" : "",
    })
  }
}

async function month() {
  log("month: October 2026, day by day")
  state.month = await runMonth({ W: WAREHOUSES, STAGE })
  log("month stats:", JSON.stringify(stats))
}

/** Compares the app's stock balances with the simulation's own ledger (after `month`). */
async function verify() {
  log("verify: stock balances vs. the simulation ledger")
  const data = await get("/api/stock/balances?pageSize=0&unit=amount&mode=amount")
  const rows = rowsOf(data)
  if (!rows.length) {
    log("verify: no stock rows returned", JSON.stringify(data).slice(0, 300))
    return
  }
  log(`verify: ${rows.length} stock rows`)
  if (!ledger.size) return log("verify: no ledger in this run (run month and verify together)")
  // App: per warehouse total / reserved / defects. Ledger: good units leave at "Есть на складе"
  // (reserved), defective units are kept under "defect:<key>".
  const app = new Map()
  for (const row of rows) {
    for (const cell of row.stocks ?? []) {
      app.set(`${cell.warehouse}|${row.key}`, Number(cell.total) - Number(cell.reserved) - Number(cell.defects))
      if (Number(cell.defects)) app.set(`${cell.warehouse}|defect:${row.key}`, Number(cell.defects))
    }
  }
  const mine = new Map()
  for (const [warehouse, items] of ledger) for (const [key, qty] of items) if (Math.abs(qty) > 1e-6) mine.set(`${warehouse}|${key}`, qty)
  let diffs = 0
  for (const cell of new Set([...app.keys(), ...mine.keys()])) {
    const a = Math.round((app.get(cell) ?? 0) * 1000) / 1000
    const b = Math.round((mine.get(cell) ?? 0) * 1000) / 1000
    if (Math.abs(a - b) > 0.001) {
      diffs++
      if (diffs <= 40) log(`  stock diff ${cell}: app ${a}, simulation ${b}`)
    }
  }
  log(diffs ? `verify: ${diffs} stock cells differ` : `verify: all ${mine.size} stock cells match the simulation ledger`)
  if (diffs) failures.push(`stock: ${diffs} cells differ from the simulation ledger`)
}

async function closing() {
  log("closing: payroll and month-end stock count")
  state.closing = await runClosing({ W: WAREHOUSES })
}

const PHASES = { setup, staff, catalog, production, clients, month, verify, closing }

async function main() {
  const wanted = process.argv.slice(2)
  const phases = wanted.length ? wanted : Object.keys(PHASES)
  const me = await login()
  log(`signed in as ${me.username}`)
  for (const phase of phases) {
    if (!PHASES[phase]) throw new Error(`unknown phase ${phase}`)
    try {
      await PHASES[phase]()
    } catch (error) {
      log(`phase ${phase} stopped: ${error.message}`)
    }
  }
  if (failures.length) {
    console.log(`\n${failures.length} failed call(s):`)
    for (const failure of failures) console.log(" -", failure)
    process.exitCode = 1
  } else log("done, no failed calls")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

export { state, del, put }
