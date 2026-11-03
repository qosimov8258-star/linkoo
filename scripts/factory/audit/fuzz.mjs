// Sends malformed / hostile bodies to every write endpoint of the LOCAL factory server and
// records anything that is not a clean 4xx (5xx = unhandled, 2xx = junk accepted).
import fs from "fs"
import { login } from "../api.mjs"
import { apiRoutes, auditOut } from "./api-routes.mjs"

const BASE = "http://localhost:3001"
const SKIP = /^(auth\/|integrations|telegram|mobile|user-sessions|users\b|cron|backup|db-|admin)/
const only = process.argv[2] ? new RegExp(process.argv[2]) : null

const BODIES = {
  invalidJson: "{",
  emptyObj: {},
  array: [1, 2],
  nullBody: null,
  hostile: {
    name: "", title: " ", code: "x".repeat(5000), price: -1, amount: 1e308, sum: "abc", quantity: -5, qty: "NaN",
    date: "not-a-date", from: "2026-13-45", to: "x", id: "abc", ids: "x", items: "x", rows: [{}], lines: [null],
    clientId: "abc", client_id: -1, productId: 1e20, warehouseId: "x", cashboxId: {}, currencyId: [], employeeId: "'; drop table x;--",
    status: 12345, type: {}, comment: "<script>alert(1)</script>", percent: 1e9, phone: "abc", email: "no",
  },
}

await login()
let cookie
{
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "admin", password: "Zavod-Admin-2026", remember: true }) })
  cookie = r.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ")
}
const out = []
for (const { route, methods: all } of apiRoutes()) {
  if (SKIP.test(route) || (only && !only.test(route))) continue
  const methods = all.filter((m) => m !== "GET")
  const variants = route.includes("[") ? ["999999999", "abc", "-1"] : [null]
  for (const v of variants) {
    const path = "/api/" + route.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, v ?? "")
    for (const method of methods) {
      const bodies = method === "DELETE" ? { none: undefined } : BODIES
      for (const [bname, body] of Object.entries(bodies)) {
        const headers = { cookie, origin: BASE }
        if (body !== undefined) headers["content-type"] = "application/json"
        let status, text
        for (let attempt = 0; attempt < 6; attempt++) { try {
          const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) })
          status = r.status
          text = (await r.text()).slice(0, 240)
        } catch (e) {
          status = -1
          text = e.message
        }
        if (status !== 429) break
        await new Promise((r) => setTimeout(r, 5000)) }
        if (status >= 500 || (status >= 200 && status < 300) || status === -1) {
          const row = { method, path, body: bname, status, text }
          out.push(row)
          console.log(JSON.stringify(row))
        }
      }
    }
  }
}
fs.writeFileSync(`${auditOut()}/fuzz.json`, JSON.stringify(out, null, 1))
console.log("findings", out.length)
