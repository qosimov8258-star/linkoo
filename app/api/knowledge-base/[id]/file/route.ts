import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getKnowledgeBaseFile, KNOWLEDGE_BASE_FILE_MAX_BYTES, setKnowledgeBaseFile } from "@/lib/knowledge-base-repo"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const file = await getKnowledgeBaseFile(Number((await params).id))
  if (!file) return NextResponse.json({ error: "Файл не найден" }, { status: 404 })
  return new NextResponse(new Uint8Array(file.data), {
    headers: { "Content-Type": file.fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}` },
  })
}

/** Raw file body (the reference accepts report/document files: pdf, txt, xlsx, ...); the original name goes in the `x-file-name` header (URI-encoded). */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const data = Buffer.from(await request.arrayBuffer())
  if (data.length === 0) return NextResponse.json({ error: "Файл пустой" }, { status: 400 })
  if (data.length > KNOWLEDGE_BASE_FILE_MAX_BYTES) return NextResponse.json({ error: "Файл слишком большой (максимум 10 МБ)" }, { status: 413 })
  const fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "").slice(0, 200) || "file.pdf"
  if (!(await setKnowledgeBaseFile(Number((await params).id), fileName, data))) return NextResponse.json({ error: "Статья не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true, fileName })
}
