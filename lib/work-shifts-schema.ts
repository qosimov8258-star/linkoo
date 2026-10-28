import { z } from "zod"

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const time = z
  .string({ error: "Обязательное поле" })
  .regex(TIME, "Укажите время в формате ЧЧ:ММ")
  .transform((value) => (value.length === 5 ? `${value}:00` : value))

export const workShiftSchema = z.object({
  name: z.string({ error: "Обязательное поле" }).trim().min(1, "Обязательное поле").max(255),
  beginTime: time,
  endTime: time,
})
