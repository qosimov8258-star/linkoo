// READ-ONLY preview (SELECT only, never writes) of the changes to EXISTING rows that would make the local database
// equal to the reference (app.linko.uz, server time3): agents, client_restrictions, internal transfers,
// the orphan table zone_removed, the demo inventory products' ids and one optional demo visit.
// Reference values come from scripts/demo/data/existing-changes-reference.json (read-only API reads on 2026-10-23).
// Usage: node scripts/demo/preview-existing-changes.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const REF = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/existing-changes-reference.json"), "utf8"))
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const client = new pg.Client({ connectionString: url })
await client.connect()
// Every statement runs inside a READ ONLY transaction, so the preview cannot write even by mistake.
await client.query("BEGIN READ ONLY")
const q = (sql, params) => client.query(sql, params).then((r) => r.rows)
const exists = async (name) => (await q("SELECT to_regclass($1) IS NOT NULL AS ok", [name]))[0].ok
const section = (title, lines) => console.log(`\n== ${title}\n${lines.map((l) => `   ${l}`).join("\n")}`)

// 1. agents ------------------------------------------------------------------------------------------------------
{
  const emp = await q("SELECT id, active FROM employees")
  const byId = new Map(emp.map((e) => [e.id, e]))
  const missing = REF.agentPlans.filter((a) => !byId.has(a.id)).map((a) => a.id)
  const mismatch = REF.agentPlans.filter((a) => byId.has(a.id) && (byId.get(a.id).active === 1) !== a.active).map((a) => a.id)
  const present = (await exists("agent_plan_members")) ? Number((await q("SELECT count(*) AS n FROM agent_plan_members"))[0].n) : 0
  section("1. Agentlar (employees qatorlari O'ZGARMAYDI)", [
    `employees: ${emp.length}, active=1: ${emp.filter((e) => e.active === 1).length} (referensda faol: 129, id'lar bir xil)`,
    `referens agents_plans: ${REF.agentPlans.length} ta, faol: ${REF.agentPlans.filter((a) => a.active).length} ta (panelda "Не Вышли 83")`,
    `lokalda yo'q id: ${missing.length || "yo'q"}; faol belgisi farq qiladigan: ${mismatch.length || "yo'q"}`,
    `taklif: yangi jadval agent_plan_members (employee_id, active_in_reference) — ${REF.agentPlans.length - present} qator INSERT`,
    "UI o'zgarishi kerak: routes-analysis-view agentlar ro'yxatini shu jadval ∩ faol bo'yicha filtrlashi → 83",
  ])
}

// 2. client_restrictions -------------------------------------------------------------------------------------------
{
  const SAMPLES = ["Kredit limiti", "Savdo hududi", "Min. buyurtma summasi", "Yopiq do'konlar"]
  const RENUMBER = [
    { from: 18, to: 8, name: "7 kun" },
    { from: 19, to: 9, name: "Yozgi cheklov 2" },
    { from: 20, to: 10, name: "new" },
  ]
  const rows = await q("SELECT id, name, config FROM client_restrictions ORDER BY id")
  const samples = rows.filter((r) => r.id >= 8 && r.id <= 11 && SAMPLES.includes(r.name) && r.config === "{}")
  // The samples are removed first, so their ids are free for the renumbering.
  const remaining = rows.filter((r) => !samples.includes(r))
  const moves = RENUMBER.filter((m) => remaining.some((r) => r.id === m.from && r.name === m.name) && !remaining.some((r) => r.id === m.to))
  const after = remaining.map((r) => moves.find((m) => m.from === r.id)?.to ?? r.id).sort((a, b) => a - b)
  const refIds = REF.restrictions.map((r) => r.id).sort((a, b) => a - b)
  const refByName = new Map(REF.restrictions.map((r) => [r.id, r.name]))
  const nameOk = after.every((id) => remaining.find((r) => (moves.find((m) => m.from === r.id)?.to ?? r.id) === id)?.name === refByName.get(id))
  const seq = (await q("SELECT last_value FROM client_restrictions_id_seq"))[0].last_value
  section("2. Ограничения по клиентам (jadval id/name referensga teng bo'ladi)", [
    `hozir ${rows.length} qator: id ${rows.map((r) => r.id).join(",")}`,
    ...samples.map((r) => `O'CHIRILADI: id ${r.id} "${r.name}" (config {})`),
    ...moves.map((m) => `QAYTA RAQAMLANADI: id ${m.from} "${m.name}" → ${m.to}`),
    `keyin ${after.length} qator: id ${after.join(",")}`,
    `referens (${refIds.length} ta): ${refIds.join(",")} → id'lar mos: ${JSON.stringify(after) === JSON.stringify(refIds)}, nomlar mos: ${nameOk}`,
    `id sequence last_value ${seq} → ${Math.max(...after)} (keyingi yangi yozuv id 18 oladi, referensdagidek)`,
    "demo_seed_rows: client_restrictions row_id 18/19/20 → 8/9/10 (yozuv yangilanadi)",
    "zaxira: butun jadval nusxasi (demo_seed_backup_client_restrictions) + demo_seed_updates",
  ])
}

