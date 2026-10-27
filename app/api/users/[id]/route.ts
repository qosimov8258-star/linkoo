import { NextResponse } from "next/server"
import { z } from "zod"

import { passwordProblem } from "@/lib/auth-policy"
import { nameField, parseBody, parseId } from "@/lib/auth-request"
import { requireRole } from "@/lib/rbac"
import { deleteUser, getUser, updateUser, UserError } from "@/lib/users-repo"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Пользователь не найден" }

const updateUserSchema = z.object({
  displayName: nameField("Введите имя пользователя").optional(),
  role: z.enum(["admin", "manager", "viewer"], { error: "Неизвестная роль" }).optional(),
  accessRightId: z.number({ error: "Права доступа не найдены" }).int().positive().max(2_147_483_647, { error: "Права доступа не найдены" }).nullable().optional(),
  employeeId: z.number({ error: "Сотрудник не найден" }).int().positive().max(2_147_483_647).nullable().optional(),
  password: z.string().max(200, { error: "Пароль слишком длинный" }).optional(),
})

export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const id = parseId((await params).id)
  const user = id ? await getUser(id) : null
  if (!user) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(user)
}

// PATCH /api/users/[id] {displayName?, role?, accessRightId?, employeeId?, password?}
// — an administrator edits an account. `password` resets it: the user must
// choose a new one at the next sign-in, and all their sessions are ended (also
// when the role or access right changes, or the account is linked to an
// employee without system access). `employeeId: null` unlinks the employee.
// Refused: one's own account linked to an employee without system access
// (400); the last administrator who can sign in demoted or linked to such an
// employee (409).
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })

  const parsed = await parseBody(request, updateUserSchema)
  if (parsed.error) return parsed.error
  const input = parsed.data

  const target = await getUser(id)
  if (!target) return NextResponse.json(NOT_FOUND, { status: 404 })
  if (input.password !== undefined) {
    const weak = passwordProblem(input.password, target.username)
    if (weak) return NextResponse.json({ error: weak }, { status: 400 })
  }
  if (id === auth.user.id && input.role !== undefined && input.role !== "admin") {
    return NextResponse.json({ error: "Нельзя снять с себя роль администратора" }, { status: 400 })
  }

  try {
    // Linking one's own account to an employee who may not sign in, and
    // demoting / cutting the last administrator, are refused inside the update.
    const user = await updateUser(id, input, { actorId: auth.user.id })
    if (!user) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(user)
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}

export const PUT = PATCH

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  if (id === auth.user.id) return NextResponse.json({ error: "Нельзя удалить самого себя" }, { status: 400 })

  try {
    const ok = await deleteUser(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
