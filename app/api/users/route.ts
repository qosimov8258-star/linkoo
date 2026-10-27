import { NextResponse } from "next/server"
import { z } from "zod"

import { normalizeUsername, passwordProblem, usernameProblem } from "@/lib/auth-policy"
import { nameField, parseBody } from "@/lib/auth-request"
import { requireRole } from "@/lib/rbac"
import { createUser, listUsers, UserError } from "@/lib/users-repo"

const createUserSchema = z
  .object({
    username: z.string({ error: "Введите логин" }).max(200, { error: "Логин должен содержать от 3 до 64 символов" }),
    password: z.string({ error: "Введите пароль" }).max(200, { error: "Пароль слишком длинный" }),
    displayName: nameField("Введите имя пользователя"),
    role: z.enum(["admin", "manager", "viewer"], { error: "Неизвестная роль" }),
    accessRightId: z.number({ error: "Права доступа не найдены" }).int().positive().max(2_147_483_647).nullable().optional(),
    employeeId: z.number({ error: "Сотрудник не найден" }).int().positive().max(2_147_483_647).nullable().optional(),
  })
  .transform((value, ctx) => {
    const username = normalizeUsername(value.username)
    const loginProblem = usernameProblem(username)
    if (loginProblem) {
      ctx.addIssue({ code: "custom", message: loginProblem, path: ["username"] })
      return z.NEVER
    }
    const weak = passwordProblem(value.password, username)
    if (weak) {
      ctx.addIssue({ code: "custom", message: weak, path: ["password"] })
      return z.NEVER
    }
    return { ...value, username }
  })

export async function GET() {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  return NextResponse.json(await listUsers())
}

// POST /api/users {username, password, displayName, role, accessRightId?, employeeId?}
// — the login is stored normalized (NFKC, lower case, letters/digits/._-@ only)
// and is unique case-insensitively; a taken login (also under concurrent
// requests) → 409. The password is chosen by the administrator, so the user
// must replace it at the first sign-in (until then the API answers 403
// passwordChangeRequired). `employeeId` ties the account to an employee
// (Сотрудники): a deactivated employee or one without "Доступ к системе"
// cannot sign in; an employee already linked to another account → 409.
export async function POST(request: Request) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, createUserSchema)
  if (parsed.error) return parsed.error

  try {
    const user = await createUser({ ...parsed.data, mustChangePassword: true })
    if (!user) return NextResponse.json({ error: "Этот логин уже занят" }, { status: 409 })
    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
