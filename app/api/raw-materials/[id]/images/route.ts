import { catalogImageAddRoute } from "@/lib/products-routes"

// POST /api/raw-materials/[id]/images {image, isPrimary} — "Добавить фото".
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return catalogImageAddRoute(request, "raw_material", (await params).id)
}
