// Signs in as limited employees and probes what they can read / change.
const BASE = "http://localhost:3001"
async function signIn(username, password, newPassword) {
  let r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username, password: newPassword, remember: true }) })
  if (r.status === 401) r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username, password, remember: true }) })
  let cookie = r.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ")
  const me = await r.json()
  if (me.mustChangePassword) {
    const c = await fetch(BASE + "/api/auth/password", { method: "PUT", headers: { cookie, origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: password, newPassword }) })
    console.log("pwchange", c.status)
    return signIn(username, password, newPassword)
  }
  return cookie
}
const call = async (cookie, m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { cookie, origin: BASE, "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) })
  return [r.status, (await r.text()).slice(0, 110)]
}
const users = { agent: ["javlon.murodov76", "Zilol-2102-xodim"], deliverer: ["sanjar.nazarov68", "Zilol-2094-xodim"], keeper: ["ibrohim.olimov57", "Zilol-2083-xodim"], cashier: ["mansur.rahimov4", "Zilol-2030-xodim"] }
const probes = [
  ["GET", "/api/salary-records?month=10&year=2026"],
  ["GET", "/api/employees"],
  ["GET", "/api/cash/cashboxes"],
  ["GET", "/api/balances/pnl?from=2026-10-01&to=2026-10-31"],
  ["GET", "/api/balances/management?from=2026-10-01&to=2026-10-31"],
  ["GET", "/api/access-rights"],
  ["GET", "/api/users"],
  ["GET", "/api/auth-logs"],
  ["POST", "/api/cash/operations", { kind: "expense", date: "2026-10-31 12:00:00", cashboxId: 1, branch: "Toshkent bosh zavod", organization: "Zilol Ichimliklar MChJ", categoryId: 10, amount: 1000 }],
  ["PUT", "/api/access-rights/7", { name: "Savdo agenti", capabilityIds: [1, 2, 3, 4, 5, 6, 7, 8] }],
  ["DELETE", "/api/clients/999999"],
  ["POST", "/api/write-offs", { warehouse: "Xom ashyo ombori", date: "2026-10-31", reason: "x", items: [] }],
  ["POST", "/api/salary-records", { month: 10, year: 2026, currency: "SUM", salaries: [] }],
  ["PUT", "/api/employees/1", {}],
  ["POST", "/api/orders", { items: [] }],
]
for (const [who, [u, p]] of Object.entries(users)) {
  const cookie = await signIn(u, p, p + "-New9")
  console.log("=====", who, u)
  for (const [m, path, b] of probes) console.log("  ", ...(await call(cookie, m, path, b)), m, path)
}
