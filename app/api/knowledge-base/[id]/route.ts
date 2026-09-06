import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteKnowledgeBaseArticle, updateKnowledgeBaseArticle } from "@/lib/knowledge-base-repo"

const knowledgeBaseArticleSchema = z.object({
  name: z.string().trim().min(1),
  text: z.string().optional(),
  active: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, knowledgeBaseArticleSchema)
  if (parsed.error) return parsed.error

  const article = (await updateKnowledgeBaseArticle(id, {
    name: parsed.data.name,
    text: parsed.data.text ?? "",
    active: parsed.data.active ?? false,
    roles: parsed.data.roles ?? [],
  }))
  if (!article) return NextResponse.json({ error: "Статья не найдена" }, { status: 404 })
  return NextResponse.json(article)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteKnowledgeBaseArticle(id))
  if (!ok) return NextResponse.json({ error: "Статья не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
