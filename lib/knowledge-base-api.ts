import "server-only"

import { z } from "zod"

import type { CurrentUser } from "@/lib/current-user"
import { positionOfEmployee, type KnowledgeBaseInput, type KnowledgeBaseScope } from "@/lib/knowledge-base-repo"
import { KB_NAME_MAX, KB_POSITIONS_MAX, KB_TEXT_MAX, KB_MESSAGES, KNOWLEDGE_BASE_PERMISSION } from "@/lib/knowledge-base-types"
import { hasPermission } from "@/lib/rbac"
import { dbId } from "@/lib/strict-number"

// Request schemas and the read scope of the knowledge base routes. Every message is a Russian
// i18n key (the dialog shows it under its field: {error, field, details} / {error, fields}).

const nameSchema = z
  .string({ error: KB_MESSAGES.nameRequired })
  .trim()
  .min(1, KB_MESSAGES.nameRequired)
  .max(KB_NAME_MAX, KB_MESSAGES.nameTooLong)

/** Body of POST /api/knowledge-base and PUT /api/knowledge-base/[id] (demo {name, text,
 * positions, is_active, file}). PUT keeps an omitted text / isActive / positions / fileId. */
export const knowledgeBaseBodySchema = z
  .object({
    name: nameSchema,
    text: z.string({ error: "Неверное значение" }).max(KB_TEXT_MAX, KB_MESSAGES.textTooLong).optional(),
    isActive: z.boolean({ error: "Неверное значение" }).optional(),
    positions: z
      .array(dbId(KB_MESSAGES.positionNotFound), { error: "Неверное значение" })
      .max(KB_POSITIONS_MAX, KB_MESSAGES.tooManyPositions)
      .optional(),
    fileId: dbId(KB_MESSAGES.fileNotFound).nullable().optional(),
  })
  .strict()

export type KnowledgeBaseBody = z.infer<typeof knowledgeBaseBodySchema>

export function knowledgeBaseInput(body: KnowledgeBaseBody): KnowledgeBaseInput {
  return {
    name: body.name,
    // Trailing blank lines / spaces of the text say nothing; the inner line breaks stay.
    text: body.text === undefined ? undefined : body.text.trimEnd(),
    isActive: body.isActive,
    positionIds: body.positions === undefined ? undefined : [...new Set(body.positions)],
    fileId: body.fileId,
  }
}

/** True when the user reads every article (admin list): an administrator, a user without an
 * access right (role model only) or one whose access right grants the knowledge base. */
export function readsWholeKnowledgeBase(user: CurrentUser): boolean {
  return user.role === "admin" || user.permissions === null || hasPermission(user, KNOWLEDGE_BASE_PERMISSION)
}

/** Read scope of a user: the whole base, or what is published to their job position. */
export async function knowledgeBaseScopeOf(user: CurrentUser): Promise<KnowledgeBaseScope> {
  if (readsWholeKnowledgeBase(user)) return { all: true }
  return { all: false, positionId: (await positionOfEmployee(user.employeeId))?.id ?? null }
}
