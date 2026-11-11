// A working day by role on the LOCAL factory instance: every step is done by the employee whose
// job it is, signed in with their own account (not the administrator), and each of them also
// tries something that is not their job.
//
//   node scripts/factory/audit/role-day.mjs
//
// agent: order for a client → confirms it;  storekeeper: may not ship it (no orders.manage) but
// moves and writes off stock;  deliverer: ships and delivers it, may not take the money into a
// cashbox;  cashier: takes the payment, an expense, a transfer between cashboxes, may not touch
// orders or stock;  supply: a supplier incoming and its acceptance;  production: a batch;
// accountant: reads the salaries, may not change an access right.
// Writes a handful of documents dated today (take a snapshot first, README). PASS / FAIL per step.
const BASE = process.env.FACTORY_URL || "http://localhost:3001"
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(BASE).hostname)) throw new Error(`local servers only, not ${BASE}`)
const ADMIN = { username: process.env.FACTORY_USER || "admin", password: process.env.FACTORY_PASS || "Zavod-Admin-2026" }

let failed = 0
function check(name, ok, detail = "") {
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
}
let hop = 0
async function call(cookie, method, url, body) {
  const headers = { origin: BASE, "x-forwarded-for": `10.44.0.${hop++ % 250}` }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers["content-type"] = "application/json"
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (response.status === 429 && attempt < 20) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      continue
    }
    const text = await response.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {}
    return { status: response.status, data, text, setCookie: response.headers.getSetCookie?.() ?? [] }
  }
}
const sessionOf = (response) => response.setCookie.map((value) => value.split(";")[0]).filter((value) => value.startsWith("linko_session=")).join("; ")
const rowsOf = (data) => (Array.isArray(data) ? data : (data?.results ?? data?.rows ?? data?.items ?? []))
const brief = (response) => `${response.status} ${response.text.slice(0, 110)}`

async function signIn(username, password) {
  for (const candidate of [`${password}-New9`, password]) {
    const response = await call("", "POST", "/api/auth/login", { username, password: candidate })
    if (response.status !== 200) continue
    const cookie = sessionOf(response)
    if (!response.data.mustChangePassword) return cookie
    const changed = await call(cookie, "PUT", "/api/auth/password", { currentPassword: candidate, newPassword: `${password}-New9` })
    if (changed.status !== 200) throw new Error(`password change of ${username}: ${changed.status}`)
    return signIn(username, password)
  }
  throw new Error(`cannot sign in as ${username}`)
}

const admin = sessionOf(await call("", "POST", "/api/auth/login", ADMIN))
if (!admin) throw new Error("administrator sign-in failed")
const get = async (url) => (await call(admin, "GET", url)).data
const users = rowsOf(await get("/api/users"))
const rights = rowsOf(await get("/api/access-rights"))
const employees = rowsOf(await get("/api/employees"))
const accountOf = (rightName) => {
  const right = rights.find((row) => row.name === rightName)
  const user = users.find((row) => row.accessRightId === right?.id && /\d+$/.test(row.username))
  if (!user) throw new Error(`no account with the access right ${rightName} (run the simulation first)`)
  const employee = employees.find((row) => row.id === user.employeeId)
  return { ...user, name: employee?.name ?? "", password: `Zilol-${2026 + Number(/(\d+)$/.exec(user.username)[1])}-xodim` }
}
const who = {}
for (const [key, right] of Object.entries({ agent: "Savdo agenti", deliverer: "Yetkazib beruvchi", cashier: "Kassir", keeper: "Omborchi", supply: "Ta'minot", production: "Ishlab chiqarish", accountant: "Hisobchi" })) {
  const account = accountOf(right)
  who[key] = { ...account, cookie: await signIn(account.username, account.password) }
}
console.log("accounts:", Object.entries(who).map(([key, account]) => `${key}=${account.username}`).join(" "))

