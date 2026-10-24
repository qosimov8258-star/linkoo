import { z } from "zod"

const REQUIRED = "Обязательное поле"

const text = z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255, "Не более 255 символов")
const amount = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.replace(/\s/g, "").replace(",", ".")) : value),
  z.number({ error: REQUIRED }).min(0, "Введите число не меньше 0").max(1_000_000_000, "Слишком большое число"),
)

export const transportSchema = z.object({
  model: text,
  number: text,
  driver: text,
  capacity: amount,
  loadLimit: amount,
  branchId: z.preprocess((value) => (value === "" || value === undefined ? null : value), z.number().int().positive().nullable()),
})
