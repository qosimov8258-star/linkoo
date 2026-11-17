import { z } from "zod"

/** A saved report of the old builder: its name, the builder's settings and Linko's report type. */
export const oldSavedReportSchema = z.object({
  name: z.string().trim().min(1, "Обязательное поле").max(255, "Не более 255 символов"),
  config: z.unknown().optional(),
  reportType: z.enum(["table", "widget"]).optional(),
})

/** Linko's «Пользователи» dialog: to the chosen employees or to the chosen access rights. */
export const reportSharingSchema = z.object({
  type: z.enum(["user", "position"]),
  users: z.array(z.number().int().positive()).max(2000),
  positions: z.array(z.number().int().positive()).max(2000),
})