// 3. internal_transfers ----------------------------------------------------------------------------------------------
{
  const MAP = { accepted: "принят", approved: "потвержден", pending: "ожидает", given: "в пути", cancelled: "отменен" }
  const rows = await q("SELECT id, status, from_warehouse, to_warehouse, amount, items FROM internal_transfers ORDER BY id")
  const want = (id) => MAP[REF.transferStatuses[String(id)]]
  const diffs = rows.filter((r) => want(r.id) && r.status !== want(r.id))
  const count = (a) => a.reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {})
  const before = count(rows.map((r) => r.status))
  const after = count(rows.map((r) => want(r.id) ?? r.status))
  const inc = Object.fromEntries((await q("SELECT status, count(*)::int AS n FROM supplier_incomings GROUP BY 1")).map((r) => [r.status, r.n]))
  const hasStock = (await q("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'stock_name'"))[0].n > 0
  const ordRows = await q(`SELECT status, count(*)::int AS n FROM orders WHERE ${hasStock ? "NULLIF(stock_name, '') IS NOT NULL" : "true"} GROUP BY 1`)
  const ord = (list) => ordRows.filter((r) => list.includes(r.status)).reduce((a, r) => a + r.n, 0)
  const tabs = (t) => ({
    "Передача": (t["потвержден"] ?? 0) + ord(["Есть на складе"]),
    "История Передачи": (t["в пути"] ?? 0) + (t["принят"] ?? 0) + ord(["Есть на складе", "В пути", "Доставлено"]),
    "Приемка": (inc["ожидает"] ?? 0) + (t["в пути"] ?? 0),
    "История Приемки": (inc["принят"] ?? 0) + (t["принят"] ?? 0),
  })
  const ref = { "Передача": 24, "История Передачи": 624, "Приемка": 16, "История Приемки": 513 }
  const b = tabs(before)
  const a = tabs(after)
  const emptyItems = diffs.every((r) => ["[]", "", null].includes(r.items))
  section("3. Передачи между складами (faqat status ustuni o'zgaradi)", [
    `lokal ${rows.length} ta, referens ${Object.keys(REF.transferStatuses).length} ta; id'lar bir xil: ${rows.every((r) => want(r.id))}`,
    `holatlar hozir ${JSON.stringify(before)} → keyin ${JSON.stringify(after)}`,
    ...diffs.map((r) => `id ${r.id}: "${r.status}" → "${want(r.id)}"  (${r.from_warehouse} → ${r.to_warehouse}, ${r.amount})`),
    ...Object.keys(ref).map((k) => `tab "${k}": hozir ${b[k]} → keyin ${a[k]}  (referens ${ref[k]}) ${a[k] === ref[k] ? "✓" : "✗"}`),
    `o'zgaradigan o'tkazmalarning qatorlari (items) bo'sh: ${emptyItems} → ombor qoldig'iga ta'siri yo'q`,
    "'Приемка' referensda 16 = 4 supply + 11 order_return + 1 transfer; lokalda mijoz qaytarishlari vazifa sifatida yo'q → 6 bo'ladi (alohida ish)",
  ])
}

