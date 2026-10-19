import { catalogOptionsRoute } from "@/lib/products-routes"

// GET /api/products/options — form and filter choices.
export async function GET() {
  return catalogOptionsRoute()
}
