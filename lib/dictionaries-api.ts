import "server-only"

import { z } from "zod"

import { idOrObject, imageInput, imageSchema, nameSchema, organizationSchema } from "@/lib/dictionaries-schema"
import type { BrandInput } from "@/lib/brands-repo"
import type { ProductTypeInput } from "@/lib/product-types-repo"
import type { UnitOfMeasureInput } from "@/lib/units-of-measure-repo"

// Request bodies of the dictionary APIs. They accept our camelCase names, the demo
// serializer names (parent, division, show_in_market, order, is_weighted, image) and the
// old payloads ({name, organization, parentId, showInBot} / {name, parentId} /
// {name, organization, photoUrl}). Messages are Russian i18n keys.

const positionSchema = z
  .preprocess((value) => (value === "" || value === null ? undefined : value), z.coerce.number({ error: "Введите целое число" }).int("Введите целое число").min(-1_000_000).max(1_000_000))
  .optional()

const first = <T>(...values: Array<T | undefined>): T | undefined => values.find((value) => value !== undefined)

export const productTypeBodySchema = z.object({
  name: nameSchema,
  organization: organizationSchema,
  division: organizationSchema,
  parentId: idOrObject,
  parent: idOrObject,
  showInBot: z.boolean().optional(),
  showInMarket: z.boolean().optional(),
  show_in_market: z.boolean().optional(),
  position: positionSchema,
  order: positionSchema,
  image: imageSchema,
})

export function productTypeInput(body: z.infer<typeof productTypeBodySchema>): ProductTypeInput {
  const organization = first(body.organization, body.division)
  const parentId = first(body.parentId, body.parent)
  return {
    name: body.name,
    organization: organization === undefined ? undefined : (organization ?? ""),
    parentId: parentId === undefined ? undefined : (parentId ?? null),
    showInBot: first(body.showInBot, body.showInMarket, body.show_in_market),
    position: first(body.position, body.order),
    image: imageInput(body.image),
  }
}

export const unitBodySchema = z.object({
  name: nameSchema,
  parentId: idOrObject,
  parent: idOrObject,
  isWeighted: z.boolean().optional(),
  is_weighted: z.boolean().optional(),
})

export function unitInput(body: z.infer<typeof unitBodySchema>): UnitOfMeasureInput {
  const parentId = first(body.parentId, body.parent)
  return { name: body.name, parentId: parentId === undefined ? undefined : (parentId ?? null), isWeighted: first(body.isWeighted, body.is_weighted) }
}

export const brandBodySchema = z.object({
  name: nameSchema,
  organization: organizationSchema,
  division: organizationSchema,
  image: imageSchema,
  /** Old payload: the picture as a data URL ("" = none). */
  photoUrl: imageSchema,
})

export function brandInput(body: z.infer<typeof brandBodySchema>): BrandInput {
  const organization = first(body.organization, body.division)
  // An old client echoing the served picture URL back means "keep".
  const legacy = typeof body.photoUrl === "string" && body.photoUrl.trim() && !body.photoUrl.trim().startsWith("data:") ? undefined : body.photoUrl
  return {
    name: body.name,
    organization: organization === undefined ? undefined : (organization ?? ""),
    image: imageInput(first(body.image, legacy)),
  }
}
