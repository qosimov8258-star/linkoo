import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createUser, listUsers } from "@/lib/users-repo"

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(100),
  password: z.string().min(6).max(200),
  displayName: z.string().trim().min(1).max(200),
  role: z.enum(["admin", "manager", "viewer"]),
})

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  return NextResponse.json(await listUsers())
}

export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, createUserSchema)
  if (parsed.error) return parsed.error

  const user = await createUser(parsed.data)
  if (!user) return NextResponse.json({ error: "Bu login band" }, { status: 409 })
  return NextResponse.json(user, { status: 201 })
}
