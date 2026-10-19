import { catalogCreateRoute, catalogListRoute } from "@/lib/products-routes"

// GET  /api/products — default: the old array shape; ?view=list → {results, count} (paged, filtered).
// POST /api/products — create.
export async function GET(request: Request) {
  return catalogListRoute(request, "product")
}

export async function POST(request: Request) {
  return catalogCreateRoute(request, "product")
}
