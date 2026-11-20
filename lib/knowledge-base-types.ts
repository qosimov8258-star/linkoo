// Client-safe types and limits of "База знания" (Персонал → Заказ → База знания, demo
// #/knowledge-base, API main/knowledge/). An article is a short memo (name + text + an optional
// PDF) published to the staff whose access right (Linko main/position/) is listed in "Права доступа";
// an empty list means everyone. Only active articles are published (GET
// /api/knowledge-base/feed); the admin list shows them all. Shared by the routes and the views.

export const KNOWLEDGE_BASE_API = "/api/knowledge-base"
export const KNOWLEDGE_BASE_FILES_API = "/api/knowledge-base/files"

/** Permission that changes the knowledge base (lib/capabilities-catalog.ts, /api/knowledge-base). */
export const KNOWLEDGE_BASE_PERMISSION = "settings.manage"

export const KB_NAME_MAX = 255
export const KB_TEXT_MAX = 10_000
/** Most access rights one article can list. */
export const KB_POSITIONS_MAX = 500
/** Largest PDF: the edge refuses request bodies over 2 MiB (middleware.ts), multipart included. */
export const KB_FILE_MAX_BYTES = 2_000_000
export const KB_FILE_NAME_MAX = 255

/** Russian i18n keys of the refusals (shared by the routes and the dialog). */
export const KB_MESSAGES = {
  nameRequired: "Введите название",
  nameTooLong: "Не более 255 символов",
  nameTaken: "Такое название уже существует",
  textTooLong: "Не более 10 000 символов",
  positionNotFound: "Права доступа не найдены",
  tooManyPositions: "Слишком много значений",
  fileNotFound: "Файл не найден",
  fileMissing: "Выберите файл",
  fileEmpty: "Файл пустой",
  fileTooLarge: "Файл слишком большой (макс. 2 МБ)",
  fileNotPdf: "Допускается только PDF файл",
  notFound: "Не найдено",
} as const

export type KnowledgeBasePosition = { id: number; name: string }

export type KnowledgeBaseFile = {
  id: number
  name: string
  size: number
  /** GET /api/knowledge-base/files/[id] (inline PDF). */
  url: string
}

/** Row of the admin grid (demo list: № = id, Наименование). */
export type KnowledgeBaseListItem = {
  id: number
  name: string
  isActive: boolean
  positionCount: number
  hasFile: boolean
  /** ISO time of the last change (UTC, "…Z"); the mobile feed syncs by it. */
  updatedAt: string
}

export type KnowledgeBaseListResult = { count: number; results: KnowledgeBaseListItem[] }

/** One article (demo GET main/knowledge/<id>/). */
export type KnowledgeBaseArticle = {
  id: number
  name: string
  text: string
  isActive: boolean
  /** Access rights that see the article; [] = everyone. */
  positions: KnowledgeBasePosition[]
  file: KnowledgeBaseFile | null
  createdAt: string
  updatedAt: string
}

/** GET /api/knowledge-base/feed: what the caller's mobile app shows. */
export type KnowledgeBaseFeed = {
  serverTime: string
  position: KnowledgeBasePosition | null
  /** Ids of every article visible now (the app drops the others). */
  visibleIds: number[]
  /** Visible articles changed after ?since (all of them without it). */
  articles: Array<Omit<KnowledgeBaseArticle, "positions" | "isActive" | "createdAt">>
}

/** GET: the access rights the "Права доступа" field offers ({id, name}[], by id like Linko's main/position/). */
export const KNOWLEDGE_BASE_ACCESS_RIGHTS_API = "/api/knowledge-base/access-rights"

export function knowledgeBaseFileUrl(id: number): string {
  return `${KNOWLEDGE_BASE_FILES_API}/${id}`
}
