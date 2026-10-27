import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dictionaryListQuery, dictionaryWrite } from "@/lib/dictionaries-schema"
import { knowledgeBaseBodySchema, knowledgeBaseInput, knowledgeBaseScopeOf } from "@/lib/knowledge-base-api"
import { createKnowledgeBaseArticle, listKnowledgeBase } from "@/lib/knowledge-base-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// GET /api/knowledge-base?search&page&pageSize — the grid of "База знания" (demo
// main/knowledge/?search=): {count, results: [{id, name, isActive, positionCount, hasFile,
// updatedAt}]}, id DESC, search in the name. A user restricted by an access right without the
// knowledge base permission sees only the active articles published to their job position.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const query = dictionaryListQuery(new URL(request.url).searchParams, [], 25)
  if (query instanceof NextResponse) return query
  return dictionaryWrite(async () => NextResponse.json(await listKnowledgeBase(query, await knowledgeBaseScopeOf(user))))
}

// POST /api/knowledge-base {name, text?, isActive?, positions?: [jobPositionId], fileId?} —
// demo POST main/knowledge/. 201 with the article; 400 {error, fields} for an unknown position
// or file, 409 for a taken name. Needs the knowledge base permission (settings.manage).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, knowledgeBaseBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => NextResponse.json(await createKnowledgeBaseArticle(knowledgeBaseInput(parsed.data), auth.user.id), { status: 201 }))
}
