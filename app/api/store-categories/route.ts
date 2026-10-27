import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createStoreCategory, listStoreCategories, StoreCategoryError } from "@/lib/store-categories-repo"

const schema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listStoreCategories())
}

// POST /api/store-categories {name} — 409 for a name that exists (case- and space-insensitive).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createStoreCategory({ name: parsed.data.name }), { status: 201 })
  } catch (error) {
    if (error instanceof StoreCategoryError) return NextResponse.json({ error: error.message, field: "name" }, { status: error.status })
    throw error
  }
}
