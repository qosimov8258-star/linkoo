import { NextResponse } from "next/server"

import { dictionaryWrite } from "@/lib/dictionaries-schema"
import { readUploadedFile, saveKnowledgeBaseFile } from "@/lib/knowledge-base-files"
import { requireRole } from "@/lib/rbac"

// POST /api/knowledge-base/files — multipart/form-data with the PDF in field `file` (demo POST
// main/file/), ≤ 2 MB, the bytes must be a PDF. 201 {id, name, size, url}; the id is attached
// by the article's save (fileId), and only by the user who uploaded it. 400 no file / empty,
// 413 too large, 415 not a PDF. Needs the knowledge base permission (settings.manage).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  return dictionaryWrite(async () => {
    const upload = await readUploadedFile(request)
    return NextResponse.json(await saveKnowledgeBaseFile(upload.bytes, upload.name, auth.user.id), { status: 201 })
  })
}
