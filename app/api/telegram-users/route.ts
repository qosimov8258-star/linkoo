import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listTelegramUsers } from "@/lib/telegram-users-repo"

// GET /api/telegram-users → TelegramUser[] ("Пользователи Телеграм бота", demo telegram/users/).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listTelegramUsers())
}
