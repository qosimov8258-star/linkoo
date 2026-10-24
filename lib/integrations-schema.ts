import "server-only"

import { z } from "zod"

import { INTEGRATION_TYPES } from "@/lib/integrations-types"

export const integrationSchema = z.object({
  type: z.string().refine((value) => INTEGRATION_TYPES.some((item) => item.name === value), "Выберите тип интеграции"),
  userId: z.number().int().positive("Выберите пользователя"),
  comment: z.string().trim().max(500, "Комментарий слишком длинный").default(""),
  isActive: z.boolean().default(true),
  token: z.string().trim().min(1, "Укажите токен").max(2000),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Неверная дата").nullable().default(null),
  extraFields: z.record(z.string(), z.string().max(200)).default({}),
  extraUserIds: z.array(z.number().int().positive()).default([]),
})
