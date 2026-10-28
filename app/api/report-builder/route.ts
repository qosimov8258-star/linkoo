import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { builderFilterOptions, runBuilderReport, type BuilderInput } from "@/lib/report-builder-repo"

const isDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

// POST /api/report-builder {kind: "sales" | "visits", tab, from, to, columns[], vertical[], horizontal[], filters{}, showTotals}
// → {headers, rows, totals, unsupported, count}; GET ?kind=… → filter option lists.
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || (body.kind !== "sales" && body.kind !== "visits")) return NextResponse.json({ error: "kind must be sales or visits" }, { status: 400 })
  if (!isDay(body.from) || !isDay(body.to) || body.from > body.to) return NextResponse.json({ error: "Укажите корректный период" }, { status: 400 })
  const columns = strings(body.columns)
  if (!columns.length) return NextResponse.json({ error: "Выберите хотя бы одну колонку" }, { status: 400 })
  const filters: Record<string, string> = {}
  if (body.filters && typeof body.filters === "object") for (const [key, value] of Object.entries(body.filters as Record<string, unknown>)) if (typeof value === "string") filters[key] = value
  const input: BuilderInput = {
    kind: body.kind,
    tab: typeof body.tab === "string" ? body.tab : "",
    from: body.from,
    to: body.to,
    columns,
    vertical: strings(body.vertical),
    horizontal: strings(body.horizontal),
    filters,
    showTotals: body.showTotals !== false,
  }
  return NextResponse.json(await runBuilderReport(input))
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const kind = new URL(request.url).searchParams.get("kind")
  if (kind !== "sales" && kind !== "visits") return NextResponse.json({ error: "kind must be sales or visits" }, { status: 400 })
  return NextResponse.json(await builderFilterOptions(kind))
}
