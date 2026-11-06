// «Опросник» and «План опроса» from Linko.
// - surveys: Linko's questionnaires (main/quiz?from_desktop=true, every one, active or not) by id, with their questions,
//   switches, sequence number, organization (Linko's division = the organization of the same id) and creation time
//   (Linko's wall clock, the way the page shows it). The four example surveys an older seed wrote (organization
//   "Linko Distribution", 2026-10-15) are removed: Linko has none of them and they took Linko's ids 1-4.
// - «План опроса» (ref_records kind "survey-plan", period "<Месяц>-<год>"): Linko's plan of every month
//   (main/quiz_plan by month): one entry per employee and survey with the planned number of surveys.
//   The 36 example rows of the old survey_plans table (registered in demo_seed_rows) are removed too.
//
//   node scripts/linko-sync/import-surveys.mjs     (raw: quizzes, quiz_plan_months)
import { connect, ensureRegistry, fullName, raw, register, runId, sqlDateTime, upsertById, bumpSequence } from "./lib.mjs"

const run = runId("surveys")
const client = await connect()
await ensureRegistry(client)

const QUESTION_TYPE = { radio: "Выбрать одну", select: "Выбрать одну", multi_choose: "Выбрать несколько", input: "Вводит текст", product: "Продукт" }
const QUESTION_FORMAT = { text: "Текст", number: "Число" }
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const DEMO_SURVEYS = ["Do'kon holati so'rovi", "Narx monitoringi", "Raqobatchilar tahlili", "Mijoz qoniqishi"]

const text = (value) => (value == null ? "" : String(value))

function question(option) {
  const answers = (option.values ?? []).map((value) => text(value.value))
  return {
    text: text(option.name),
    type: QUESTION_TYPE[option.select_type] ?? "",
    maxAnswers: text(option.multi_limit),
    format: QUESTION_FORMAT[option.field_type] ?? "",
    orderNo: text(option.position),
    required: option.is_required === true,
    answers: answers.length ? answers : [""],
  }
}

const stats = { surveys: { insert: 0, update: 0, same: 0 }, demoSurveys: 0, demoPlanRows: 0, plans: 0 }
try {
  await client.query("BEGIN")
  await client.query(
    `ALTER TABLE surveys ADD COLUMN IF NOT EXISTS organization_id INTEGER, ADD COLUMN IF NOT EXISTS client_type_id INTEGER,
       ADD COLUMN IF NOT EXISTS order_no TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS flags TEXT NOT NULL DEFAULT '{}',
       ADD COLUMN IF NOT EXISTS questions TEXT NOT NULL DEFAULT '[]'`,
  )

  // The example surveys of the old seed (exactly those: name, organization and the seeding day).
  const demo = (await client.query(
    "SELECT * FROM surveys WHERE name = ANY($1) AND organization = 'Linko Distribution' AND created_at LIKE '2026-10-15%'",
    [DEMO_SURVEYS],
  )).rows
  for (const row of demo) {
    await client.query("DELETE FROM surveys WHERE id = $1", [row.id])
    await register(client, run, "surveys", row.id, "delete", row)
    stats.demoSurveys++
  }

  const organizations = new Set((await client.query("SELECT id FROM organizations")).rows.map((row) => Number(row.id)))
  const clientTypes = new Map((await client.query("SELECT id, name FROM client_types")).rows.map((row) => [Number(row.id), row.name]))
  for (const quiz of raw("quizzes")) {
    const division = quiz.division && organizations.has(Number(quiz.division.id)) ? quiz.division : null
    const marketType = (quiz.market_types ?? []).map((type) => (typeof type === "object" ? type?.id : type)).find((id) => clientTypes.has(Number(id)))
    const created = sqlDateTime(quiz.created_date)
    const result = await upsertById(client, run, "surveys", quiz.id, {
      name: text(quiz.name),
      active: quiz.is_active ? 1 : 0,
      organization: text(quiz.division?.name),
      organization_id: division ? Number(division.id) : null,
      store_type: marketType ? clientTypes.get(Number(marketType)) : "",
      client_type_id: marketType ? Number(marketType) : null,
      comment: text(quiz.comment),
      order_no: text(quiz.position),
      flags: JSON.stringify({ required: quiz.is_required === true, storeCheck: quiz.is_store_check === true, scoring: quiz.has_ball_system === true, perfect: false }),
      questions: JSON.stringify((quiz.options ?? []).map(question)),
      created_at: created,
      updated_at: created,
    })
    stats.surveys[result]++
  }
  await bumpSequence(client, "surveys")

  // «План опроса»: the old example rows, then Linko's plan of every month.
  const demoPlans = (await client.query(
    "SELECT s.* FROM survey_plans s JOIN demo_seed_rows d ON d.table_name = 'survey_plans' AND d.row_id = s.id::text",
  )).rows
  for (const row of demoPlans) {
    await client.query("DELETE FROM survey_plans WHERE id = $1", [row.id])
    await register(client, run, "survey_plans", row.id, "delete", row)
    stats.demoPlanRows++
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS ref_records (
      seq BIGINT GENERATED ALWAYS AS IDENTITY,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, id)
    )`)
  const employees = new Map((await client.query("SELECT id, first_name, last_name FROM employees")).rows.map((row) => [Number(row.id), `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()]))
  const months = raw("quiz_plan_months")
  for (const month of Object.keys(months).sort()) {
    const [year, mm] = month.split("-")
    const period = `${MONTHS[Number(mm) - 1]}-${year}`
    for (const user of months[month] ?? []) {
      const employee = employees.get(Number(user.id)) || fullName(user)
      for (const plan of user.plans ?? []) {
        const id = `linko-${month}-${user.id}-${plan.id}`
        const data = { period, employee, survey: text(plan.name), plan: Number(plan.plan) || 0, id }
        const before = (await client.query("SELECT data, deleted FROM ref_records WHERE kind = 'survey-plan' AND id = $1", [id])).rows[0]
        await client.query(
          `INSERT INTO ref_records (kind, id, data) VALUES ('survey-plan', $1, $2)
           ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, deleted = 0, updated_at = datetime('now')`,
          [id, JSON.stringify(data)],
        )
        await register(client, run, "ref_records:survey-plan", id, before ? "update" : "insert", before ?? null)
        stats.plans++
      }
    }
  }

  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`surveys: ${JSON.stringify(stats)}`)