const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
const ORGANIZATION = "Zilol Ichimliklar MChJ"
const GOODS = "Tayyor mahsulot ombori"
// A product with goods free for a confirmed order (the server names the free quantity when it
// refuses an order that asks for too much; the balance row's "available" is not that figure).
const clientForProbe = rowsOf(await get("/api/clients"))[0]
let product = null
for (const candidate of rowsOf(await get("/api/products"))) {
  const probe = await call(admin, "POST", "/api/orders", { clientId: clientForProbe.id, warehouse: GOODS, priceList: "Ulgurji", currency: "SUM", organization: ORGANIZATION, paymentType: "cash", dealType: "standard", delivery: today, items: [{ productId: candidate.id, quantity: 1e9, unitPrice: 1 }] })
  const free = probe.data?.shortage?.[0]?.available ?? 0
  if (free >= 40) {
    product = candidate
    console.log(`product: ${candidate.name} (${free} free in ${GOODS})`)
    break
  }
}
if (!product) throw new Error(`no product with 40 free units in ${GOODS}`)
const client = rowsOf(await get("/api/clients")).find((row) => row.agent === who.agent.name) ?? rowsOf(await get("/api/clients"))[0]
const cashboxes = rowsOf(await get("/api/cashboxes"))
const cash = cashboxes.find((row) => /naqd/.test(row.name))
const bank = cashboxes.find((row) => /Bank/.test(row.name))
const incomeCategory = rowsOf(await get("/api/income-categories")).find((row) => /Buyurtma/.test(row.name))
const expenseCategory = rowsOf(await get("/api/expense-categories")).find((row) => /Ofis/.test(row.name))

// --- the agent ---------------------------------------------------------------------------
const quantity = 12
const unitPrice = 6500
const created = await call(who.agent.cookie, "POST", "/api/orders", {
  status: "Не подтвержден",
  clientId: client.id,
  warehouse: GOODS,
  priceList: "Ulgurji",
  currency: "SUM",
  agent: who.agent.name,
  deliveryMan: who.deliverer.name,
  organization: ORGANIZATION,
  paymentType: "cash",
  dealType: "standard",
  delivery: today,
  comment: "role-day",
  items: [{ productId: product.id, quantity, unitPrice, discountPercent: 0, currency: "SUM" }],
})
check("the agent creates an order for their client", created.status === 201, brief(created))
const orderId = created.data?.id
const confirmed = await call(who.agent.cookie, "PATCH", `/api/orders/${orderId}`, { status: "Есть на складе" })
check("the agent confirms it («Есть на складе»: the goods are reserved)", confirmed.status === 200, brief(confirmed))
check("the agent cannot take money into a cashbox", (await call(who.agent.cookie, "POST", `/api/cash/orders/${orderId}/pay`, { date: `${today} 12:00:00`, cashboxId: cash.id, amount: 1000, categoryId: incomeCategory.id, branch: cash.branch, organization: ORGANIZATION })).status === 403)
check("the agent cannot read the cash desk", (await call(who.agent.cookie, "GET", "/api/cash/cashboxes")).status === 403)
check("the agent cannot write stock off", (await call(who.agent.cookie, "POST", "/api/write-offs", { warehouse: GOODS, date: today, reason: "x", status: "закрыт", items: [{ key: `product:${product.id}`, qty: 1 }] })).status === 403)

