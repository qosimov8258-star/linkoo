import type { DocTemplatePayload } from "@/components/analytics/doc-templates-data"

export async function readDocTemplateBody(request: Request): Promise<Partial<DocTemplatePayload>> {
  const json = (await request.json().catch(() => ({}))) as Record<string, unknown>
  return {
    name: typeof json.name === "string" ? json.name : "",
    keyName: typeof json.keyName === "string" ? json.keyName : "",
    html: typeof json.html === "string" ? json.html : "",
    isActive: Boolean(json.isActive),
  }
}
