import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createKnowledgeBaseArticle, listKnowledgeBaseArticles } from "@/lib/knowledge-base-repo"

const knowledgeBaseArticleSchema = z.object({
  name: z.string().trim().min(1),
  text: z.string().optional(),
  active: z.boolean().optional(),
  roles: z.array(z.string()).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listKnowledgeBaseArticles()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, knowledgeBaseArticleSchema)
  if (parsed.error) return parsed.error

  const article = (await createKnowledgeBaseArticle({
    name: parsed.data.name,
    text: parsed.data.text ?? "",
    active: parsed.data.active ?? false,
    roles: parsed.data.roles ?? [],
  }))
  return NextResponse.json(article, { status: 201 })
}
