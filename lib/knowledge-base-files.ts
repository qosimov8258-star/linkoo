import "server-only"

import { createHash } from "node:crypto"

import { getDb } from "@/lib/db"
import { DictionaryError, fieldError } from "@/lib/dictionaries-schema"
import { removeStaleKnowledgeBaseUploads, type KnowledgeBaseScope } from "@/lib/knowledge-base-repo"
import { ensureKnowledgeBaseSchema } from "@/lib/knowledge-base-schema"
import { KB_FILE_MAX_BYTES, KB_FILE_NAME_MAX, KB_MESSAGES, knowledgeBaseFileUrl, type KnowledgeBaseFile } from "@/lib/knowledge-base-types"

// The PDF of an article (demo POST main/file/, field `file`). Uploaded on its own first
// (multipart, ≤ KB_FILE_MAX_BYTES, the bytes must be a PDF: "%PDF-"), stored in Postgres and
// attached by the article's save (lib/knowledge-base-repo.ts claimFile). Served only through
// GET /api/knowledge-base/files/[id] to a reader of that article.

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

/** Multipart overhead allowed on top of the file (boundaries, part headers, the file name). */
const MULTIPART_SLACK = 64 * 1024

/**
 * The `file` part of a multipart upload (demo field name), read with a hard byte cap on what
 * actually arrives (the edge only sees Content-Length). Throws the field error to answer.
 */
export async function readUploadedFile(request: Request): Promise<{ bytes: Uint8Array; name: string }> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^multipart\/form-data\b/i.test(contentType)) throw fieldError("file", KB_MESSAGES.fileMissing)
  const max = KB_FILE_MAX_BYTES + MULTIPART_SLACK
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > max) throw new DictionaryError(KB_MESSAGES.fileTooLarge, 413, { file: KB_MESSAGES.fileTooLarge })
  const chunks: Uint8Array[] = []
  let total = 0
  if (request.body) {
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => {})
        throw new DictionaryError(KB_MESSAGES.fileTooLarge, 413, { file: KB_MESSAGES.fileTooLarge })
      }
      chunks.push(value)
    }
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  let form: FormData
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData()
  } catch {
    throw fieldError("file", KB_MESSAGES.fileMissing)
  }
  const file = form.get("file")
  if (!file || typeof file === "string") throw fieldError("file", KB_MESSAGES.fileMissing)
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }
}

export function isPdf(bytes: Uint8Array): boolean {
  // A PDF may have a few junk bytes before the header; Acrobat accepts it within 1024 bytes.
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024)
  for (let start = 0; start <= limit; start++) {
    if (PDF_MAGIC.every((value, index) => bytes[start + index] === value)) return true
  }
  return false
}

/** A safe display name: no path, no control / invisible characters, ≤ KB_FILE_NAME_MAX, ".pdf". */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ""
  let name = base
    .normalize("NFC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}"<>|*?:]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!name || name === "." || name === "..") name = "document.pdf"
  if (!/\.pdf$/i.test(name)) name = `${name}.pdf`
  if (name.length > KB_FILE_NAME_MAX) name = `${name.slice(0, KB_FILE_NAME_MAX - 4).trimEnd()}.pdf`
  return name
}

/** Stores an uploaded PDF of `actorId` (400 / 413 / 415 field errors). */
export async function saveKnowledgeBaseFile(bytes: Uint8Array, fileName: string, actorId: number): Promise<KnowledgeBaseFile> {
  if (!bytes.length) throw fieldError("file", KB_MESSAGES.fileEmpty)
  if (bytes.length > KB_FILE_MAX_BYTES) throw new DictionaryError(KB_MESSAGES.fileTooLarge, 413, { file: KB_MESSAGES.fileTooLarge })
  if (!isPdf(bytes)) throw new DictionaryError(KB_MESSAGES.fileNotPdf, 415, { file: KB_MESSAGES.fileNotPdf })
  await ensureKnowledgeBaseSchema()
  await removeStaleKnowledgeBaseUploads()
  const name = cleanFileName(fileName)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const row = (await getDb()
    .prepare(
      `INSERT INTO knowledge_base_files (name, content_type, size_bytes, sha256, data, created_by)
       VALUES (@name, 'application/pdf', @size, @sha256, @data, @actorId) RETURNING id`,
    )
    .get({ name, size: bytes.length, sha256, data: Buffer.from(bytes), actorId })) as { id: number }
  const id = Number(row.id)
  return { id, name, size: bytes.length, url: knowledgeBaseFileUrl(id) }
}

export type StoredKnowledgeBaseFile = { data: Buffer; name: string; contentType: string }

/**
 * The bytes of a file visible in `scope`: a reader of every article may open any file of an
 * article and their own unattached uploads; anyone else only the files of the active articles
 * published to their position. Null when missing or not visible.
 */
export async function readKnowledgeBaseFile(id: number, scope: KnowledgeBaseScope, actorId: number): Promise<StoredKnowledgeBaseFile | null> {
  await ensureKnowledgeBaseSchema()
  const row = (await getDb()
    .prepare(
      `SELECT f.data, f.name, f.content_type, f.created_by, a.id AS article_id, a.active,
              (SELECT COUNT(*)::int FROM knowledge_base_article_positions l WHERE l.article_id = a.id) AS position_count,
              EXISTS (SELECT 1 FROM knowledge_base_article_positions l WHERE l.article_id = a.id AND l.position_id = @positionId) AS own_position
         FROM knowledge_base_files f
         LEFT JOIN knowledge_base_articles a ON a.file_id = f.id
        WHERE f.id = @id`,
    )
    .get({ id, positionId: scope.all ? 0 : (scope.positionId ?? 0) })) as
    | {
        data: Buffer
        name: string
        content_type: string
        created_by: number | null
        article_id: number | null
        active: number | null
        position_count: number
        own_position: boolean
      }
    | undefined
  if (!row) return null
  const file = { data: row.data, name: row.name, contentType: row.content_type }
  if (!row.article_id) return Number(row.created_by) === actorId ? file : null
  if (scope.all) return file
  const published = Number(row.active) === 1 && (Number(row.position_count) === 0 || row.own_position === true)
  return published ? file : null
}
