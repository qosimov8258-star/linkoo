import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getCatalogDetail, listCatalog } from "@/lib/products-catalog"
import { bulkSchema, catalogItemSchema, catalogListQuery, catalogPatch, catalogWrite, imageSchema, importSchema, limitsSchema, parseCatalogId } from "@/lib/products-api"
import { importCatalogRows } from "@/lib/products-import"
import { addCatalogImage, addCatalogLimits, deleteCatalogImage, deleteCatalogLimit, getCatalogImage, setPrimaryCatalogImage } from "@/lib/products-media"
import { getCatalogOptions } from "@/lib/products-options"
import { getProduct, listProducts } from "@/lib/products-repo"
import type { CatalogKind } from "@/lib/products-types"
import { NOT_FOUND, bulkUpdateCatalog, createCatalogItem, getCatalogUsage, deleteCatalogItem, restoreCatalogItem, updateCatalogItem } from "@/lib/products-write"
import { getRawMaterial, listRawMaterials } from "@/lib/raw-materials-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// Handlers behind app/api/products/** and app/api/raw-materials/** (same API, the kind
// differs). Defaults keep the old shapes: GET /api/products = every product (array),
// GET /api/raw-materials = raw materials not deleted (array), POST / PUT answer with the
// item in that shape. Opt-in: ?view=list (paged CatalogItem list), ?view=item (detail).

const UNAUTHORIZED = () => notSignedInResponse()
const notFound = (kind: CatalogKind) => NextResponse.json({ error: NOT_FOUND[kind] }, { status: 404 })
const userName = (user: { displayName?: string; username: string }) => user.displayName || user.username

async function legacyItem(kind: CatalogKind, id: number) {
  return kind === "product" ? getProduct(id) : getRawMaterial(id)
}

/** GET /api/{kind} */
export async function catalogListRoute(request: Request, kind: CatalogKind): Promise<NextResponse> {
  if (!(await getCurrentUser())) return UNAUTHORIZED()
  const params = new URL(request.url).searchParams
  if (params.get("view") === "list") return NextResponse.json(await listCatalog(kind, catalogListQuery(params, kind)))
  if (kind === "product") return NextResponse.json(await listProducts())
  return NextResponse.json(await listRawMaterials(params.get("includeDeleted") === "1"))
}

/** POST /api/{kind} — create (201, old item shape). */
export async function catalogCreateRoute(request: Request, kind: CatalogKind): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, catalogItemSchema)
  if (parsed.error) return parsed.error
  const patch = catalogPatch(parsed.data)
  if (!patch.name?.trim()) return NextResponse.json({ error: "Наименование обязательно", fields: { name: "Обязательное поле" } }, { status: 400 })
  return catalogWrite(async () => {
    const id = await createCatalogItem(kind, patch)
    const view = new URL(request.url).searchParams.get("view")
    return NextResponse.json(view === "item" ? await getCatalogDetail(kind, id) : await legacyItem(kind, id), { status: 201 })
  })
}

/** GET /api/{kind}/[id] — detail (images, limits); ?usage=1 adds where it is used. */
export async function catalogItemRoute(request: Request, kind: CatalogKind, idText: string): Promise<NextResponse> {
  if (!(await getCurrentUser())) return UNAUTHORIZED()
  const id = parseCatalogId(idText)
  const detail = id ? await getCatalogDetail(kind, id) : null
  if (!detail) return notFound(kind)
  const withUsage = new URL(request.url).searchParams.get("usage") === "1"
  return NextResponse.json(withUsage ? { ...detail, usage: await getCatalogUsage(kind, detail.id) } : detail)
}

/** PUT /api/{kind}/[id] — edit; omitted fields keep their value, a rename cascades (`renamed`). */
export async function catalogUpdateRoute(request: Request, kind: CatalogKind, idText: string): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId(idText)
  if (!id) return notFound(kind)
  const parsed = await parseJsonBody(request, catalogItemSchema)
  if (parsed.error) return parsed.error
  return catalogWrite(async () => {
    const result = await updateCatalogItem(kind, id, catalogPatch(parsed.data))
    if (!result) return notFound(kind)
    const view = new URL(request.url).searchParams.get("view")
    const item = view === "item" ? await getCatalogDetail(kind, id) : await legacyItem(kind, id)
    return NextResponse.json({ ...item, renamed: result.renamed })
  })
}

/** DELETE /api/{kind}/[id]?mode=soft|hard — "Удалить" (soft, to "Удалённые") / for good (409 {usage} while used).
 * No mode (old callers) = for good when unused, else soft; ?hard=1 = mode hard. Answers {ok, mode}. */
