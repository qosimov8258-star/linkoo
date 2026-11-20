import "server-only"

import { z } from "zod"

import { DOC_DATE_INVALID, docDateCheck } from "@/lib/document-dates"
import { dbId } from "@/lib/strict-number"

// Bodies of /api/production/sessions/** (worker shift sessions, lib/production-sessions-repo.ts). Ids are positive
// int4 (no coercion of booleans, arrays or hex), moments real dates of a sane year that are not in the future
// (the repo also refuses a later time of today); every message is a Russian i18n key.

/** «Начало смены» / «Конец смены»: "YYYY-MM-DDTHH:mm[:ss]" (local); absent or empty = now. */
const moment = z.string({ error: DOC_DATE_INVALID }).trim().max(40, DOC_DATE_INVALID).optional().superRefine(docDateCheck())

/** «Открыть смену»: a worker of the stage's Персонал on one of their shifts there. */
export const sessionOpenSchema = z.object({
  stageId: dbId(),
  employeeId: dbId("Выберите работника"),
  shiftId: dbId("Выберите смену"),
  openedAt: moment,
})

/** «Закрыть смену». */
export const sessionCloseSchema = z.object({ closedAt: moment })

/** «Передать на склад»: Linko's {stock} — only the target warehouse; the server takes the session's output. */
export const sessionGiveSchema = z.object({ warehouseId: dbId("Выберите склад") })
