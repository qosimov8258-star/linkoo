import { notFound, requireViewer, type RouteParams } from "@/lib/production-api"
import { getMovementImage } from "@/lib/production-batches-repo"
import { parseIdSegment } from "@/lib/validation"

/** GET /api/production/movements/[id]/image → the photo of a batch line (a defect's «фото»): the stored raster
 * image (png / jpeg / webp / gif only), 404 without one. The batch detail links to it instead of carrying it. */
export async function GET(_request: Request, context: RouteParams) {
  const denied = await requireViewer()
  if (denied) return denied
  const id = parseIdSegment((await context.params).id)
  const image = id ? await getMovementImage(id) : null
  if (!image) return notFound("Фото не найдено")
  return new Response(new Uint8Array(image.data), {
    headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  })
}
