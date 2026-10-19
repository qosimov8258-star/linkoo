import { catalogImageDeleteRoute, catalogImageGetRoute, catalogImagePrimaryRoute } from "@/lib/products-routes"

type RouteParams = { params: Promise<{ id: string; imageId: string }> }

// GET the picture · PUT "Сделать основным" · DELETE.
export async function GET(_request: Request, { params }: RouteParams) {
  const { id, imageId } = await params
  return catalogImageGetRoute("product", id, imageId)
}

export async function PUT(_request: Request, { params }: RouteParams) {
  const { id, imageId } = await params
  return catalogImagePrimaryRoute("product", id, imageId)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, imageId } = await params
  return catalogImageDeleteRoute("product", id, imageId)
}
