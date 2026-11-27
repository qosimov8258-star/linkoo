// Linko's day plans: the tasks behind «Время работы агента» (Аналитика). Linko keeps a plan of tasks per agent and day —
// the visits planned by the routes, and every visit, order, delivery, payment, return, refusal, photo report and service
// time done in the field — and its report agent_work_hour («Показать по» Задачи / Время нахождения) counts them. Only
// market/agent_plans/<agent>/?date=<day> lists them. The agent-days to read are the rows of that report itself (both
// «Показать по» values), month by month.
//
// Read-only: `get(path, params)` must send GET requests only (fetch.mjs get, or a saved browser session that aborts
// everything else). Used by fetch.mjs (step day-plans) → raw file day_plans.json → import-day-tasks.mjs.

const pad = (n) => String(n).padStart(2, "0")

/** `months`: [year, month] pairs. → { reports: {"YYYY-MM|today_plan": rows, …}, plans: {"<agent>|YYYY-MM-DD": [{market, plans}]} } */
export async function fetchDayPlans(get, months, { parallel = 4, log = console.log } = {}) {
  const reports = {}
  const days = new Set()
  for (const [year, month] of months) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    for (const dataType of ["today_plan", "service_time"]) {
      const r = await get("stats/dynamic/get/", {
        stat_key: "agent_work_hour",
        data_type: dataType,
        begin_date: `${year}-${pad(month)}-01`,
        end_date: `${year}-${pad(month)}-${pad(last)}`,
      })
      const rows = r.status === 200 && Array.isArray(r.json?.data) ? r.json.data : null
      reports[`${year}-${pad(month)}|${dataType}`] = rows ?? { __status: r.status }
      for (const agent of rows ?? []) {
        for (const child of agent.child_data ?? []) {
          const [d, m, y] = String(child.name).split(".")
          if (d && m && y) days.add(`${agent.id}|${y}-${m}-${d}`)
        }
      }
    }
  }
  const keys = [...days].sort()
  const plans = {}
  let failed = 0
  for (let i = 0; i < keys.length; i += parallel) {
    await Promise.all(
      keys.slice(i, i + parallel).map(async (key) => {
        const [agent, day] = key.split("|")
        const r = await get(`market/agent_plans/${agent}/`, { date: day })
        if (r.status === 200 && Array.isArray(r.json)) plans[key] = r.json
        else {
          failed++
          plans[key] = { __status: r.status }
        }
      }),
    )
  }
  log(`day_plans: ${Object.keys(reports).length} monthly reports, ${keys.length} agent-days${failed ? `, Linko failed ${failed}` : ""}`)
  return { reports, plans }
}
