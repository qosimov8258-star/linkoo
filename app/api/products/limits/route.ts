import { catalogLimitsRoute } from "@/lib/products-routes"

// POST /api/products/limits {ids, agents, amount} — "Добавить лимит" for the selected items.
export async function POST(request: Request) {
  return catalogLimitsRoute(request, "product")
}
