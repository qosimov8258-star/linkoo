// One month (October 2026) of the factory's day-to-day work, day by day, through the API:
// raw material purchases and supplier payments, transfers to the shop floor, production
// batches, finished goods to the warehouses, client orders through every status, client
// payments, returns, write-offs, expenses, cash transfers, salary advance and payroll,
// and the month-end stock count. A local ledger mirrors every stock movement, so the
// app's own balances can be checked against it at the end (verify phase).

import { failures, get, log, patch, post, rowsOf } from "./api.mjs"
import * as D from "./data.mjs"

const R = D.rng(777)
const YEAR = 2026
const MONTH = 10
const LAST_DAY = Number(process.env.FACTORY_DAYS) || 30
const day = (n) => `${YEAR}-${String(MONTH).padStart(2, "0")}-${String(n).padStart(2, "0")}`
const weekday = (n) => new Date(Date.UTC(YEAR, MONTH - 1, n)).getUTCDay() // 0 = Sunday
const time = (hour, minute = R.int(0, 59)) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`

/** Local mirror of stock: warehouse → item key → quantity. */
export const ledger = new Map()
const stock = (warehouse, key) => ledger.get(warehouse)?.get(key) ?? 0
function move(warehouse, key, qty) {
  if (!ledger.has(warehouse)) ledger.set(warehouse, new Map())
  const map = ledger.get(warehouse)
  map.set(key, Math.round(((map.get(key) ?? 0) + qty) * 1e6) / 1e6)
}

export const stats = { incomings: 0, transfers: 0, parties: 0, defects: 0, orders: 0, delivered: 0, cancelled: 0, payments: 0, returns: 0, writeOffs: 0, expenses: 0, supplierPayments: 0, cashTransfers: 0 }

/** Runs one business step; a failure is recorded (api.mjs) and the month goes on. */
async function step(label, fn) {
  try {
    return await fn()
  } catch (error) {
    log(`  ✗ ${label}: ${error.message.slice(0, 300)}`)
    return undefined
  }
}

export async function runMonth(ctx) {
  const { W, STAGE } = ctx
  const byName = (rows) => new Map(rowsOf(rows).map((row) => [row.name, row]))
  const raws = byName(await get("/api/raw-materials"))
  const products = byName(await get("/api/products"))
  const suppliers = byName(await get("/api/suppliers"))
  const cashboxes = byName(await get("/api/cashboxes"))
  const expenseCats = byName(await get("/api/expense-categories"))
  const incomeCats = byName(await get("/api/income-categories"))
  const employees = rowsOf(await get("/api/employees"))
  const clients = rowsOf(await get("/api/clients"))
  const stage = rowsOf(await get("/api/production/stages")).find((row) => row.name === STAGE)
  const recipes = rowsOf(await get(`/api/production/recipes?stageId=${stage.id}`))
  const branches = byName(await get("/api/branches"))
  const samarkandBranch = branches.get(D.COMPANY.branch2)

  const rawKey = (name) => `raw_material:${raws.get(name).id}`
  const productKey = (name) => `product:${products.get(name).id}`
  const rawInfo = new Map(D.RAW_MATERIALS.map(([name, , unit, supplier, cost]) => [name, { unit, supplier, cost }]))
  const productInfo = new Map(D.PRODUCTS.map(([name, type, sub, brand, perBox, wholesale, retail, dealer]) => [name, { type, perBox, prices: { Ulgurji: wholesale, Chakana: retail, Diler: dealer } }]))
  const recipeFor = (productName) => recipes.find((row) => row.itemId === products.get(productName).id && row.kind === "product")
  const job = (name) => employees.filter((row) => row.job === name)
  const name = (employee) => `${employee.firstName} ${employee.lastName}`
  const cash = cashboxes.get("Asosiy kassa (naqd)")
  const bank = cashboxes.get("Bank hisobi (Kapitalbank)")
  const usd = cashboxes.get("Valyuta kassa (USD)")
  const samCash = cashboxes.get("Samarqand kassa")
  const USD_RATE = 12850
  const isUsdSupplier = (supplier) => supplier === "Anadolu Concentrate"

  // ---- purchasing ------------------------------------------------------------
  const supplierDebt = new Map() // supplier → [{ supplyId, amount, currency }]

  async function purchase(date, supplierName, lines, comment) {
    const usdSupplier = isUsdSupplier(supplierName)
    const items = lines.map(([rawName, qty]) => {
      const cost = usdSupplier ? Math.round((rawInfo.get(rawName).cost / USD_RATE) * 100) / 100 : rawInfo.get(rawName).cost
      return { key: rawKey(rawName), product: rawName, qty, cost }
    })
    const incoming = await step(`kirim ${supplierName}`, () =>
      post("/api/supplier-incomings", {
        supplier: supplierName,
        warehouse: W.raw,
        branch: D.COMPANY.mainBranch,
        organization: D.COMPANY.organization,
        paymentType: usdSupplier ? "Наличный" : "Банковский счет",
        currency: usdSupplier ? "USD" : "SUM",
        date,
        invoiceNumber: `F-${date.replaceAll("-", "").slice(2)}-${R.int(100, 999)}`,
        invoiceDate: date,
        contractNumber: `${supplierName.split(" ")[0].toUpperCase()}-2026/01`,
        comment,
        items,
      }),
    )
    if (!incoming) return
    const accepted = await step(`kirimni qabul qilish #${incoming.id}`, () => patch(`/api/supplier-incomings/${incoming.id}`, { action: "accept", date }))
    if (!accepted) return
    stats.incomings++
    for (const item of items) move(W.raw, item.key, item.qty)
    const total = items.reduce((sum, item) => sum + item.qty * item.cost, 0)
    if (!supplierDebt.has(supplierName)) supplierDebt.set(supplierName, [])
    supplierDebt.get(supplierName).push({ supplyId: incoming.id, amount: Math.round(total * 100) / 100, currency: usdSupplier ? "USD" : "SUM" })
    return incoming
  }

  async function paySupplier(date, supplierName, share) {
    const debts = supplierDebt.get(supplierName) ?? []
    for (const debt of debts) {
      if (debt.amount <= 0.01) continue
      let amount = Math.round(debt.amount * share * 100) / 100
      const usdDebt = debt.currency === "USD"
      // Never more than the bank account can spare (a 100 mln reserve stays for wages and taxes).
      const bankNow = Number((await get("/api/cash/cashboxes")).cashboxes.find((row) => row.id === bank.id)?.balance ?? 0)
      const spare = bankNow - 100_000_000
      if (!usdDebt) amount = Math.min(amount, Math.floor(spare))
      if (amount <= 0 || (usdDebt && spare < 0)) continue
      if (usdDebt) {
        // The currency desk buys dollars from the bank account when it runs short.
        const desk = (await get("/api/cash/cashboxes")).cashboxes.find((row) => row.id === usd.id)
        const balance = Number(desk?.balance ?? NaN)
        if (!Number.isFinite(balance) || balance < amount) {
          const buy = Math.ceil((amount + 5000) / 1000) * 1000
          await step("dollar sotib olish", () => post("/api/cash/transfers", { fromCashboxId: bank.id, toCashboxId: usd.id, amountFrom: buy * USD_RATE, amountTo: buy, rate: USD_RATE, date: `${date} ${time(14)}`, comment: "Yetkazib beruvchiga to'lov uchun valyuta" }))
        }
      }
      const ok = await step(`to'lov ${supplierName}`, () =>
        post("/api/cash/operations", {
          kind: "expense",
          date: `${date} ${time(15)}`,
          cashboxId: usdDebt ? usd.id : bank.id,
          branch: D.COMPANY.mainBranch,
          organization: D.COMPANY.organization,
          categoryId: expenseCats.get("Yetkazib beruvchiga to'lov").id,
          supplierId: suppliers.get(supplierName).id,
          supplyId: debt.supplyId,
          amount,
          comment: `Poставка №${debt.supplyId} uchun to'lov`,
          isVerified: true,
        }),
      )
      if (ok) {
        debt.amount -= amount
        stats.supplierPayments++
      }
    }
  }

  // ---- warehouse transfers -----------------------------------------------------
  let transferNo = 0
  async function transfer(date, from, to, lines, { auto = true, driver = "", comment = "" } = {}) {
    const items = lines.filter(([, qty]) => qty > 0).map(([key, qty]) => ({ key, quantity: qty }))
    if (!items.length) return
    const created = await step(`ko'chirish ${from} → ${to}`, () =>
      post("/api/internal-transfers", {
        fromWarehouse: from,
        toWarehouse: to,
        createdAt: `${date} ${time(auto ? 7 : 9)}`,
        organization: D.COMPANY.organization,
        invoiceNumber: `K-${++transferNo}`,
        transportNumber: driver ? `01 ${R.int(100, 999)} ${["AAA", "BKA", "SMA"][R.int(0, 2)]}` : "",
        driver,
        comment,
        autoAccept: auto,
        items,
      }),
    )
    if (!created) return
    if (!auto) {
      for (const action of ["give", "accept"]) {
        const done = await step(`ko'chirish #${created.id} ${action}`, () => post(`/api/internal-transfers/${created.id}/action`, { action, date }))
        if (!done) return
      }
    }
    stats.transfers++
    for (const item of items) {
      move(from, item.key, -item.quantity)
      move(to, item.key, item.quantity)
    }
    return created
  }

  // ---- production ----------------------------------------------------------------
  const productNames = D.PRODUCTS.map((row) => row[0])
  const demandWeight = (productName) => (productName.includes("Cola") ? 3 : productName.includes("Toza Suv") ? 2.5 : productName.includes("nektari") ? 1.5 : 1)

  function pickProducts(count) {
    // Lowest finished stock relative to demand first (both sales warehouses).
    return [...productNames]
      .map((productName) => ({ productName, score: (stock(W.goods, productKey(productName)) + stock(W.samarkand, productKey(productName))) / demandWeight(productName) + R.next() * 500 }))
      .sort((a, b) => a.score - b.score)
      .slice(0, count)
      .map((row) => row.productName)
  }

  async function ensureShopRaw(date, needs) {
    const toMove = []
    for (const [key, need] of needs) {
      const have = stock(W.shop, key)
      if (have >= need) continue
      const want = Math.ceil((need * 3 - have) * 1000) / 1000
      const rawName = [...raws.keys()].find((rawName) => rawKey(rawName) === key)
      if (stock(W.raw, key) < want) {
        // Purchase on demand (the supplier delivers the same day): about a week of this material.
        const info = rawInfo.get(rawName)
        const qty = Math.ceil(Math.max(want * 6, info.unit === "kg" ? 100 : 10000))
        await purchase(date, info.supplier, [[rawName, qty]], `Ombor qoldig'i kamaydi: ${rawName}`)
      }
      toMove.push([key, Math.min(want, stock(W.raw, key))])
    }
    if (toMove.length) await transfer(date, W.raw, W.shop, toMove, { comment: "Sexga xom ashyo berish" })
  }

  async function produce(date, productName, amount, withDefect) {
    const recipe = recipeFor(productName)
    const components = recipe.components.map((component) => ({ key: component.key ?? `${component.kind}:${component.itemId}`, amount: Math.round(component.amount * (amount / recipe.amount) * 100000) / 100000 }))
    await ensureShopRaw(date, components.map((component) => [component.key, component.amount]))
    const party = await step(`partiya ${productName}`, () => post("/api/production/parties", { stageId: stage.id, date, comment: `${productName} — ${amount} dona` }))
    if (!party) return 0
    let good = amount
    if (withDefect) {
      const defect = Math.max(1, Math.round(amount * 0.006))
      const ok = await step(`brak ${productName}`, () => post(`/api/production/parties/${party.id}/defects`, { type: "made", key: productKey(productName), amount: defect, comment: "Etiketka qiyshiq / qopqoq yopilmagan" }))
      if (ok) {
        stats.defects++
        move(W.shop, `defect:${productKey(productName)}`, defect)
      }
    }
    const finished = await step(`partiyani yakunlash #${party.id}`, () => post(`/api/production/parties/${party.id}/auto-finish`, { recipeId: recipe.id, amount: good, comment: "", components }))
    if (!finished) return 0
    stats.parties++
    for (const component of components) move(W.shop, component.key, -component.amount)
    move(W.shop, productKey(productName), good)
    return good
  }

  // ---- sales -------------------------------------------------------------------------
  const orders = [] // { id, date, total, client, delivered, paid, samarkand, items }
  const agentsByName = new Map(job("Savdo agenti").map((row) => [name(row), row]))
  const priceListOf = (client) => (client.type === "Diler" || client.type === "Ulgurji baza" ? "Diler" : client.type === "Kafe va restoran" ? "Chakana" : "Ulgurji")

  async function createOrder(date, client, finalStatus) {
    const samarkand = client.branch === D.COMPANY.branch2
    const warehouse = samarkand ? W.samarkand : W.goods
    const priceList = priceListOf(client)
    const lines = []
    const count = client.type === "Diler" || client.type === "Ulgurji baza" ? R.int(5, 9) : R.int(2, 6)
    for (const productName of [...productNames].sort(() => R.next() - 0.5).slice(0, count)) {
      const info = productInfo.get(productName)
      const bloks = client.type === "Diler" || client.type === "Ulgurji baza" ? R.int(60, 160) : client.type === "Supermarket" ? R.int(20, 50) : client.type === "Kafe va restoran" ? R.int(4, 12) : R.int(6, 20)
      const qty = Math.min(bloks * info.perBox, Math.floor(stock(warehouse, productKey(productName)) * 0.5))
      if (qty < info.perBox) continue
      const units = Math.floor(qty / info.perBox) * info.perBox
      lines.push({ productId: products.get(productName).id, productName, quantity: units, unitPrice: info.prices[priceList], discountPercent: client.type === "Diler" ? 3 : 0, currency: "SUM" })
    }
    if (!lines.length) return null
    const agent = agentsByName.get(client.agent) ? client.agent : name(R.pick(job("Savdo agenti")))
    const created = await step(`buyurtma ${client.name}`, () =>
      post("/api/orders", {
        // The agent's order waits for the operator's confirmation (without a status it is reserved at once).
        status: "Не подтвержден",
        clientId: client.id,
        warehouse,
        priceList,
        currency: "SUM",
        agent,
        deliveryMan: client.deliverer,
        organization: D.COMPANY.organization,
        paymentType: client.type === "Diler" ? "bank" : "cash",
        dealType: "standard",
        delivery: date,
        comment: R.chance(0.2) ? "Ertalab soat 10 gacha yetkazish" : "",
        items: lines.map(({ productName: _productName, ...line }) => line),
      }),
    )
    if (!created) return null
    stats.orders++
    await step(`buyurtma #${created.id} sanasi`, () => patch(`/api/orders/${created.id}`, { createdAt: `${date} ${time(R.int(8, 12))}` }))
    const order = { id: created.id, date, client, samarkand, warehouse, lines, total: Number(created.amount ?? 0), status: "Не подтвержден", paid: 0 }
    orders.push(order)
    // An unconfirmed order already reserves its goods (shown as reserved, as in Linko): they leave the free stock now.
    for (const line of lines) move(warehouse, productKey(line.productName), -line.quantity)
    const path = { "Не подтвержден": [], "Есть на складе": ["Есть на складе"], "В пути": ["Есть на складе", "В пути"], "Доставлено": ["Есть на складе", "В пути", "Доставлено"], "Отменен": ["Отменен"] }[finalStatus]
    for (const status of path) {
      const body = { status }
      if (status === "Доставлено") body.acceptedDate = date
      const ok = await step(`buyurtma #${created.id} → ${status}`, () => patch(`/api/orders/${created.id}`, body))
      if (!ok) break
      order.status = status
      // Cancelling the unconfirmed order frees its reservation.
      if (status === "Отменен") {
        stats.cancelled++
        for (const line of lines) move(warehouse, productKey(line.productName), line.quantity)
      }
      if (status === "Доставлено") stats.delivered++
    }
    const fresh = await step(`buyurtma #${created.id} o'qish`, () => get(`/api/orders/${created.id}`))
    if (fresh) order.total = Number(String(fresh.amount ?? fresh.total ?? order.total).replace(/[^\d.,-]/g, "").replace(",", ".")) || order.total
    return order
  }

  async function payOrder(date, order, share, cashbox) {
    const cashboxId = cashbox.id
    // What the cash desk still accepts for the order (a return lowers it).
    const fresh = await step(`buyurtma #${order.id} qoldig'i`, () => get(`/api/orders/${order.id}`))
    const rest = Number(fresh?.payableRest ?? order.total - order.paid)
    const amount = Math.min(Math.round(order.total * share), Math.floor(rest))
    if (amount <= 0) return
    const ok = await step(`to'lov buyurtma #${order.id}`, () =>
      post(`/api/cash/orders/${order.id}/pay`, {
        date: `${date} ${time(R.int(13, 19))}`,
        cashboxId,
        amount,
        categoryId: incomeCats.get("Buyurtma bo'yicha to'lov").id,
        // A payment belongs to its cash desk's branch (the bank account is the head office's).
        branch: cashbox === samCash ? D.COMPANY.branch2 : D.COMPANY.mainBranch,
        organization: D.COMPANY.organization,
        comment: share < 1 ? "Qisman to'lov" : "",
        isVerified: true,
      }),
    )
    if (ok) {
      order.paid += amount
      stats.payments++
    }
  }

  async function returnGoods(date, order) {
    const line = R.pick(order.lines)
    const qty = Math.max(1, Math.round(line.quantity * (0.05 + R.next() * 0.1)))
    const fresh = await step(`buyurtma #${order.id} qatorlari`, () => get(`/api/orders/${order.id}/returnable`))
    const returnable = rowsOf(fresh?.items ?? fresh)
    const item = returnable.find((row) => row.productId === line.productId || row.productName === line.productName)
    const ret = await step(`qaytarish buyurtma #${order.id}`, () =>
      post("/api/client-returns", {
        clientId: order.client.id,
        warehouse: W.returns,
        orderId: order.id,
        returnDate: date,
        currency: "SUM",
        deliverer: order.client.deliverer,
        agent: order.client.agent,
        organization: D.COMPANY.organization,
        comment: R.pick(["Muddati yaqin", "Shikastlangan qadoq", "Mijoz ortiqcha olgan", "Sotilmay qoldi"]),
        items: [{ ...(item?.orderItemId || item?.id ? { orderItemId: item.orderItemId ?? item.id } : { productId: line.productId }), quantity: qty, price: line.unitPrice }],
        accept: true,
      }),
    )
    if (!ret) return
    stats.returns++
    move(W.returns, productKey(line.productName), qty)
  }

  async function expense(date, category, amount, cashbox, comment, extra = {}) {
    const ok = await step(`xarajat ${category}`, () =>
      post("/api/cash/operations", {
        kind: "expense",
        date: `${date} ${time(R.int(10, 17))}`,
        cashboxId: cashbox.id,
        branch: cashbox === samCash ? D.COMPANY.branch2 : D.COMPANY.mainBranch,
        organization: D.COMPANY.organization,
        categoryId: expenseCats.get(category).id,
        amount,
        comment,
        isVerified: true,
        ...extra,
      }),
    )
    if (ok) stats.expenses++
    return ok
  }

  // =====================================================================================
  for (let n = 1; n <= LAST_DAY; n++) {
    const date = day(n)
    const dow = weekday(n)
    log(`— ${date} (${["yak", "dush", "sesh", "chor", "pay", "jum", "shan"][dow]})`)

    if (n === 1) {
      await step("ta'sischi investitsiyasi", () =>
        post("/api/cash/operations", { kind: "income", date: `${date} 09:00:00`, cashboxId: bank.id, branch: D.COMPANY.mainBranch, organization: D.COMPANY.organization, categoryId: incomeCats.get("Ta'sischi investitsiyasi").id, amount: 2_500_000_000, comment: "Ustav kapitaliga hissa", isVerified: true }),
      )
      await step("kassaga naqd pul", () =>
        post("/api/cash/transfers", { fromCashboxId: bank.id, toCashboxId: cash.id, amountFrom: 150_000_000, amountTo: 150_000_000, date: `${date} 09:30:00`, comment: "Bankdan naqd pul yechish" }),
      )
      await step("dollar sotib olish", () =>
        post("/api/cash/transfers", { fromCashboxId: bank.id, toCashboxId: usd.id, amountFrom: 25_000 * USD_RATE, amountTo: 25_000, rate: USD_RATE, date: `${date} 09:40:00`, comment: "Konsentrat uchun valyuta" }),
      )
      await step("Samarqand kassasiga", () =>
        post("/api/cash/transfers", { fromCashboxId: cash.id, toCashboxId: samCash.id, amountFrom: 20_000_000, amountTo: 20_000_000, date: `${date} 10:00:00`, comment: "Filial kassasini to'ldirish" }),
      )
      // Opening purchases: a month of every material.
      const opening = {
        "Preform Plast MChJ": [["PET preforma 18g (0,5L)", 150000], ["PET preforma 28g (1L)", 100000], ["PET preforma 38g (1,5L)", 120000], ["PET preforma 85g (5L)", 10000]],
        "Qopqoq Invest MChJ": [["Qopqoq 28mm", 380000], ["Qopqoq 48mm (5L)", 10000]],
        "Etiketka Print MChJ": [["Etiketka Zilol", 200000], ["Etiketka Bahor", 80000], ["Etiketka Toza Suv", 120000]],
        "Karton Box Servis": [["Termo plyonka", 900], ["Karton quti (Tetra 1L x12)", 500]],
        "Shakar Savdo MChJ": [["Shakar", 20000]],
        "Anadolu Concentrate": [["Cola konsentrati", 600], ["Apelsin konsentrati", 500], ["Olma konsentrati", 4000], ["Shaftoli pyuresi", 1200]],
        "Kimyo Reagent MChJ": [["Limon kislotasi", 500], ["Natriy benzoat", 40]],
        "Uzbek CO2 Gaz": [["CO2 gazi", 2000]],
      }
      for (const [supplierName, lines] of Object.entries(opening)) await purchase(date, supplierName, lines, "Oy boshidagi asosiy xarid")
      for (const supplierName of Object.keys(opening)) await paySupplier(date, supplierName, 0.5)
    }

    // Supplier payments (Wednesday); materials are bought on demand (ensureShopRaw).
    if (dow === 3) for (const supplierName of supplierDebt.keys()) await paySupplier(date, supplierName, 0.6)

    // Production (Monday–Saturday): three batches, one in five with a few spoiled bottles.
    if (dow !== 0) {
      for (const productName of pickProducts(4)) {
        const amount = productName.includes("5L") ? R.int(50, 150) * 10 : productName.includes("nektari") || productName.includes("100%") ? R.int(150, 400) * 10 : R.int(300, 900) * 10
        await produce(date, productName, amount, R.chance(0.2))
      }
      // Finished goods leave the shop floor for the finished goods warehouse.
      const made = productNames.map((productName) => [productKey(productName), stock(W.shop, productKey(productName))])
      await transfer(date, W.shop, W.goods, made, { comment: "Tayyor mahsulotni omborga topshirish" })
    }

    // Samarkand branch: goods by truck on Mondays and Thursdays (approve → give → accept).
    if ((dow === 1 || dow === 4) && n > 1) {
      const lines = productNames.map((productName) => [productKey(productName), Math.floor(stock(W.goods, productKey(productName)) * 0.25 / productInfo.get(productName).perBox) * productInfo.get(productName).perBox])
      const drivers = job("Haydovchi-yetkazib beruvchi").filter((row) => row.branchIds.includes(samarkandBranch.id))
      await transfer(date, W.goods, W.samarkand, lines, { auto: false, driver: name(R.pick(drivers)), comment: "Samarqand filialiga yuk" })
    }

    // Orders (Monday–Saturday).
    if (dow !== 0 && n > 1) {
      const count = R.int(16, 24)
      for (let i = 0; i < count; i++) {
        const client = R.pick(clients)
        const late = n >= LAST_DAY - 1
        const finalStatus = R.chance(0.04) ? "Отменен" : late ? R.pick(["Не подтвержден", "Есть на складе", "В пути", "Доставлено"]) : "Доставлено"
        const order = await createOrder(date, client, finalStatus)
        if (!order || order.status !== "Доставлено") continue
        // Shops and cafes pay the driver on delivery (some only part); dealers pay by bank later.
        if (client.type !== "Diler" && client.type !== "Ulgurji baza") {
          const roll = R.next()
          const share = roll < 0.7 ? 1 : roll < 0.9 ? 0.5 : 0
          if (share) await payOrder(date, order, share, order.samarkand ? samCash : cash)
        }
      }
      // Dealers settle orders delivered a week ago by bank transfer.
      for (const order of orders) {
        if (order.status !== "Доставлено" || order.paid >= order.total - 1) continue
        const age = n - Number(order.date.slice(8, 10))
        const dealer = order.client.type === "Diler" || order.client.type === "Ulgurji baza"
        if ((dealer && age === 7) || (!dealer && age === 5 && R.chance(0.6))) await payOrder(date, order, (order.total - order.paid) / order.total, dealer ? bank : order.samarkand ? samCash : cash)
      }
    }

    // Returns: about three a week from orders delivered two or more days ago.
    if (dow !== 0 && R.chance(0.5)) {
      const candidates = orders.filter((order) => order.status === "Доставлено" && Number(order.date.slice(8, 10)) <= n - 2 && !order.samarkand)
      if (candidates.length) await returnGoods(date, R.pick(candidates))
    }

    // Saturday: write off the spoiled returns and the shop floor's brak; cash to the bank.
    if (dow === 6) {
      const spoiled = productNames.map((productName) => [productKey(productName), Math.floor(stock(W.returns, productKey(productName)) * 0.6)]).filter(([, qty]) => qty > 0)
      if (spoiled.length) {
        const ok = await step("hisobdan chiqarish (qaytgan)", () =>
          post("/api/write-offs", { warehouse: W.returns, date, reason: "Yaroqsiz (qaytgan mahsulot)", comment: "Haftalik ko'rik natijasi", status: "закрыт", items: spoiled.map(([key, qty]) => ({ key, qty })) }),
        )
        if (ok) {
          stats.writeOffs++
          for (const [key, qty] of spoiled) move(W.returns, key, -qty)
        }
      }
      const brak = productNames.map((productName) => [productKey(productName), stock(W.shop, `defect:${productKey(productName)}`)]).filter(([, qty]) => qty > 0)
      if (brak.length) {
        const ok = await step("hisobdan chiqarish (brak)", () =>
          post("/api/write-offs", { warehouse: W.shop, date, reason: "Ishlab chiqarish braki", comment: "Sex braki", status: "закрыт", items: brak.map(([key, qty]) => ({ key, qty, defect: true })) }),
        )
        if (ok) {
          stats.writeOffs++
          for (const [key, qty] of brak) move(W.shop, `defect:${key}`, -qty)
        }
      }
      const preforms = Math.min(150, Math.floor(stock(W.shop, rawKey("PET preforma 18g (0,5L)")) * 0.01))
      if (preforms > 0) {
        const ok = await step("hisobdan chiqarish (preforma)", () =>
          post("/api/write-offs", { warehouse: W.shop, date, reason: "Shikastlangan preforma", status: "закрыт", items: [{ key: rawKey("PET preforma 18g (0,5L)"), qty: preforms }] }),
        )
        if (ok) {
          stats.writeOffs++
          move(W.shop, rawKey("PET preforma 18g (0,5L)"), -preforms)
        }
      }
      // Collection: the week's cash above a 20 mln float goes to the bank.
      const desk = (await get("/api/cash/cashboxes")).cashboxes.find((row) => row.id === cash.id)
      const surplus = Math.floor((Number(desk?.balance ?? 0) - 20_000_000) / 1_000_000) * 1_000_000
      const ok = surplus > 0 ? await step("kassadan bankka", () => post("/api/cash/transfers", { fromCashboxId: cash.id, toCashboxId: bank.id, amountFrom: surplus, amountTo: surplus, date: `${date} 18:30:00`, comment: "Haftalik inkassatsiya" })) : null
      if (ok) stats.cashTransfers++
    }

    // Dealer contracts (2nd), a supplier return of damaged preforms (8th), the transport cost of a supply (12th),
    // a price rise on the wholesale list (15th), agents' shop tasks (20th), attendance of the last week.
    if (n === 2) {
      const agents = job("Savdo agenti")
      for (const [index, client] of clients.filter((row) => row.type === "Diler" || row.type === "Ulgurji baza").entries()) {
        const agent = agents.find((row) => name(row) === client.agent) ?? agents[0]
        await step(`shartnoma ${client.name}`, () =>
          post("/api/contracts", { contractPrefix: "ZD-", contractNumber: index + 1, createdDate: date, officialName: `${client.name.replace(/ \(.*\)$/, "")} MChJ`, inn: client.inn || String(300100000 + index), clientIds: [client.id], agentId: agent.id, status: "active", comment: "Diler shartnomasi, 7 kunlik to'lov muddati" }),
        )
      }
    }
    if (n === 8) {
      const damaged = Math.min(500, Math.floor(stock(W.raw, rawKey("PET preforma 38g (1,5L)")) * 0.01))
      if (damaged > 0) {
        const created = await step("yetkazib beruvchiga qaytarish", () =>
          post("/api/supplier-returns", { fromWhom: "Preform Plast MChJ", warehouse: W.raw, organization: D.COMPANY.organization, branch: D.COMPANY.mainBranch, currency: "SUM", date, comment: "Darz ketgan preformalar", items: [{ key: rawKey("PET preforma 38g (1,5L)"), product: "PET preforma 38g (1,5L)", qty: damaged, price: rawInfo.get("PET preforma 38g (1,5L)").cost }] }),
        )
        if (created && (await step("qaytarishni jo'natish", () => patch(`/api/supplier-returns/${created.id}`, { action: "give" })))) move(W.raw, rawKey("PET preforma 38g (1,5L)"), -damaged)
      }
    }
    if (n === 12) {
      const supply = supplierDebt.get("Shakar Savdo MChJ")?.[0]
      if (supply) {
        const added = await step("kirim xarajati (transport)", () => post(`/api/supplier-incomings/${supply.supplyId}/expenses`, { date, description: "Shakarni Urganchdan olib kelish (fura)", amount: 6_500_000, currency: "SUM", paymentType: "Наличный" }))
        // The answer is the supply itself; the new expense is the last of its expense list.
        const expenses = added ? rowsOf(await get(`/api/supplier-incomings/${supply.supplyId}/expenses`)) : []
        const expenseId = expenses.at(-1)?.id
        if (expenseId) await expense(date, "Kirim bo'yicha qo'shimcha xarajat", 6_500_000, cash, "Fura uchun to'lov", { supplyId: supply.supplyId, supplyExpenseId: expenseId })
        else log("  ! kirim xarajati javobi:", JSON.stringify(added).slice(0, 300))
      }
    }
    if (n === 15) {
      const list = rowsOf(await get("/api/price-lists?active=all")).find((row) => row.name === "Ulgurji")
      const rises = [["Zilol Cola 1,5L", 9300], ["Zilol Cola 1L", 7100]]
      const ok = await step("qayta baholash (Ulgurji)", () =>
        post("/api/repricings", { priceListId: list.id, currency: "SUM", comment: "Shakar narxi oshgani uchun", products: rises.map(([productName, price]) => ({ kind: "product", id: products.get(productName).id, price })) }),
      )
      if (ok) for (const [productName, price] of rises) productInfo.get(productName).prices.Ulgurji = price
    }
    if (n === 20) {
      for (const agent of job("Savdo agenti")) {
        const own = clients.filter((row) => row.agent === name(agent)).slice(0, 2)
        for (const client of own) await step(`vazifa ${client.name}`, () => post("/api/tasks", { title: "Yangi Zilol Cola 1L uchun javon joylashtirish", clientId: client.id, employeeId: agent.id, taskDate: day(Math.min(LAST_DAY, n + 3)) }))
      }
    }
    if (n >= LAST_DAY - 6 && dow !== 0) {
      for (const employee of employees) {
        const shiftStart = ["Liniya operatori", "Qadoqlovchi", "Smena boshlig'i"].includes(employee.job) && employee.id % 2 === 0 ? 20 : employee.job === "Qorovul" ? 8 : 9
        if (R.chance(0.04)) continue // absent
        const late = R.chance(0.1) ? R.int(6, 40) : -R.int(0, 15)
        const minutes = shiftStart * 60 + late
        const at = (m) => `${date}T${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}:00+05:00`
        const inOk = await step(`davomat ${name(employee)}`, () => post("/api/work-attendance/check-ins", { employeeId: employee.id, kind: "in", at: at(minutes), place: "Zavod kirish nazorati", idempotencyKey: `in-${employee.id}-${date}` }))
        // The night shift leaves the next morning: only its arrival belongs to this day.
        if (inOk && shiftStart !== 20) await step(`davomat ${name(employee)} chiqish`, () => post("/api/work-attendance/check-ins", { employeeId: employee.id, kind: "out", at: at(minutes + 9 * 60 + R.int(0, 30)), place: "Zavod kirish nazorati", idempotencyKey: `out-${employee.id}-${date}` }))
      }
    }

    // Monthly and weekly expenses.
    if (n === 3) await expense(date, "Ofis xarajatlari", 2_400_000, cash, "Kantselyariya va ichimlik suvi")
    if (n === 5) await expense(date, "Reklama va marketing", 12_000_000, bank, "Instagram va billbord reklamasi")
    if (n === 10) await expense(date, "Elektr energiya", 38_500_000, bank, "Sentyabr uchun elektr energiya")
    if (n === 10) await expense(date, "Tabiiy gaz", 9_200_000, bank, "Sentyabr uchun gaz")
    if (n === 12) await expense(date, "Suv va kanalizatsiya", 4_100_000, bank, "Sentyabr uchun suv")
    if (n === 14 || n === 27) await expense(date, "Uskunalar ta'miri", R.int(3, 9) * 1_000_000, cash, "Quyish blokining ehtiyot qismlari")
    if (n === 20) await expense(date, "Soliqlar", 42_000_000, bank, "QQS va foyda solig'i (sentyabr)")
    if (dow === 2) await expense(date, "Yoqilg'i (transport)", R.int(35, 55) * 100_000, cash, "Yetkazib berish mashinalari uchun benzin/metan")
    if (dow === 2) await expense(date, "Yoqilg'i (transport)", R.int(15, 25) * 100_000, samCash, "Samarqand mashinalari uchun yoqilg'i")

    // Salary advance on the 15th: 40 % of the monthly salary to everyone.
    if (n === 15) {
      const salaryOf = new Map(D.JOBS.map((row) => [row.name, row.salary]))
      for (const [branchName, cashbox] of [[D.COMPANY.mainBranch, cash], [D.COMPANY.branch2, samCash]]) {
        const branchId = branches.get(branchName).id
        const people = employees.filter((row) => row.branchIds.includes(branchId))
        const staff = people.map((row) => ({ employeeId: row.id, amount: Math.round(salaryOf.get(row.job) * 0.4) }))
        const total = staff.reduce((sum, row) => sum + row.amount, 0)
        // The desk takes the advance from the bank account when its own cash is short.
        const desk = (await get("/api/cash/cashboxes")).cashboxes.find((row) => row.id === cashbox.id)
        const missing = total - Number(desk?.balance ?? 0)
        if (missing > 0) {
          const amount = Math.ceil(missing / 1_000_000) * 1_000_000
          await step("kassani avans uchun to'ldirish", () => post("/api/cash/transfers", { fromCashboxId: bank.id, toCashboxId: cashbox.id, amountFrom: amount, amountTo: amount, date: `${date} 09:00:00`, comment: "Avans uchun naqd pul" }))
        }
        await expense(date, "Avans", total, cashbox, `Oktyabr oyi avansi (${branchName})`, { staff, amount: total })
      }
    }
  }

  return { orders, supplierDebt }
}

