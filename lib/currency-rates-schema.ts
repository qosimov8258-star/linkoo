import { z } from "zod"

const REQUIRED = "Обязательное поле"

/** "12 070,85" / "12070.85" / 12070.85 → number. */
export const rateValue = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.replace(/\s/g, "").replace(",", ".")) : value),
  z.number({ error: REQUIRED }).positive("Введите число больше 0").max(1_000_000_000, "Слишком большое число"),
)

const day = z.string({ error: REQUIRED }).regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату")

export const setRateSchema = z.object({ rate: rateValue })

export const individualRateSchema = z
  .object({
    name: z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255),
    rate: rateValue,
    beginDate: day,
    endDate: day,
  })
  .refine((value) => value.endDate >= value.beginDate, { path: ["endDate"], message: "Дата завершения раньше даты начала" })
