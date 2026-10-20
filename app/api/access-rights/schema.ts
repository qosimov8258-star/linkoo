import { NextResponse } from "next/server"
import { z } from "zod"

import type { AccessRightError } from "@/lib/access-rights-repo"
import { nameField } from "@/lib/auth-request"

export const accessRightSchema = z.object({
  name: nameField("Укажите наименование", 120),
  capabilityIds: z
    .array(z.number({ error: "Неизвестная возможность" }).int({ error: "Неизвестная возможность" }).positive({ error: "Неизвестная возможность" }), {
      error: "Неверный список возможностей",
    })
    .max(500)
    .optional(),
})

export function accessRightErrorResponse(error: AccessRightError) {
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}
