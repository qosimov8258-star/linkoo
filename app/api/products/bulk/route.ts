import { catalogBulkRoute } from "@/lib/products-routes"

// POST /api/products/bulk {ids, changes} — edit the selected items.
export async function POST(request: Request) {
  return catalogBulkRoute(request, "product")
}