// 4. zone_removed ------------------------------------------------------------------------------------------------------
{
  const has = await exists("zone_removed")
  const rows = has ? await q("SELECT zone_id, removed_at FROM zone_removed") : []
  const hits = []
  const skip = new Set(["node_modules", ".next", ".git", "demo"])
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mjs|js|sql)$/.test(e.name) && /\bzone_removed\b/.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(root, full))
    }
  }
  walk(root)
  const registered = await q("SELECT row_id FROM demo_seed_rows WHERE table_name = 'zone_removed'")
  section("4. Yetim jadval zone_removed", [
    `jadval: ${has ? `bor, ${rows.length} qator ${JSON.stringify(rows)}` : "yo'q"}`,
    `kodda havolalar (scripts/demo tashqarisida): ${hits.length ? hits.join(", ") : "yo'q"} → ${has && !hits.length ? "zaxiralab DROP qilish mumkin" : "tegilmaydi"}`,
    `demo_seed_rows yozuvlari: ${registered.map((r) => r.row_id).join(",") || "yo'q"} (ham o'chiriladi, zaxirada qoladi)`,
    "kod ishlatadigan jadval zone_removals — tegilmaydi",
  ])
}

// 5. products ------------------------------------------------------------------------------------------------------------
{
  const demo = await q(`SELECT id, name FROM products WHERE is_inventory = 1 AND deleted = 0
    AND id IN (SELECT row_id::int FROM demo_seed_rows WHERE table_name = 'products' AND domain = 'leftovers') ORDER BY id`)
  const maxReal = (await q("SELECT COALESCE(max(id), 0) AS m FROM products WHERE id NOT IN (SELECT row_id::int FROM demo_seed_rows WHERE table_name = 'products')"))[0].m
  const high = demo.filter((d) => d.id > maxReal)
  const gaps = high.length
    ? (await q("SELECT g::int AS id FROM generate_series(1, $1::int) g WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = g) ORDER BY g LIMIT $2", [maxReal, high.length])).map((r) => r.id)
    : []
  const refs = await q(`SELECT 'inventory_items' t, count(*)::int n FROM inventory_items WHERE product_id = ANY($1::int[])
    UNION ALL SELECT 'order_items', count(*)::int FROM order_items WHERE product_id = ANY($1::int[])
    UNION ALL SELECT 'product_limits', count(*)::int FROM product_limits WHERE item_id = ANY($1::int[])
    UNION ALL SELECT 'product_images', count(*)::int FROM product_images WHERE item_id = ANY($1::int[])
    UNION ALL SELECT 'product_volumes', count(*)::int FROM product_volumes WHERE product_id = ANY($1::int[])
    UNION ALL SELECT 'repricings', count(*)::int FROM repricings WHERE product_id = ANY($1::int[])`, [high.map((d) => d.id)])
  section("5. Demo inventar mahsulotlari (referensda \"Все\" tepasi: 967, 966, 965…; ordering id DESC — kod ikkalasida bir xil)", [
    `demo inventar: ${demo.length} ta, haqiqiy mahsulotlarning eng katta id'si ${maxReal}; ko'chiriladigan: ${high.length} ta`,
    ...high.map((d, i) => `id ${d.id} "${d.name}" → ${gaps[i]}`),
    `boshqa jadvallardagi havolalar: ${refs.map((r) => `${r.t}=${r.n}`).join(", ")}`,
    "kod tuzatishi kerak emas: lib/products-catalog.ts allaqachon 't.id DESC' bilan tartiblaydi (referensdek)",
    "'Все' soni 823 (referens 757): referensda inventar mahsulotlar 757 ning ichida, lokalda ustiga qo'shilgan — bu o'zgarish bilan hal bo'lmaydi",
  ])
}

// 6. optional visit refusal ------------------------------------------------------------------------------------------------
{
  const row = (await q(`SELECT id, result, refusal_type FROM agent_visits WHERE agent = 'Admin Ritm' AND visit_date = '2026-10-22'
    AND id IN (SELECT row_id::int FROM demo_seed_rows WHERE table_name = 'agent_visits' AND domain = 'field-ops') ORDER BY id LIMIT 1`))[0]
  const reason = (await q("SELECT refusal_type FROM agent_visits WHERE result = 'refusal' AND refusal_type <> '' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1"))[0]?.refusal_type
  section("6. 22-oktabr demo tashrifi (IXTIYORIY — referensda rad etish sababi o'qilmadi)", [
    row ? `agent_visits id ${row.id}: result "${row.result}" → "refusal", refusal_type "${row.refusal_type}" → "${reason}" (eng ko'p ishlatiladigan sabab)` : "mos demo tashrif topilmadi",
    "referensda dashboard shu kun uchun \"Отказы 1\" ko'rsatgan; sababi tekshirilmagan, shuning uchun bu qadam odatiy yo'lda kiritilmaydi",
  ])
}

await client.query("ROLLBACK")
await client.end()
console.log("\n(preview tugadi: hech narsa yozilmadi)")
