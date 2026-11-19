import { z } from "zod"

import { dbId } from "@/lib/strict-number"

// Request bodies of Этапы производства → Персонал / Оборудование and of Настройки → «Оборудования», with the
// field messages Linko answers (Django REST): a form shows them under the field (`details.fieldErrors`).

export const FIELD_REQUIRED = "Это поле обязательно к заполнению"
export const FIELD_BLANK = "Это поле не может быть пустым."
export const FIELD_TOO_LONG = "Убедитесь, что в этом поле не больше 255 символов."
const IMAGE_ERROR = "Неверный формат изображения"

/** A machine's name: given, not blank, at most 255 characters; stored trimmed. */
const equipmentName = () =>
  z
    .string({ error: FIELD_REQUIRED })
    .superRefine((value, context) => {
      const trimmed = value.trim()
      if (value === "") context.addIssue({ code: "custom", message: FIELD_REQUIRED })
      else if (trimmed === "") context.addIssue({ code: "custom", message: FIELD_BLANK })
      else if (trimmed.length > 255) context.addIssue({ code: "custom", message: FIELD_TOO_LONG })
    })
    .transform((value) => value.trim())

/** A required reference id: missing, null or "" → «Это поле обязательно к заполнению»; anything else that is
 * not a positive int4 id → «Неверный идентификатор». */
const requiredId = () =>
  z
    .preprocess((value) => (value === null || value === "" ? undefined : value), dbId().optional())
    .refine((value) => value !== undefined, FIELD_REQUIRED)
    .transform((value) => value as number)

/** A machine's picture: "" (none), a raster data URL (what the forms send), or an older http(s) / site link.
 * Anything else, a "javascript:" link first of all, is refused: the value becomes an image source. */
const equipmentImage = z
  .string({ error: IMAGE_ERROR })
  .max(3_000_000, "Изображение слишком большое")
  .refine((value) => value === "" || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) || /^(https?:\/\/|\/(?!\/))[^\s"'<>\\]*$/.test(value), IMAGE_ERROR)

/** The stage tab's «Добавить / Изменить оборудование». `status` omitted: «не работает» for a new machine, kept on
 * an edit; `image` omitted: the stored picture stays ("" removes it). */
export const equipmentSchema = z.object({
  stageId: requiredId(),
  name: equipmentName(),
  status: z.enum(["0", "1"], { error: "Неверное значение" }).optional(),
  image: equipmentImage.optional(),
})

/** Настройки → «Оборудования»: {name, manufacturingId (the stage), photo}. `photo` omitted keeps the picture,
 * null or "" removes it. */
export const equipmentSettingsSchema = z.object({
  name: equipmentName(),
  manufacturingId: requiredId(),
  photo: equipmentImage.nullable().optional(),
})

/** «Добавить сотрудника»: Linko's user_shift {user, shift, manufacture}, the shift one of the Смены directory. */
export const staffSchema = z.object({
  stageId: dbId(),
  employeeId: requiredId(),
  shiftId: requiredId(),
})

/** «Изменение сотрудника»: the shift (the employee of a row stays). */
export const staffUpdateSchema = z.object({
  shiftId: requiredId(),
})
