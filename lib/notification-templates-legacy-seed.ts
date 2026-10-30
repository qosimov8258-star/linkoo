// The template subscribers an older build seeded with "Шаблоны уведомлений" (lib/seed/notification-templates.json
// carried them as userIds): the reference account's employee ids, inserted into an empty
// notification_template_users table template by template in this order, so they got the link ids 1, 2, 3 …
// lib/notification-templates-repo.ts removes a link only when its id, template and user all match its place
// in this list; a link the company added later has a higher id and is never touched. Data only, no import.

export const LEGACY_TEMPLATE_LINK_SEED: ReadonlyArray<readonly [templateId: number, userIds: readonly number[]]> = [
  [
    2,
    [
      299, 345, 341, 292, 197, 288, 259, 312, 311, 329, 273, 238, 351, 281, 342, 347, 249, 328, 198, 335, 326, 193, 349, 346, 227, 269, 270, 243,
      188, 352, 201, 283, 305, 200, 354, 229, 322, 210, 302, 307, 286, 256, 350, 338, 234, 232, 199, 207, 355, 213, 301, 340, 314, 290, 244, 236,
      239, 344, 246, 219, 303, 316, 195, 255, 278, 233, 287, 276, 282, 274, 272, 277, 275, 257, 235, 280, 343, 203, 279, 337, 334, 230, 248, 315,
      308, 309, 214, 250, 254, 324, 206, 339, 242, 221, 285, 271, 327, 348, 284, 325, 336, 353, 196, 194, 310, 211, 228, 217, 317, 209, 208, 202,
      205, 260, 258, 262, 261, 266, 265, 268, 267, 264, 263, 318, 237, 223, 224, 319, 300, 321, 331, 222, 218, 313, 220, 252, 204, 297, 247, 251,
      295, 216, 332, 323, 240, 320, 306, 333, 293, 294, 296, 215, 298, 253, 304, 231, 212, 241,
    ],
  ],
  [15, [196, 194, 218]],
  [16, [196, 194, 218]],
]

/** The seeded links with the ids they got: [{ id, templateId, userId }]. */
export function legacyTemplateLinks(): Array<{ id: number; templateId: number; userId: number }> {
  const links: Array<{ id: number; templateId: number; userId: number }> = []
  for (const [templateId, userIds] of LEGACY_TEMPLATE_LINK_SEED) {
    for (const userId of userIds) links.push({ id: links.length + 1, templateId, userId })
  }
  return links
}
