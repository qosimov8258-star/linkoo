import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createExtraZone, listExtraZones } from "@/lib/zone-extra-repo"

const point = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)])
const createSchema = z.object({
  title: z.string().trim().min(1, "Обязательное поле").max(255),
  parent: z.string().trim().max(255).optional().default(""),
  branch: z.string().trim().max(255).optional().default(""),
  updateMarketBorder: z.boolean().optional().default(false),
  polygon: z.array(point).min(3, "Нарисуйте зону на карте").max(5000),
})

// GET /api/zone-extra — zones drawn on the territory page.
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listExtraZones())
}

// POST /api/zone-extra {title, parent, branch, updateMarketBorder, polygon} — a new zone.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, createSchema)
  if (parsed.error) return parsed.error
  const { title, parent, branch, updateMarketBorder, polygon } = parsed.data
  const existing = await listExtraZones()
  if (existing.some((zone) => zone.title.toLowerCase() === title.toLowerCase())) return NextResponse.json({ error: "Зона с таким названием уже есть" }, { status: 400 })
  return NextResponse.json(await createExtraZone({ title, parent, branch, updateMarketBorder, ring: polygon }), { status: 201 })
}
