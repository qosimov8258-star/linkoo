import { guarded, notFound, requireViewer, type RouteParams } from "@/lib/production-api"
import { getEquipmentImage } from "@/lib/production-stages-repo"
import { parseIdSegment } from "@/lib/validation"

/** The picture of a machine (the lists and dialogs show it from here: the data never travels inside a list).
 * The URL the lists give carries a hash of the picture (?v=…), so that answer may stay in the browser's cache. */
export async function GET(request: Request, context: RouteParams) {
  const denied = await requireViewer()
  if (denied) return denied
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  const versioned = new URL(request.url).searchParams.has("v")
  return guarded(async () => {
    const picture = await getEquipmentImage(id)
    if (!picture) return notFound()
    return new Response(new Uint8Array(picture.bytes), {
      headers: {
        "Content-Type": picture.type,
        "Content-Length": String(picture.bytes.length),
        "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    })
  })
}