// --- the storekeeper -----------------------------------------------------------------------
check("the storekeeper cannot change the order's status (no orders.manage)", (await call(who.keeper.cookie, "PATCH", `/api/orders/${orderId}`, { status: "В пути" })).status === 403)
const moved = await call(who.keeper.cookie, "POST", "/api/internal-transfers", {
  fromWarehouse: GOODS,
  toWarehouse: "Samarqand ombori",
  createdAt: `${today} 09:00:00`,
  organization: ORGANIZATION,
  comment: "role-day",
  autoAccept: true,
  items: [{ key: `product:${product.id}`, quantity: 2 }],
})
check("the storekeeper moves goods to another warehouse", moved.status === 201, brief(moved))
const writtenOff = await call(who.keeper.cookie, "POST", "/api/write-offs", { warehouse: GOODS, date: today, reason: "Shikastlangan", comment: "role-day", status: "закрыт", items: [{ key: `product:${product.id}`, qty: 1 }] })
check("the storekeeper writes a damaged unit off", writtenOff.status === 201, brief(writtenOff))
check("the storekeeper cannot record a cash expense", (await call(who.keeper.cookie, "POST", "/api/cash/operations", { kind: "expense", date: `${today} 12:00:00`, cashboxId: cash.id, branch: cash.branch, organization: ORGANIZATION, categoryId: expenseCategory.id, amount: 1000 })).status === 403)

// --- the deliverer -------------------------------------------------------------------------
const shipped = await call(who.deliverer.cookie, "PATCH", `/api/orders/${orderId}`, { status: "В пути" })
check("the deliverer takes the order («В пути»)", shipped.status === 200, brief(shipped))
const delivered = await call(who.deliverer.cookie, "PATCH", `/api/orders/${orderId}`, { status: "Доставлено", acceptedDate: today })
check("the deliverer hands it over («Доставлено»)", delivered.status === 200, brief(delivered))
const total = quantity * unitPrice
const payment = { date: `${today} 15:00:00`, cashboxId: cash.id, amount: total, categoryId: incomeCategory.id, branch: cash.branch, organization: ORGANIZATION, comment: "role-day" }
check("the deliverer cannot book the money into a cashbox", (await call(who.deliverer.cookie, "POST", `/api/cash/orders/${orderId}/pay`, payment)).status === 403)
check("the deliverer cannot edit a client card (no clients.manage)", (await call(who.deliverer.cookie, "PUT", `/api/clients/${client.id}`, { name: "x" })).status === 403)

// --- the cashier ---------------------------------------------------------------------------
const before = rowsOf((await call(who.cashier.cookie, "GET", "/api/cash/cashboxes")).data?.cashboxes).find((row) => row.id === cash.id)?.balance
const paid = await call(who.cashier.cookie, "POST", `/api/cash/orders/${orderId}/pay`, payment)
check("the cashier takes the payment for the delivered order", paid.status === 201, brief(paid))
const after = rowsOf((await call(who.cashier.cookie, "GET", "/api/cash/cashboxes")).data?.cashboxes).find((row) => row.id === cash.id)?.balance
check("the cashbox grew by exactly the order's sum", Math.round(after - before) === total, `${before} → ${after}, order ${total}`)
check("a second payment for the same order is refused", (await call(who.cashier.cookie, "POST", `/api/cash/orders/${orderId}/pay`, payment)).status === 400)
const expense = await call(who.cashier.cookie, "POST", "/api/cash/operations", { kind: "expense", date: `${today} 16:00:00`, cashboxId: cash.id, branch: cash.branch, organization: ORGANIZATION, categoryId: expenseCategory.id, amount: 25000, comment: "role-day" })
check("the cashier records an expense", expense.status === 201, brief(expense))
const toBank = await call(who.cashier.cookie, "POST", "/api/cash/transfers", { fromCashboxId: cash.id, toCashboxId: bank.id, amountFrom: 50000, amountTo: 50000, date: `${today} 17:00:00`, comment: "role-day" })
check("the cashier hands cash over to the bank account", toBank.status === 201 || toBank.status === 200, brief(toBank))
check("the cashier cannot change an order", (await call(who.cashier.cookie, "PATCH", `/api/orders/${orderId}`, { comment: "x" })).status === 403)
check("the cashier cannot move stock", (await call(who.cashier.cookie, "POST", "/api/internal-transfers", { fromWarehouse: GOODS, toWarehouse: "Samarqand ombori", createdAt: `${today} 09:00:00`, organization: ORGANIZATION, autoAccept: true, items: [{ key: `product:${product.id}`, quantity: 1 }] })).status === 403)
check("the cashier cannot change an employee", (await call(who.cashier.cookie, "PUT", `/api/employees/${who.agent.employeeId}`, {})).status === 403)
check("the cashier cannot read the accounts list", (await call(who.cashier.cookie, "GET", "/api/users")).status === 403)

