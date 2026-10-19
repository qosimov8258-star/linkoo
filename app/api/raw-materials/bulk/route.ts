import { catalogBulkRoute } from "@/lib/products-routes"

// POST /api/raw-materials/bulk {ids, changes} — edit the selected items.
export async function POST(request: Request) {
  return catalogBulkRoute(request, "raw_material")
}
