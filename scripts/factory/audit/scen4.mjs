// Персонал: salary after «Зачислить», attendance edge cases, tasks, KPI, positions.
import { api, get, login, rowsOf } from "../api.mjs"
await login()
const q = (m, p, b) => api(m, p, b, { quiet: true }).then((d) => ({ ok: true, d }), (e) => ({ ok: false, status: e.status, d: e.body }))
const show = (label, r) => { console.log(label, r.ok ? "OK" : `ERR ${r.status}`, JSON.stringify(r.d).slice(0, 240)); return r }
const emps = rowsOf(await get("/api/employees"))
const E = emps.find((e) => e.job === "Omborchi")
const rec = async () => rowsOf(await get(`/api/salary-records?month=10&year=2026&all=1`)).find((r) => r.userId === E.id)
const ebal = async () => (await get("/api/balances/employee?pageSize=0&from=2026-10-01&to=2026-10-31")).rows.find((r) => r.id === E.id)?.currencies.SUM
const pnlSalary = async () => {
  const d = await get("/api/pnl-stats?first_begin=2026-10-01&first_end=2026-10-31&second_begin=2026-09-01&second_end=2026-09-30")
  return d.summary.salary.first
}
const r0 = await rec()
console.log("employee", E.id, E.name, "record", r0?.salary, "approved", r0?.isApproved ?? r0?.is_approved, "bal", JSON.stringify(await ebal()), "pnl", await pnlSalary())

// 1. change the salary of an approved (credited and paid) record
show("S1 change approved salary", await q("POST", "/api/salary-records", { month: 10, year: 2026, currency: "SUM", salaries: [{ user: E.id, salary: (r0?.salary ?? 0) + 1_000_000 }] }))
const r1 = await rec()
console.log("  record now", r1?.salary, r1?.totalSalary, "approved", r1?.isApproved ?? r1?.is_approved, "bal", JSON.stringify(await ebal()), "pnl", await pnlSalary())
show("S1b bulk-salary approved", await q("POST", "/api/salary-records/bulk-salary", { month: 10, year: 2026, users: [E.id], salary: 1, currency: "SUM" }))
const r1b = await rec()
console.log("  record now", r1b?.salary, "bal", JSON.stringify(await ebal()))
// put it back
await q("POST", "/api/salary-records", { month: 10, year: 2026, currency: "SUM", salaries: [{ user: E.id, salary: r0?.salary ?? 0 }] })
// 2. unapprove after payout
show("S2 unapprove", await q("POST", "/api/salary-records/change-approve", { month: 10, year: 2026, users: [E.id], is_approved: false }))
console.log("  bal after unapprove", JSON.stringify(await ebal()))
show("S2b approve again", await q("POST", "/api/salary-records/change-approve", { month: 10, year: 2026, users: [E.id], is_approved: true }))
show("S2c approve twice", await q("POST", "/api/salary-records/change-approve", { month: 10, year: 2026, users: [E.id], is_approved: true }))
console.log("  bal after re-approve", JSON.stringify(await ebal()))
// 3. salary for a deactivated / unknown employee, future month copy
show("S3 unknown user", await q("POST", "/api/salary-records", { month: 10, year: 2026, currency: "SUM", salaries: [{ user: 999999, salary: 5 }] }))
show("S4 copy Oct→Nov", await q("POST", "/api/salary-records/copy", { from_month: 10, from_year: 2026, to_month: 11, to_year: 2026, users: [E.id], copy_salary: true, copy_indicator: true }))
show("S4b copy onto itself", await q("POST", "/api/salary-records/copy", { from_month: 10, from_year: 2026, to_month: 10, to_year: 2026, users: [E.id], copy_salary: true, copy_indicator: true }))
show("S5 recalc", await q("POST", "/api/salary-records/recalculate", { month: 10, year: 2026 }))
console.log("  bal after recalc", JSON.stringify(await ebal()))

// attendance
const at = (d, h) => `${d}T${h}:00`
show("A1 out without in", await q("POST", "/api/work-attendance/check-ins", { employeeId: E.id, kind: "out", at: at("2026-10-20", "18:00"), place: "test" }))
show("A2 in in future", await q("POST", "/api/work-attendance/check-ins", { employeeId: E.id, kind: "in", at: at("2027-01-01", "09:00"), place: "test" }))
show("A3 in unknown emp", await q("POST", "/api/work-attendance/check-ins", { employeeId: 999999, kind: "in", at: at("2026-10-20", "09:00") }))
show("A4 bad kind", await q("POST", "/api/work-attendance/check-ins", { employeeId: E.id, kind: "lunch", at: at("2026-10-20", "09:00") }))
show("A5 same key twice (1)", await q("POST", "/api/work-attendance/check-ins", { employeeId: E.id, kind: "in", at: at("2026-10-19", "09:00"), idempotencyKey: "qa-dup-1" }))
show("A5 same key twice (2)", await q("POST", "/api/work-attendance/check-ins", { employeeId: E.id, kind: "in", at: at("2026-10-19", "09:00"), idempotencyKey: "qa-dup-1" }))
show("A6 out before in", await q("POST", "/api/work-attendance/check-ins", { employeeId: E.id, kind: "out", at: at("2026-10-19", "08:00") }))

// tasks
const client = rowsOf(await get("/api/clients"))[0]
show("T1 task past date", await q("POST", "/api/tasks", { title: "QA", clientId: client.id, employeeId: E.id, taskDate: "2020-01-01" }))
show("T2 task empty title", await q("POST", "/api/tasks", { title: "  ", clientId: client.id, employeeId: E.id, taskDate: "2026-11-05" }))
show("T3 task unknown client", await q("POST", "/api/tasks", { title: "QA", clientId: 999999, employeeId: E.id, taskDate: "2026-11-05" }))
show("T4 task bad date", await q("POST", "/api/tasks", { title: "QA", clientId: client.id, employeeId: E.id, taskDate: "2026-02-30" }))

// positions
const jobs = rowsOf(await get("/api/job-positions"))
show("J1 duplicate position", await q("POST", "/api/job-positions", { name: jobs[0].name }))
show("J2 delete used position", await q("DELETE", `/api/job-positions/${jobs[0].id}`))
show("J3 empty position", await q("POST", "/api/job-positions", { name: "" }))

// KPI tasks
show("K1 kpi task empty", await q("POST", "/api/kpi-tasks", {}))
// employee edge
show("E1 employee no name", await q("POST", "/api/employees", { firstName: "", lastName: "" }))
show("E2 employee bad phone", await q("POST", "/api/employees", { firstName: "QA", lastName: "Test", phone: "abc", jobId: jobs[0].id }))