export async function catalogDeleteRoute(request: Request, kind: CatalogKind, idText: string): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId(idText)
  if (!id) return notFound(kind)
  const params = new URL(request.url).searchParams
  const requested = params.get("mode")
  const mode = requested === "soft" || requested === "hard" ? requested : ["1", "true"].includes(params.get("hard") ?? "") ? "hard" : "auto"
  return catalogWrite(async () => {
    const applied = await deleteCatalogItem(kind, id, mode, userName(auth.user))
    return applied ? NextResponse.json({ ok: true, mode: applied }) : notFound(kind)
  })
}

/** POST /api/{kind}/[id]/restore — "Восстановить" (409 when a live item has the name). */
export async function catalogRestoreRoute(kind: CatalogKind, idText: string): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId(idText)
  if (!id) return notFound(kind)
  return catalogWrite(async () => ((await restoreCatalogItem(kind, id)) ? NextResponse.json({ ok: true }) : notFound(kind)))
}

/** GET /api/{kind}/options */
export async function catalogOptionsRoute(): Promise<NextResponse> {
  if (!(await getCurrentUser())) return UNAUTHORIZED()
  return NextResponse.json(await getCatalogOptions())
}

/** POST /api/{kind}/import {mode, rows} — 200 {created, updated}; 400 {error, errors} when a row is wrong (nothing saved). */
export async function catalogImportRoute(request: Request, kind: CatalogKind): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, importSchema)
  if (parsed.error) return parsed.error
  return catalogWrite(async () => {
    const result = await importCatalogRows(kind, parsed.data.mode, parsed.data.rows)
    if (result.errors.length) return NextResponse.json({ error: "Ошибка в файле", ...result }, { status: 400 })
    return NextResponse.json(result)
  })
}

/** POST /api/{kind}/bulk {ids, changes} — "Изменить выбранные продукты". */
export async function catalogBulkRoute(request: Request, kind: CatalogKind): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, bulkSchema)
  if (parsed.error) return parsed.error
  return catalogWrite(async () => NextResponse.json({ updated: await bulkUpdateCatalog(kind, parsed.data.ids, parsed.data.changes, userName(auth.user)) }))
}

/** POST /api/{kind}/limits {ids, agents, amount} — "Добавить лимит". */
export async function catalogLimitsRoute(request: Request, kind: CatalogKind): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, limitsSchema)
  if (parsed.error) return parsed.error
  const { ids, agents, amount } = parsed.data
  return catalogWrite(async () => NextResponse.json({ saved: await addCatalogLimits(kind, ids, agents, amount, userName(auth.user)) }))
}

/** DELETE /api/{kind}/[id]/limits/[limitId] */
export async function catalogLimitDeleteRoute(kind: CatalogKind, idText: string, limitText: string): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId(idText)
  const limitId = parseCatalogId(limitText)
  if (!id || !limitId || !(await deleteCatalogLimit(kind, id, limitId))) return NextResponse.json({ error: "Лимит не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

/** POST /api/{kind}/[id]/images {image: data URL, isPrimary} — "Добавить фото". */
export async function catalogImageAddRoute(request: Request, kind: CatalogKind, idText: string): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId(idText)
  if (!id) return notFound(kind)
  const parsed = await parseJsonBody(request, imageSchema)
  if (parsed.error) return parsed.error
  return catalogWrite(async () => {
    const imageId = await addCatalogImage(kind, id, parsed.data.image, parsed.data.isPrimary ?? false, userName(auth.user))
    return imageId ? NextResponse.json({ id: imageId }, { status: 201 }) : notFound(kind)
  })
}

const imageNotFound = () => NextResponse.json({ error: "Фото не найдено" }, { status: 404 })

/** GET /api/{kind}/[id]/images/[imageId] — the picture itself. */
export async function catalogImageGetRoute(kind: CatalogKind, idText: string, imageText: string): Promise<Response> {
  if (!(await getCurrentUser())) return UNAUTHORIZED()
  const id = parseCatalogId(idText)
  const imageId = parseCatalogId(imageText)
  const image = id && imageId ? await getCatalogImage(kind, id, imageId) : null
  if (!image) return imageNotFound()
  return new Response(new Uint8Array(image.data), { headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=300" } })
}

/** PUT /api/{kind}/[id]/images/[imageId] — "Сделать основным". */
export async function catalogImagePrimaryRoute(kind: CatalogKind, idText: string, imageText: string): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId(idText)
  const imageId = parseCatalogId(imageText)
  if (!id || !imageId || !(await setPrimaryCatalogImage(kind, id, imageId))) return imageNotFound()
  return NextResponse.json({ ok: true })
}

/** DELETE /api/{kind}/[id]/images/[imageId] */
export async function catalogImageDeleteRoute(kind: CatalogKind, idText: string, imageText: string): Promise<NextResponse> {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseCatalogId(idText)
  const imageId = parseCatalogId(imageText)
  if (!id || !imageId || !(await deleteCatalogImage(kind, id, imageId))) return imageNotFound()
  return NextResponse.json({ ok: true })
}
