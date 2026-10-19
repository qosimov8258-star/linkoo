import { catalogCreateRoute, catalogListRoute } from "@/lib/products-routes"

// GET  /api/raw-materials — default: the old array shape; ?view=list → {results, count} (paged, filtered).
// POST /api/raw-materials — create.
export async function GET(request: Request) {
  return catalogListRoute(request, "raw_material")
}

export async function POST(request: Request) {
  return catalogCreateRoute(request, "raw_material")
}
