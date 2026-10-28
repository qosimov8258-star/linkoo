import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listLessonCategories } from "@/lib/knowledge-lessons"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(listLessonCategories())
}
