import { catalogImageDeleteRoute, catalogImageGetRoute, catalogImagePrimaryRoute } from "@/lib/products-routes"

type RouteParams = { params: Promise<{ id: string; imageId: string }> }

// GET the picture · PUT "Сделать основным" · DELETE.
export async function GET(_request: Request, { params }: RouteParams) {
  const { id, imageId } = await params
  return catalogImageGetRoute("raw_material", id, imageId)
}

export async function PUT(_request: Request, { params }: RouteParams) {
  const { id, imageId } = await params
  return catalogImagePrimaryRoute("raw_material", id, imageId)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, imageId } = await params
  return catalogImageDeleteRoute("raw_material", id, imageId)
}
