// "Конструктор документов" (demo #/docs-builder, API saas/template/): print templates of the
// order / return / supply / write-off documents; `html` is a Django-style template.

export const DOC_TEMPLATES_API = "/api/doc-templates"

/** DOCS_BUILDER_TYPES of the demo, in its order (the "supply" entry is listed twice there). */
export const DOC_TEMPLATE_KEYS: { id: string; name: string }[] = [
  { id: "order", name: "Накладная заказа" },
  { id: "provider_return", name: "Возврат поставщиков" },
  { id: "order_return", name: "Накладная возврата" },
  { id: "supply", name: "Поставки" },
  { id: "writeoff", name: "Списание" },
  { id: "supply", name: "Поставки" },
  { id: "stock_transfers", name: "Передачи на склад" },
  { id: "transfer", name: "Передача" },
]

export const docTemplateKeyName = (id: string) => DOC_TEMPLATE_KEYS.find((key) => key.id === id)?.name ?? ""

export type DocTemplate = { id: number; name: string; keyName: string; isActive: boolean; createdDate: string }
export type DocTemplateDetail = DocTemplate & { html: string }
export type DocTemplateListResult = { count: number; results: DocTemplate[] }
export type DocTemplatePayload = { name: string; keyName: string; isActive: boolean; html: string }

export const DOC_TEMPLATE_ORDERINGS = ["id", "name", "date", "key_name", "is_active"] as const
