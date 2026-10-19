import { catalogImageAddRoute } from "@/lib/products-routes"

// POST /api/products/[id]/images {image, isPrimary} — "Добавить фото".
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return catalogImageAddRoute(request, "product", (await params).id)
}
