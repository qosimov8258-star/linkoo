import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  // the employee record that owns this login carries the person's real name (shown on the dashboard card)
  const db = getDb()
  const employee = (await db
    .prepare("SELECT first_name, last_name, branch_ids FROM employees WHERE login = ? ORDER BY id LIMIT 1")
    .get(user.username)) as { first_name: string; last_name: string; branch_ids: string } | undefined
  const fullName = employee ? `${employee.first_name} ${employee.last_name}`.trim() : ""
  // the account menu lists the branches this employee works with (the reference's `user.branch`), in id order
  let branchIds: number[] = []
  try {
    const parsed = JSON.parse(employee?.branch_ids ?? "[]") as unknown
    if (Array.isArray(parsed)) branchIds = parsed.filter((id): id is number => Number.isInteger(id))
  } catch {}
  const branches = branchIds.length
    ? ((await db.prepare("SELECT id, name FROM branches WHERE id = ANY(@ids::int[]) ORDER BY id").all({ ids: branchIds })) as { id: number; name: string }[])
    : []
  return NextResponse.json({ ...user, ...(fullName ? { fullName } : {}), branches })
}
