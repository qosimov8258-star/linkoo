import { NextResponse } from "next/server"
import { z } from "zod"

import { getClassificationClasses, saveClassificationClasses } from "@/lib/client-classification-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({
  classes: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Обязательное поле").max(100, "Слишком длинное значение"),
        amount: z.number({ error: "Введите число" }).positive("Сумма должна быть больше нуля").max(1e13, "Слишком большое значение"),
      }),
    )
    .min(1, "Добавьте хотя бы один класс")
    .max(30),
})

// GET /api/client-classification/classes — the classes of "Классификация и динамика клиентов".
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await getClassificationClasses())
}

// PUT /api/client-classification/classes {classes:[{name, amount}]} — replaces the whole list.
export async function PUT(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await saveClassificationClasses(parsed.data.classes))
}