/** Month end: payroll (salaries, «Зачислить», payout of the rest after the advance) and the
 * stock count of the finished goods warehouse (a few small differences, confirmed). */
export async function runClosing(ctx) {
  const { W } = ctx
  const date = day(LAST_DAY)
  const byName = (rows) => new Map(rowsOf(rows).map((row) => [row.name, row]))
  const employees = rowsOf(await get("/api/employees"))
  const cashboxes = byName(await get("/api/cashboxes"))
  const expenseCats = byName(await get("/api/expense-categories"))
  const branches = byName(await get("/api/branches"))
  const salaryOf = new Map(D.JOBS.map((row) => [row.name, row.salary]))

  // Agents and drivers earn a bonus on top: 1 % of what they delivered (set as a fixed sum here).
  const salaries = employees.map((row) => ({ user: row.id, salary: salaryOf.get(row.job) }))
  await step("oylik belgilash", () => post("/api/salary-records", { month: MONTH, year: YEAR, currency: "SUM", salaries }))
  const records = rowsOf(await get(`/api/salary-records?month=${MONTH}&year=${YEAR}&all=1`))
  log(`closing: ${records.length} salary records`)
  await step("oylikni zachislit", () => post("/api/salary-records/change-approve", { month: MONTH, year: YEAR, users: employees.map((row) => row.id), is_approved: true }))

  const bank = cashboxes.get("Bank hisobi (Kapitalbank)")
  const samCash = cashboxes.get("Samarqand kassa")
  // The founder tops up the bank account when the payroll would not fit.
  const payroll = employees.reduce((sum, row) => sum + Math.round(salaryOf.get(row.job) * 0.6), 0)
  const bankNow = Number((await get("/api/cash/cashboxes")).cashboxes.find((row) => row.id === bank.id)?.balance ?? 0)
  if (bankNow < payroll) {
    const incomeCats = byName(await get("/api/income-categories"))
    const amount = Math.ceil((payroll - bankNow) / 10_000_000) * 10_000_000 + 50_000_000
    await step("oylik uchun investitsiya", () => post("/api/cash/operations", { kind: "income", date: `${date} 08:30:00`, cashboxId: bank.id, branch: D.COMPANY.mainBranch, organization: D.COMPANY.organization, categoryId: incomeCats.get("Ta'sischi investitsiyasi").id, amount, comment: "Aylanma mablag'ni to'ldirish", isVerified: true }))
  }
  for (const [branchName, cashbox] of [[D.COMPANY.mainBranch, bank], [D.COMPANY.branch2, samCash]]) {
    const branchId = branches.get(branchName).id
    const staff = employees.filter((row) => row.branchIds.includes(branchId)).map((row) => ({ employeeId: row.id, amount: Math.round(salaryOf.get(row.job) * 0.6) }))
    const total = staff.reduce((sum, row) => sum + row.amount, 0)
    if (cashbox === samCash) await step("Samarqand kassasini to'ldirish (oylik)", () => post("/api/cash/transfers", { fromCashboxId: bank.id, toCashboxId: samCash.id, amountFrom: total, amountTo: total, date: `${date} 09:00:00`, comment: "Oylik uchun" }))
    await step(`oylik to'lash ${branchName}`, () =>
      post("/api/cash/operations", { kind: "expense", date: `${date} ${time(16)}`, cashboxId: cashbox.id, branch: branchName, organization: D.COMPANY.organization, categoryId: expenseCats.get("Ish haqi").id, amount: total, staff, comment: `Oktyabr oyi ish haqi (avansdan keyingi qism), ${branchName}`, isVerified: true }),
    )
  }

  // Stock count of the finished goods warehouse at the end of the day.
  const balances = await step("inventarizatsiya qoldiqlari", () => get(`/api/stock/inventories/balances?warehouse=${encodeURIComponent(W.goods)}&date=${date}&forDayEnd=1`))
  const rows = rowsOf(balances).filter((row) => Number(row.qty ?? 0) > 0)
  log(`closing: ${rows.length} items in ${W.goods}`, JSON.stringify(rowsOf(balances)[0] ?? balances).slice(0, 300))
  if (rows.length) {
    const items = rows.map((row, index) => {
      const system = Number(row.qty ?? 0)
      const actual = index % 5 === 0 ? Math.max(0, system - R.int(1, 12)) : index % 7 === 0 ? system + R.int(1, 6) : system
      return { key: row.key, amount: actual }
    })
    const inventory = await step("inventarizatsiya", () => post("/api/stock/inventories", { type: "custom_date", warehouse: W.goods, invDate: date, forDayEnd: true, comment: "Oy oxiri inventarizatsiyasi", items }))
    if (inventory) await step("inventarizatsiyani tasdiqlash", () => post(`/api/stock/inventories/${inventory.id}/confirm`, { comment: "Komissiya: omborchi, hisobchi, smena boshlig'i" }))
    return { inventory, items }
  }
}
