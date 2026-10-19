import { catalogDeleteRoute, catalogItemRoute, catalogUpdateRoute } from "@/lib/products-routes"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/raw-materials/[id] (?usage=1) · PUT (edit, rename cascade) · DELETE (?mode=soft | hard; none = for good when unused, else soft).
export async function GET(request: Request, { params }: RouteParams) {
  return catalogItemRoute(request, "raw_material", (await params).id)
}

export async function PUT(request: Request, { params }: RouteParams) {
  return catalogUpdateRoute(request, "raw_material", (await params).id)
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return catalogDeleteRoute(request, "raw_material", (await params).id)
}
