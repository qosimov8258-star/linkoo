import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dictionaryWrite, parseDictionaryId } from "@/lib/dictionaries-schema"
import { knowledgeBaseScopeOf } from "@/lib/knowledge-base-api"
import { readKnowledgeBaseFile } from "@/lib/knowledge-base-files"
import { KB_MESSAGES } from "@/lib/knowledge-base-types"
import { invalidIdResponse, notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/knowledge-base/files/[id] — the PDF of an article, inline. A reader of the whole
// base opens any article's file (and their own unattached upload); anyone else only the files
// of the active articles published to their job position (404 otherwise).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseDictionaryId((await params).id)
  if (!id) return invalidIdResponse()
  return dictionaryWrite(async () => {
    const file = await readKnowledgeBaseFile(id, await knowledgeBaseScopeOf(user), user.id)
    if (!file) return NextResponse.json({ error: KB_MESSAGES.fileNotFound }, { status: 404 })
    const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
    const encoded = encodeURIComponent(file.name).replace(/['()*!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    return new NextResponse(new Uint8Array(file.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(file.data.length),
        "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })
}
