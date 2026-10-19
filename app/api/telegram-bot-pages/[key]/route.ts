import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { parseBotPageInput, updateBotPage } from "@/lib/telegram-bot-pages-repo"

const botPageSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  content: z
    .object({
      ru: z.string().optional(),
      uz: z.string().optional(),
      en: z.string().optional(),
    })
    .optional(),
})

type RouteParams = { params: Promise<{ key: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const key = (await params).key
  const parsed = await parseJsonBody(request, botPageSchema)
  if (parsed.error) return parsed.error

  const input = parseBotPageInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 })

  const page = (await updateBotPage(key, input))
  if (!page) return NextResponse.json({ error: "Страница не найдена" }, { status: 404 })
  return NextResponse.json(page)
}
