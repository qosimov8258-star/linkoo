import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dictionaryWrite, parseDictionaryId } from "@/lib/dictionaries-schema"
import { knowledgeBaseBodySchema, knowledgeBaseInput, knowledgeBaseScopeOf } from "@/lib/knowledge-base-api"
import { deleteKnowledgeBaseArticle, getKnowledgeBaseArticle, updateKnowledgeBaseArticle } from "@/lib/knowledge-base-repo"
import { KB_MESSAGES } from "@/lib/knowledge-base-types"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: KB_MESSAGES.notFound }, { status: 404 })

// GET /api/knowledge-base/[id] — demo GET main/knowledge/<id>/: {id, name, text, isActive,
// positions: [{id, name}], file: {id, name, size, url} | null, createdAt, updatedAt}.
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseDictionaryId((await params).id)
  if (!id) return invalidIdResponse()
  return dictionaryWrite(async () => {
    const article = await getKnowledgeBaseArticle(id, await knowledgeBaseScopeOf(user))
    return article ? NextResponse.json(article) : notFound()
  })
}

// PUT /api/knowledge-base/[id] {name, text?, isActive?, positions?, fileId?} — demo PUT
// main/knowledge/<id>/. Omitted fields keep their value; fileId null removes the file.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, knowledgeBaseBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => {
    const article = await updateKnowledgeBaseArticle(id, knowledgeBaseInput(parsed.data), auth.user.id)
    return article ? NextResponse.json(article) : notFound()
  })
}

// DELETE /api/knowledge-base/[id] — demo DELETE main/knowledge/<id>; removes the position links
// and the attached file too (nothing else references an article).
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return invalidIdResponse()
  return dictionaryWrite(async () => ((await deleteKnowledgeBaseArticle(id)) ? NextResponse.json({ ok: true }) : notFound()))
}
