import { NextResponse } from "next/server"
import { z } from "zod"

import { hashPassword, verifyPassword } from "@/lib/auth"
import { passwordProblem } from "@/lib/auth-policy"
import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { revokeAllSessionsForUser } from "@/lib/user-sessions-repo"

const schema = z.object({
  currentPassword: z.string({ error: "Введите текущий пароль" }).min(1, { error: "Введите текущий пароль" }).max(200),
  newPassword: z.string({ error: "Введите новый пароль" }).min(1, { error: "Введите новый пароль" }).max(200, { error: "Пароль слишком длинный" }),
})

// PUT /api/auth/password {currentPassword, newPassword} — the signed-in user
// changes their own password. Every other session of the account is revoked;
// the current one stays signed in.
export async function PUT(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const parsed = await parseBody(request, schema)
  if (parsed.error) return parsed.error
  const { currentPassword, newPassword } = parsed.data

  const db = getDb()
  const row = (await db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id)) as { password_hash: string } | undefined
  if (!row) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return NextResponse.json({ error: "Текущий пароль указан неверно" }, { status: 400 })
  }
  const problem = passwordProblem(newPassword, user.username)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "Новый пароль должен отличаться от текущего" }, { status: 400 })
  }

  await db
    .prepare("UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now') WHERE id = ?")
    .run(await hashPassword(newPassword), user.id)
  const revoked = await revokeAllSessionsForUser(user.id, user.sessionId)
  return NextResponse.json({ ok: true, revokedSessions: revoked })
}

export const POST = PUT
