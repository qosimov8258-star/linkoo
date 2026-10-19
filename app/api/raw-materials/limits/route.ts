import { catalogLimitsRoute } from "@/lib/products-routes"

// POST /api/raw-materials/limits {ids, agents, amount} — "Добавить лимит" for the selected items.
export async function POST(request: Request) {
  return catalogLimitsRoute(request, "raw_material")
}
