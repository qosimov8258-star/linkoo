import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { PgDb } from "@/lib/db"
import { catalogDb } from "@/lib/products-schema"
import { dictionaryKey, type DictionaryUsage } from "@/components/analytics/dictionaries-data"
import { parseIdSegment } from "@/lib/validation"

// Shared server plumbing of the three catalog dictionaries (Типы продуктов, Ед.измерения,
// Бренд): the lazy schema additions, errors, list-query parsing and pictures.
// The tables themselves (product_types, units_of_measure, brands) come from lib/db.ts.

// ---------------------------------------------------------------------------
// Schema (lazy, idempotent)
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

declare global {
  var __linkoDictionariesSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  // fin_key() / fin_ts() + the catalog columns (raw_materials.subcategory, …) the cascade uses.
  const db = await catalogDb()
  await db.exec(`
    ALTER TABLE product_types ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE product_types ADD COLUMN IF NOT EXISTS image TEXT;
    ALTER TABLE units_of_measure ADD COLUMN IF NOT EXISTS is_weighted INTEGER NOT NULL DEFAULT 0;
  `)
}

/** Ensures the dictionary columns (once per process) and returns the db. */
export async function dictionariesDb(): Promise<PgDb> {
  const db = await catalogDb()
  if (globalThis.__linkoDictionariesSchema?.version !== SCHEMA_VERSION) {
    const ready = install().catch((error) => {
      globalThis.__linkoDictionariesSchema = undefined
      throw error
    })
    globalThis.__linkoDictionariesSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoDictionariesSchema!.ready
  return db
}

/** Serialises the writes of one dictionary (uniqueness check + insert / rename / delete). */
export async function lockDictionary(tx: PgDb, kind: "product_types" | "units_of_measure" | "brands"): Promise<void> {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(@key)) AS ok").get({ key: `linko:dictionary:${kind}` })
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const REQUIRED = "Обязательное поле"
export const DELETE_BLOCKED = "Удаление невозможно из-за связи с другими данными"

export class DictionaryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly fields?: Record<string, string>,
    readonly usage?: DictionaryUsage[],
  ) {
    super(message)
  }
}

/** JSON response of a DictionaryError ({error, fields?, usage?}); null for other errors. */
export function dictionaryErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof DictionaryError)) return null
  return NextResponse.json(
    { error: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.usage ? { usage: error.usage } : {}) },
    { status: error.status },
  )
}

/** Runs a write and maps DictionaryError to its response. */
export async function dictionaryWrite(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (error) {
    const response = dictionaryErrorResponse(error)
    if (response) return response
    throw error
  }
}

export function fieldError(field: string, message: string, status = 400): DictionaryError {
  return new DictionaryError(message, status, { [field]: message })
}

export function parseDictionaryId(value: string): number | null {
  // Canonical digits only ("0x10" / "1e1" never resolve to another record).
  return parseIdSegment(value)
}

/** Organizations exist → the dialog requires one (like the warehouse branch / manager). */
export async function organizationRequired(db: PgDb): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS hit FROM organizations LIMIT 1").get()
  return Boolean(row)
}

export const ORGANIZATION_NOT_FOUND = "Организация не найдена"

/** The stored spelling of an organization (organizations.name by fin_key), null when there is none. */
export async function findOrganizationName(db: PgDb, name: string): Promise<string | null> {
  if (!name.trim()) return null
  const row = (await db.prepare("SELECT name FROM organizations WHERE fin_key(name) = fin_key(@name) ORDER BY id LIMIT 1").get({ name })) as { name: string } | undefined
  return row?.name ?? null
}

/**
 * "Организация" of a dictionary row: "" stays "" (required once organizations exist), any other
 * value must be an organization (400 "Организация не найдена") and is stored in its own spelling.
 * `current` = the stored value of the edited row: an unchanged legacy value is kept as is.
 */
