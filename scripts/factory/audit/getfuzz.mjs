import { apiRoutes } from "./api-routes.mjs"
const BASE="http://localhost:3001"
const r0 = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ username: "admin", password: "Zavod-Admin-2026", remember: true }) })
const cookie = r0.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ")
const qs = ["", "?page=abc&pageSize=-5&from=bad&to=2026-99-99&ordering=;drop&search=%27%22%3C", "?pageSize=100000000&page=99999999"]
for (const { route, methods } of apiRoutes()) {
  if (!methods.includes("GET") || /^(auth|integrations|telegram|mobile)/.test(route)) continue
  const variants = route.includes("[") ? ["abc", "999999999", "1.5"] : [null]
  for (const v of variants) for (const s of (v ? [""] : qs)) {
    const path = "/api/" + route.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/g, v ?? "") + s
    let st, t
    for (let a=0;a<6;a++){ const r = await fetch(BASE + path, { headers: { cookie } }); st=r.status; t=(await r.text()).slice(0,200); if (st!==429) break; await new Promise(r=>setTimeout(r,5000)) }
    if (st >= 500) console.log(st, path, t)
  }
}
console.log("done")
