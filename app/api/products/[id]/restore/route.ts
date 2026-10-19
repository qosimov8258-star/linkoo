import { catalogRestoreRoute } from "@/lib/products-routes"

// POST /api/products/[id]/restore — "Восстановить" from "Удалённые".
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return catalogRestoreRoute("product", (await params).id)
}
