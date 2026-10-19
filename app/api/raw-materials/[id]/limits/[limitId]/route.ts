import { catalogLimitDeleteRoute } from "@/lib/products-routes"

// DELETE /api/raw-materials/[id]/limits/[limitId] — removes an agent limit.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; limitId: string }> }) {
  const { id, limitId } = await params
  return catalogLimitDeleteRoute("raw_material", id, limitId)
}