export async function resolveOrganization(db: PgDb, organization: string, current?: string | null): Promise<string> {
  const value = organization.trim()
  if (!value) {
    if (await organizationRequired(db)) throw fieldError("organization", REQUIRED)
    return ""
  }
  if (current !== undefined && current !== null && dictionaryKey(current) === dictionaryKey(value)) return current.trim()
  const found = await findOrganizationName(db, value)
  if (!found) throw fieldError("organization", ORGANIZATION_NOT_FOUND)
  return found
}

// ---------------------------------------------------------------------------
// Body fields
// ---------------------------------------------------------------------------

export const nameSchema = z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255, "Не более 255 символов")
/** A positive int4 id as a number or a digits-only string; "" / 0 / null = none. No coercion of
 * booleans or arrays (parentId: true is a 400, never parent 1). */
export const optionalId = z
  .preprocess(
    (value) => (value === "" || value === 0 ? null : value),
    z
      .union([z.number(), z.string().trim().regex(/^\d+$/, "Неверный идентификатор").transform(Number), z.null()], { error: "Неверный идентификатор" })
      .pipe(z.number().int("Неверный идентификатор").positive("Неверный идентификатор").max(2_147_483_647, "Неверный идентификатор").nullable()),
  )
  .optional()
/** Demo serializers send {value} objects from the search fields. */
export const idOrObject = z.union([optionalId, z.object({ value: optionalId }).transform((value) => value.value ?? null)]).optional()
export const organizationSchema = z
  .union([z.string().trim().max(255, "Не более 255 символов"), z.null(), z.object({ name: z.string().trim().max(255) }).transform((value) => value.name)])
  .optional()
/** A data URL (new picture), null / "" (remove) or omitted (keep). */
export const imageSchema = z.union([z.string(), z.null()]).optional()

const IMAGE_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/
/** ~2.2 MB of picture (the dialog resizes to DICTIONARY_IMAGE_MAX_SIDE first). */
export const MAX_IMAGE_LENGTH = 3_000_000

/** Validated image input: string = new picture, null = remove, undefined = keep. */
export function imageInput(value: string | null | undefined, field = "image"): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value.trim() === "") return null
  const data = value.trim()
  if (data.length > MAX_IMAGE_LENGTH) throw fieldError(field, "Изображение слишком большое")
  if (!IMAGE_PATTERN.test(data)) throw fieldError(field, "Неверный формат изображения")
  return data
}

/** GET …/[id]/image: the stored data URL as a picture (404 when none). */
export function imageResponse(stored: string | null | undefined, versioned: boolean): NextResponse {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(stored ?? "")
  if (!match) return NextResponse.json({ error: "Изображение не найдено" }, { status: 404 })
  return new NextResponse(new Uint8Array(Buffer.from(match[2], "base64")), {
    headers: {
      "Content-Type": match[1] === "image/jpg" ? "image/jpeg" : match[1],
      "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
    },
  })
}

/** Picture URL of a stored value: data URL → the image route, http(s) / "/" → as is. */
export function storedImageUrl(stored: string | null | undefined, route: string, version: string): string | null {
  const value = (stored ?? "").trim()
  if (value.startsWith("data:image/")) return `${route}?v=${encodeURIComponent(version)}`
  if (/^(https?:\/\/|\/)/.test(value)) return value
  return null
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type DictionaryListQuery = { search: string; ordering: string; page: number; pageSize: number }

/** ?search ?ordering ?page ?pageSize (ordering = one of `orderings`, "-" = descending). */
export function dictionaryListQuery(params: URLSearchParams, orderings: readonly string[], defaultPageSize = 25): DictionaryListQuery | NextResponse {
  const allowed = new Set(orderings.flatMap((field) => [field, `-${field}`]))
  const schema = z.object({
    search: z.string().trim().max(200).optional(),
    ordering: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || allowed.has(value), "Неизвестная сортировка"),
    page: z.coerce.number().int().min(1).max(1_000_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(2000).optional(),
  })
  const raw = {
    search: params.get("search") ?? params.get("name") ?? undefined,
    ordering: params.get("ordering") ?? undefined,
    page: params.get("page") || undefined,
    pageSize: params.get("pageSize") || params.get("page_size") || undefined,
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: parsed.error.flatten() }, { status: 400 })
  return { search: parsed.data.search ?? "", ordering: parsed.data.ordering ?? "", page: parsed.data.page ?? 1, pageSize: parsed.data.pageSize ?? defaultPageSize }
}