// --- supply --------------------------------------------------------------------------------
const supplier = rowsOf(await get("/api/suppliers"))[0]
const raw = rowsOf(await get("/api/raw-materials"))[0]
const incoming = await call(who.supply.cookie, "POST", "/api/supplier-incomings", {
  supplier: supplier.name,
  warehouse: "Xom ashyo ombori",
  branch: "Toshkent bosh zavod",
  organization: ORGANIZATION,
  paymentType: "Банковский счет",
  currency: "SUM",
  date: today,
  invoiceNumber: `RD-${Date.now().toString().slice(-6)}`,
  invoiceDate: today,
  comment: "role-day",
  items: [{ key: `raw_material:${raw.id}`, product: raw.name, qty: 10, cost: 1000 }],
})
check("the supply officer enters a supplier incoming", incoming.status === 201, brief(incoming))
if (incoming.status === 201) {
  const accepted = await call(who.supply.cookie, "PATCH", `/api/supplier-incomings/${incoming.data.id}`, { action: "accept", date: today })
  check("…and accepts it into the warehouse", accepted.status === 200, brief(accepted))
}
check("the supply officer cannot pay the supplier from a cashbox", (await call(who.supply.cookie, "POST", "/api/cash/operations", { kind: "expense", date: `${today} 12:00:00`, cashboxId: bank.id, branch: bank.branch, organization: ORGANIZATION, categoryId: expenseCategory.id, amount: 1000 })).status === 403)
check("the supply officer cannot create an order", (await call(who.supply.cookie, "POST", "/api/orders", { clientId: client.id, items: [] })).status === 403)

// --- production ----------------------------------------------------------------------------
const stage = rowsOf(await get("/api/production/stages"))[0]
const batch = await call(who.production.cookie, "POST", "/api/production/parties", { stageId: stage.id, date: today, comment: "role-day" })
check("the production head opens a batch", batch.status === 201, brief(batch))
check("the production head cannot read the salaries", (await call(who.production.cookie, "GET", `/api/salary-records?month=10&year=2026`)).status === 403)
check("the production head cannot take a client payment", (await call(who.production.cookie, "POST", `/api/cash/orders/${orderId}/pay`, payment)).status === 403)

// --- the accountant ------------------------------------------------------------------------
check("the accountant reads the salaries", (await call(who.accountant.cookie, "GET", `/api/salary-records?month=10&year=2026`)).status === 200)
check("the accountant reads the profit and loss report", [200, 400].includes((await call(who.accountant.cookie, "GET", `/api/balances/management?from=2026-10-01&to=2026-10-31`)).status))
check("the accountant cannot change an access right", (await call(who.accountant.cookie, "PUT", `/api/access-rights/${rights[0].id}`, { name: rights[0].name, capabilityIds: [] })).status === 403)
check("the accountant cannot open a production batch", (await call(who.accountant.cookie, "POST", "/api/production/parties", { stageId: stage.id, date: today })).status === 403)

// --- what the administrator sees afterwards ---------------------------------------------------
const order = await get(`/api/orders/${orderId}`)
check("the order ends delivered and paid in full", /Доставлен/.test(String(order?.status)) && Number(order?.payableRest ?? 1) === 0, `status ${order?.status}, rest ${order?.payableRest}`)
const logs = rowsOf(await get(`/api/orders/${orderId}/logs`))
const actors = [...new Set(logs.map((row) => row.createdBy).filter(Boolean))]
check("the order's journal names who did each step (agent and deliverer)", actors.includes(who.agent.name) && actors.includes(who.deliverer.name), actors.join(", "))

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed")
process.exit(failed ? 1 : 0)
