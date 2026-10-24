// DEMO data for the finance / P&L area. INSERT-only and idempotent: every inserted row is registered in
// demo_seed_rows (domain 'finance') so scripts/demo/rollback-finance.mjs can remove exactly these rows.
// Usage: node scripts/demo/seed-finance.mjs   (reads DATABASE_URL from .env)
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const DOMAIN = "finance"
const MARKER = "finance:v1"
const MARKER_COST = "finance:v2-cost"
const MARKER_CASH = "finance:v3-cash-income"
const MARKER_SALARY = "finance:v4-salary-plans"

function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261023)
const between = (min, max) => min + (max - min) * rnd()
const pick = (list) => list[Math.floor(rnd() * list.length)]
const round = (value, step = 1) => Math.round(value / step) * step
const hash = (text) => {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 1000) / 1000
}
const pad = (n) => String(n).padStart(2, "0")
const day = (year, month, d) => `${year}-${pad(month)}-${pad(d)}`
const stamp = (date) => `${date} ${pad(8 + Math.floor(rnd() * 10))}:${pad(Math.floor(rnd() * 60))}:${pad(Math.floor(rnd() * 60))}`
const RU_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const ruDate = (date) => {
  const [y, m, d] = date.split("-").map(Number)
  return `${d} ${RU_MONTHS[m - 1]} ${y}`
}
const money = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ")

const client = new pg.Client({ connectionString: url })
await client.connect()
const q = (sql, params = []) => client.query(sql, params).then((r) => r.rows)

