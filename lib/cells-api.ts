import { z } from "zod"

import { optionalId } from "@/lib/dictionaries-schema"

const nameSchema = z.string({ error: "Обязательное поле" }).trim().min(1, "Обязательное поле").max(255, "Не более 255 символов")

export const cellTypeBodySchema = z.object({ name: nameSchema, parentId: optionalId })

export const cellBodySchema = z.object({
  name: nameSchema,
  barcode: z.string().trim().max(255, "Не более 255 символов").optional(),
  cellTypeId: optionalId,
})
