import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getLesson } from "@/lib/knowledge-lessons"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const lesson = getLesson(Number((await params).id))
  if (!lesson) return NextResponse.json({ error: "Урок не найден" }, { status: 404 })
  return NextResponse.json(lesson)
}