/** The grid shape is opt-in: ?view=tree, ?paged=1, ?page or ?pageSize. */
export function wantsDictionaryPage(params: URLSearchParams): boolean {
  return params.get("view") === "tree" || params.get("paged") === "1" || params.has("page") || params.has("pageSize") || params.has("page_size")
}

/** SELECT expression: local ISO creation time ("" when unknown). */
export const CREATED_ISO_SQL = `COALESCE(to_char(fin_ts(NULLIF(created_at, '')), 'YYYY-MM-DD"T"HH24:MI:SS'), '')`
/** ORDER BY expression of the creation time. */
export const CREATED_ORDER_SQL = "fin_ts(NULLIF(created_at, ''))"

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "08 окт. 2026" of a local ISO time. */
export function createdDateLabel(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return ""
  return `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`
}

const NAME_COLLATOR = new Intl.Collator("en", { ignorePunctuation: true })

/** Name comparison for in-memory sorting, like the demo's DB collation (punctuation ignored, digits as text, lower case first). */
export function compareNames(a: string, b: string): number {
  return NAME_COLLATOR.compare(a, b)
}

/** One level of a tree sorted by `ordering` (fields: name, division, created_date), id as tie-break. */
export function sortNodes<T extends { id: number; name: string; organization?: string; createdAt: string; position?: number }>(nodes: T[], ordering: string): T[] {
  const desc = ordering.startsWith("-")
  const field = desc ? ordering.slice(1) : ordering
  const direction = desc ? -1 : 1
  return [...nodes].sort((a, b) => {
    let result = 0
    if (field === "name") result = compareNames(a.name, b.name)
    else if (field === "division") result = compareNames(a.organization ?? "", b.organization ?? "")
    else if (field === "created_date") result = a.createdAt.localeCompare(b.createdAt)
    else result = (a.position ?? 0) - (b.position ?? 0) || compareNames(a.name, b.name)
    return result * direction || (a.id - b.id) * direction
  })
}

/** Tree search: a node that matches keeps all its children, otherwise only the matching descendants. */
export function filterTree<T extends { name: string; children: T[] }>(nodes: T[], search: string): T[] {
  const needle = dictionaryKey(search)
  if (!needle) return nodes
  const out: T[] = []
  for (const node of nodes) {
    if (dictionaryKey(node.name).includes(needle)) out.push(node)
    else {
      const children = filterTree(node.children, search)
      if (children.length) out.push({ ...node, children })
    }
  }
  return out
}

/** Builds a tree from flat rows (rows whose parent is missing become top level), sorted per level. */
export function buildTree<T extends { id: number; parentId: number | null; name: string; createdAt: string }, N extends T & { parentName: string; children: N[] }>(
  rows: T[],
  ordering: string,
): N[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const nodes = new Map<number, N>(rows.map((row) => [row.id, { ...row, parentName: "", children: [] as N[] } as N]))
  const roots: N[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId === null || node.parentId === node.id ? undefined : nodes.get(node.parentId)
    if (parent) {
      node.parentName = byId.get(parent.id)?.name ?? ""
      parent.children.push(node)
    } else roots.push(node)
  }
  const sortLevel = (level: N[]): N[] => sortNodes(level, ordering).map((node) => ({ ...node, children: sortLevel(node.children) }))
  return sortLevel(roots)
}