await client.query("BEGIN")
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())",
  )
  const seeded = async (marker) =>
    (await q("SELECT 1 FROM demo_seed_rows WHERE domain = $1 AND table_name = '_marker' AND row_id = $2", [DOMAIN, marker])).length > 0
  const hasV1 = await seeded(MARKER)
  const hasCost = await seeded(MARKER_COST)
  const hasCash = await seeded(MARKER_CASH)
  const hasSalary = await seeded(MARKER_SALARY)
  if (hasV1 && hasCost && hasCash && hasSalary) {
    console.log("finance demo data already seeded — nothing to do")
    await client.query("ROLLBACK")
    await client.end()
    process.exit(0)
  }

  const counts = {}
  const insert = async (table, row) => {
    const keys = Object.keys(row)
    const rows = await q(
      `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
      keys.map((key) => row[key]),
    )
    const id = rows[0].id
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)", [table, String(id), DOMAIN])
    counts[table] = (counts[table] ?? 0) + 1
    return id
  }

  // ---- reference data -------------------------------------------------------------------------------------
  const currencies = await q("SELECT name, rate FROM currencies")
  const rateOf = (code) => (code === "SUM" ? 1 : (currencies.find((c) => c.name.toUpperCase() === code)?.rate ?? 1))
  const currencyOf = (amount) => (String(amount).trim().split(" ").pop() || "SUM").toUpperCase()

  const orders = await q(
    `SELECT id, amount, total_price, created_at, branch_name, agent FROM orders
     WHERE status IN ('Доставлено','В пути') AND substr(created_at,1,10) BETWEEN '2025-01-01' AND '2026-09-30'`,
  )
  const orderById = new Map(orders.map((o) => [o.id, o]))
  const monthSales = new Map()
  for (const order of orders) {
    const key = order.created_at.slice(0, 7)
    monthSales.set(key, (monthSales.get(key) ?? 0) + (order.total_price ?? 0) * rateOf(currencyOf(order.amount)))
  }

  const categories = await q("SELECT id, name, parent_id, direct, parameter FROM expense_categories")
  const byName = (name) => categories.find((c) => c.name === name)
  const salaryIds = categories.filter((c) => c.parameter === "Расход на сотрудников").map((c) => c.id)
  const indirectPlan = [["Аренда", 0.014], ["Коммунальные", 0.006], ["Маркетинг", 0.012], ["Прочее", 0.005], ["Админ", 0.008], ["remont", 0.004], ["обед", 0.003]]
  const directPlan = [["Gruzchik rasxod", 0.01], ["pramoi", 0.007], ["Топливо", 0.011]]
  const salaryPlan = [[salaryIds[0], 0.035], [salaryIds[1] ?? salaryIds[0], 0.02]]

  const cashboxes = await q("SELECT id, name, currency, branch FROM cashboxes WHERE id IN (1, 3, 4, 12)")
  const sumBoxes = cashboxes.filter((c) => (c.currency || "SUM") === "SUM")
  const boxById = new Map(sumBoxes.map((c) => [c.id, c]))
  let docNo = Number((await q("SELECT COALESCE(MAX(doc_no), 0) AS m FROM cash_management_entries"))[0].m) + 100
  const nextDoc = () => ++docNo

  const entry = (cashboxId, date, amount, extra) => {
    const box = boxById.get(cashboxId)
    return insert("cash_management_entries", {
      cashbox_id: cashboxId,
      entry_date: date,
      amount,
      internal_amount: amount,
      currency: "SUM",
      branch: box?.branch || "Toshkent",
      organization: "Linko Distribution",
      created_at: stamp(date),
      updated_at: stamp(date),
      created_by: "Admin Ritm",
      doc_no: nextDoc(),
      is_verified: 1,
      is_deleted: 0,
      comment: "",
      ...extra,
    })
  }

  // ---- product cost (warehouse average cost, SUM): quantity-weighted mean sale price x a 0.65-0.85 factor ------
  const costItems = await q(
    `SELECT i.product_name, i.unit_price, i.quantity, o.amount FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.status IN ('Доставлено','В пути') AND i.unit_price > 0 AND i.quantity > 0 AND COALESCE(i.product_name,'') <> ''`,
  )
  const weighted = new Map()
  for (const item of costItems) {
    const entryOf = weighted.get(item.product_name) ?? { value: 0, quantity: 0 }
    entryOf.value += item.unit_price * item.quantity * rateOf(currencyOf(item.amount))
    entryOf.quantity += item.quantity
    weighted.set(item.product_name, entryOf)
  }
  const unitCost = new Map()
  for (const [name, entryOf] of weighted) unitCost.set(name, (entryOf.value / entryOf.quantity) * (0.65 + 0.2 * hash(name)))
  const COST_DATES = [["2024-01-01", 0.94], ["2025-07-01", 1], ["2026-03-01", 1.05]]

  if (!hasV1) {
  // ---- 1. categorised expenses (P&L indirect / direct / salary) --------------------------------------------
  const months = []
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= (y === 2026 ? 9 : 12); m++) months.push([y, m])
  for (const [y, m] of months) {
    const base = Math.max(monthSales.get(`${y}-${pad(m)}`) ?? 0, 30_000_000)
    const book = async (plan, kind) => {
      for (const [ref, share] of plan) {
        const category = typeof ref === "number" ? categories.find((c) => c.id === ref) : byName(ref)
        if (!category) continue
        const amount = round(base * share * between(0.75, 1.25), 1000)
        const boxId = pick([1, 1, 3, 4, 12])
        await entry(boxId, day(y, m, 1 + Math.floor(rnd() * 27)), -amount, {
          expense_category_id: category.id,
          category: category.name,
          description: `${kind}: ${category.name}`,
        })
      }
    }
    await book(indirectPlan, "Расход")
    await book(directPlan, "Прямой расход")
    await book(salaryPlan, "Зарплата")
  }

  // ---- 2. other income (a category flagged other_income = 1) -----------------------------------------------
  const otherIncomeId = await insert("income_categories", { name: "Прочие приходы", parameter: "", other_income: 1, created_at: "2025-01-01 09:00:00", updated_at: "2025-01-01 09:00:00" })
  for (const [y, m] of months.filter(([, m]) => m % 3 === 0 || m === 1)) {
    const date = day(y, m, 5 + Math.floor(rnd() * 20))
    await entry(1, date, round(between(1_500_000, 6_000_000), 1000), {
      income_category_id: otherIncomeId,
      category: "Прочие приходы",
      description: pick(["Возврат аванса", "Продажа макулатуры", "Компенсация от поставщика", "Прочий приход"]),
    })
  }

  // ---- 4. customer returns (documents) ---------------------------------------------------------------------
  await client.query(`CREATE TABLE IF NOT EXISTS customer_returns (
    id serial PRIMARY KEY, order_id integer NOT NULL, product_name text, quantity real, unit_price real,
    discount_percent real, cost_price real, currency text, return_date text NOT NULL, comment text,
    created_by text, created_at text)`)
  const orderItems = await q(
    `SELECT i.order_id, i.product_name, i.quantity, i.unit_price, i.discount_percent, o.amount, o.created_at
     FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE o.status IN ('Доставлено','В пути') AND i.unit_price > 0 AND i.quantity >= 2
       AND substr(o.created_at,1,10) BETWEEN '2025-01-01' AND '2026-09-20'`,
  )
  const salesByYear = new Map()
  for (const item of orderItems) {
    const year = item.created_at.slice(0, 4)
    salesByYear.set(year, (salesByYear.get(year) ?? 0) + item.quantity * item.unit_price * (1 - (item.discount_percent ?? 0) / 100) * rateOf(currencyOf(item.amount)))
  }
  const returned = new Map()
  const shuffled = [...orderItems].sort(() => rnd() - 0.5)
  for (const item of shuffled) {
    const year = item.created_at.slice(0, 4)
    const rate = rateOf(currencyOf(item.amount))
    if ((returned.get(year) ?? 0) >= (salesByYear.get(year) ?? 0) * 0.065) continue
    const quantity = Math.max(1, Math.floor(item.quantity * between(0.1, 0.5)))
    const created = new Date(`${item.created_at.slice(0, 10)}T00:00:00Z`)
    created.setUTCDate(created.getUTCDate() + 1 + Math.floor(rnd() * 9))
    const returnDate = created.toISOString().slice(0, 10)
    const costSum = unitCost.get(item.product_name) ?? item.unit_price * rate * 0.75
    await insert("customer_returns", {
      order_id: item.order_id,
      product_name: item.product_name,
      quantity,
      unit_price: item.unit_price,
      discount_percent: item.discount_percent ?? 0,
      cost_price: costSum / rate,
      currency: currencyOf(item.amount),
      return_date: returnDate,
      comment: pick(["Брак упаковки", "Истёк срок годности", "Клиент отказался", "Ошибка в заказе"]),
      created_by: "Admin Ritm",
      created_at: stamp(returnDate),
    })
    returned.set(year, (returned.get(year) ?? 0) + quantity * item.unit_price * (1 - (item.discount_percent ?? 0) / 100) * rate)
  }

  // ---- 5. write-offs and stocktaking ----------------------------------------------------------------------
  const warehouses = await q("SELECT name FROM warehouses WHERE COALESCE(active, 1) = 1 ORDER BY id LIMIT 12")
  const productNames = [...unitCost.keys()]
  for (let i = 0; i < 14; i++) {
    const [y, m] = pick(months)
    const date = day(y, m, 3 + Math.floor(rnd() * 24))
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, index) => {
      const product = pick(productNames)
      const qty = 1 + Math.floor(rnd() * 12)
      const cost = Math.round(unitCost.get(product))
      return { id: index + 1, product, code: "-", series: "-", block: 0, qty, cost, sum: qty * cost }
    })
    await insert("write_offs", {
      creator: "Admin Ritm",
      warehouse: pick(warehouses).name,
      date: ruDate(date),
      status: "закрыт",
      comment: "",
      reason: pick(["Yaroqsiz", "Muddati o'tgan", "Singan", "Yo'qolgan"]),
      items: JSON.stringify(lines),
      created_at: stamp(date),
      updated_at: stamp(date),
    })
  }
  for (let i = 0; i < 8; i++) {
    const [y, m] = pick(months)
    const date = day(y, m, 10 + Math.floor(rnd() * 15))
    const amount = round(between(-4_000_000, 7_000_000), 1)
    await insert("inventory_records", {
      warehouse: `${pad(1 + Math.floor(rnd() * 28))},${pad(m)},${y}(${1 + Math.floor(rnd() * 3)})`,
      author: "Admin Ritm",
      comment: "Комментариев нет",
      status: "Подтвержденный",
      amount: `${amount < 0 ? "-" : ""}${money(Math.abs(amount))},${pad(Math.floor(rnd() * 100))}`,
      created_at: stamp(date),
      updated_at: stamp(date),
    })
  }

  // ---- 6. cash transfers, agent hand-overs, supplier payments ---------------------------------------------
  const boxIds = [...boxById.keys()]
  for (let i = 0; i < 12; i++) {
    const [y, m] = pick(months)
    const date = day(y, m, 2 + Math.floor(rnd() * 25))
    const from = pick(boxIds)
    const to = pick(boxIds.filter((id) => id !== from))
    const amount = round(between(2_000_000, 25_000_000), 1000)
    const number = nextDoc()
    const transferId = await insert("cash_transfers", {
      doc_no: number, from_cashbox_id: from, to_cashbox_id: to, from_currency: "SUM", to_currency: "SUM",
      amount_from: amount, amount_to: amount, rate: 1, percentage: 0, from_organization: "Linko Distribution",
      to_organization: "Linko Distribution", from_branch: boxById.get(from).branch, to_branch: boxById.get(to).branch,
      date, comment: "", created_by: "Admin Ritm", created_at: stamp(date), is_deleted: 0,
    })
    await entry(from, date, -amount, { transfer_id: transferId, category: "Перевод", description: "Перевод между кассами" })
    await entry(to, date, amount, { transfer_id: transferId, category: "Перевод", description: "Перевод между кассами" })
  }

  const agents = await q("SELECT id, first_name, last_name FROM employees WHERE active = 1 AND position LIKE 'Агент%' ORDER BY id LIMIT 20")
  for (let i = 0; i < 20; i++) {
    const [y, m] = pick(months)
    const date = day(y, m, 2 + Math.floor(rnd() * 25))
    const agent = pick(agents)
    const name = `${agent.first_name} ${agent.last_name}`.trim()
    const amount = round(between(2_000_000, 15_000_000), 1000)
    await insert("cash_acceptances", {
      doc_no: nextDoc(), cashbox_id: 1, agent: name, agent_id: agent.id, organization: "Linko Distribution",
      branch: boxById.get(1).branch || "Toshkent", currency: "SUM", amount, date, comment: "", created_by: "Admin Ritm",
      created_at: stamp(date), updated_at: stamp(date), is_deleted: 0,
    })
    await entry(1, date, amount, { category: "Приход", description: `Принято денег с ${name}` })
  }

  const suppliers = await q("SELECT id, name FROM suppliers ORDER BY id LIMIT 30")
  for (let i = 0; i < 24; i++) {
    const [y, m] = pick(months)
    const date = day(y, m, 2 + Math.floor(rnd() * 25))
    const supplier = pick(suppliers)
    const boxId = pick([1, 4])
    const amount = round(between(5_000_000, 60_000_000), 1000)
    await insert("supplier_payments", {
      supplier: supplier.name, supplier_id: supplier.id, created_by: "Admin Ritm", paid_at: date, payment_date: date,
      organization: "Linko Distribution", amount, currency: "SUM", cash_amount: amount, kassa: boxById.get(boxId).name,
      cashbox_id: boxId, comment: "", doc_no: nextDoc(), branch: boxById.get(boxId).branch, internal_amount: amount,
      real_amount: amount, real_currency: "SUM", is_verified: 1, is_deleted: 0, created_at: stamp(date), updated_at: stamp(date),
    })
    await entry(boxId, date, -amount, { category: "Оплата поставщику", description: `Оплата поставщику ${supplier.name}` })
  }

  // ---- 7. salaries, cashback requests, debt limits ---------------------------------------------------------
  const clients = await q("SELECT name FROM clients WHERE COALESCE(name,'') <> '' ORDER BY id LIMIT 60")
  for (let i = 0; i < 8; i++) {
    const [y, m] = pick(months)
    const date = day(y, m, 2 + Math.floor(rnd() * 25))
    await insert("cashback_withdrawal_requests", {
      client: pick(clients).name,
      amount: round(between(50_000, 900_000), 1000),
      currency: "SUM",
      status: pick(["Новый", "Выплачен", "Выплачен", "Отклонен"]),
      created_at: stamp(date),
      updated_at: stamp(date),
    })
  }
  for (let i = 0; i < 12; i++) {
    await insert("debt_limits", {
      name: clients[i * 3].name,
      phone: `+99890${String(1000000 + Math.floor(rnd() * 8999999))}`,
      info: "",
      type: "Физ. лицо",
      agent: pick(agents).first_name,
      balance: "0",
      debt_limit_type: "Сумма",
      debt_limit: round(between(2_000_000, 30_000_000), 100_000),
      debt_limit_currency: "SUM",
      created_at: "2026-09-01 09:00:00",
      updated_at: "2026-09-01 09:00:00",
    })
  }

  await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', $1, $2)", [MARKER, DOMAIN])
  }

  // ---- cost journal rows (later ids win on equal dates, so these supersede any earlier journal rows) ------------
  if (!hasCost) {
    for (const [name, base] of unitCost) {
      for (const [date, drift] of COST_DATES) {
        const value = Math.round(base * drift * 100) / 100
        await insert("cost_of_goods_rows", {
          name, warehouse: "", row_date: date, avg_cost: value, cost: value, passed: 1, supply_number: "",
          calculated_balance: 0, actual_balance: 0, total_revaluation: 0, last_check_time: `${date} 00:00:00`,
          created_at: `${date} 00:00:00`, updated_at: `${date} 00:00:00`,
        })
      }
    }
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', $1, $2)", [MARKER_COST, DOMAIN])
  }

  // ---- client receipts: every month each cashbox takes in ~112% of what the demo entries paid out of it -----------
  if (!hasCash) {
    const outflow = await q(
      `SELECT e.cashbox_id, substr(e.entry_date, 1, 7) AS month, SUM(-e.amount)::float AS out
       FROM cash_management_entries e JOIN demo_seed_rows d ON d.table_name = 'cash_management_entries' AND d.row_id = e.id::text AND d.domain = $1
       WHERE e.amount < 0 AND e.transfer_id IS NULL GROUP BY 1, 2 ORDER BY 2, 1`,
      [DOMAIN],
    )
    for (const row of outflow) {
      const [y, m] = row.month.split("-").map(Number)
      const parts = 3
      for (let i = 0; i < parts; i++) {
        await entry(row.cashbox_id, day(y, m, 3 + i * 8 + Math.floor(rnd() * 5)), round((row.out * 1.12) / parts, 1000), {
          income_category_id: 6,
          category: "Клиент",
          description: "Приход от клиента",
        })
      }
    }
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', $1, $2)", [MARKER_CASH, DOMAIN])
  }

  // ---- salary plans: KPI is a percentage of the plan. Rows this seed inserted earlier with an amount in that
  // column are replaced (only the ids registered in demo_seed_rows for this domain are touched). ----------------
  if (!hasSalary) {
    const stale = (await q("SELECT row_id FROM demo_seed_rows WHERE domain = $1 AND table_name = 'salary_plans'", [DOMAIN])).map((r) => Number(r.row_id))
    if (stale.length) {
      await client.query("DELETE FROM salary_plans WHERE id = ANY($1::int[])", [stale])
      await client.query("DELETE FROM demo_seed_rows WHERE domain = $1 AND table_name = 'salary_plans'", [DOMAIN])
    }
    const staff = await q("SELECT first_name, last_name FROM employees WHERE active = 1 ORDER BY id LIMIT 30")
    for (const person of staff) {
      const salary = round(between(2_500_000, 9_000_000), 50_000)
      const bonus = round(between(0, 1_500_000), 50_000)
      await insert("salary_plans", {
        employee: `${person.first_name} ${person.last_name}`.trim(),
        salary,
        bonus,
        kpi: Math.round(between(60, 130)),
        credited: rnd() < 0.7 ? 1 : 0,
        created_at: "2026-09-01 09:00:00",
        updated_at: "2026-09-01 09:00:00",
      })
    }
    await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('_marker', $1, $2)", [MARKER_SALARY, DOMAIN])
  }
  await client.query("COMMIT")
  console.log("finance demo data seeded:", counts)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
