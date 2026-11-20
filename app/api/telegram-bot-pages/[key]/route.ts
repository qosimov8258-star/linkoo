import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { parseBotPageInput, updateBotPage } from "@/lib/telegram-bot-pages-repo"

const TOO_LONG = "Слишком длинное значение"

// One language of «Редактирование новости»: Заголовок, Описание, Ссылка на статью and Содержание (the reference's
// translations[<lang>][title | description | telegraph_link | body]).
const pageText = z
  .object({
    title: z.string().max(255, TOO_LONG).optional(),
    description: z.string().max(1000, TOO_LONG).optional(),
    telegraphLink: z.string().max(500, TOO_LONG).optional(),
    body: z.string().max(4096, TOO_LONG).optional(),
  })
  .optional()

const botPageSchema = z.object({
  translations: z.object({ ru: pageText, uz: pageText, en: pageText }),
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
