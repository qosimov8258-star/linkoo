import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"

// GET /api/attendance-users → the users of "Посещения на работу" in the reference's order: [{ id, name }].
// Employees missing from attendance_user_order (and every employee while the table is empty) follow in id order.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const db = getDb()
  await db.exec("CREATE TABLE IF NOT EXISTS attendance_user_order (employee_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)")
  const rows = (await db
    .prepare(
      `SELECT e.id, btrim(btrim(coalesce(e.first_name, '')) || ' ' || btrim(coalesce(e.last_name, ''))) AS name
       FROM employees e LEFT JOIN attendance_user_order o ON o.employee_id = e.id
       WHERE e.active = 1
       ORDER BY COALESCE(o.position, 100000 + e.id), e.id`,
    )
    .all()) as Array<{ id: number; name: string }>
  return NextResponse.json(rows.map((row) => ({ id: Number(row.id), name: row.name })).filter((row) => row.name))
}
