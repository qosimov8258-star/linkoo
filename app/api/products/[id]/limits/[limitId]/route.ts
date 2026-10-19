import { catalogLimitDeleteRoute } from "@/lib/products-routes"

// DELETE /api/products/[id]/limits/[limitId] — removes an agent limit.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; limitId: string }> }) {
  const { id, limitId } = await params
  return catalogLimitDeleteRoute("product", id, limitId)
}
