// Every API route of the app with its HTTP methods, read from app/api/**/route.ts:
// [{ route: "orders/[id]", methods: ["GET", "PATCH", "DELETE"] }, …] (sorted by route).
import fs from "fs"
import path from "path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..")

export function apiRoutes() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts") {
        const text = fs.readFileSync(full, "utf8")
        const methods = [...text.matchAll(/export (?:async )?(?:function|const) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1])
        out.push({ route: path.relative(path.join(ROOT, "app/api"), path.dirname(full)).split(path.sep).join("/"), methods })
      }
    }
  }
  walk(path.join(ROOT, "app/api"))
  return out.sort((a, b) => a.route.localeCompare(b.route))
}

/** Output folder of the audit scripts (git-ignored): AUDIT_OUT or .ui-check/audit. */
export function auditOut() {
  const dir = process.env.AUDIT_OUT || path.join(ROOT, ".ui-check/audit")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
