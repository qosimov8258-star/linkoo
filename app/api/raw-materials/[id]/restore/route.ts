import { catalogRestoreRoute } from "@/lib/products-routes"

// POST /api/raw-materials/[id]/restore — "Восстановить" from "Удалённые".
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return catalogRestoreRoute("raw_material", (await params).id)
}
