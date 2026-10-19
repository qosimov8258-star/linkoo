import { catalogOptionsRoute } from "@/lib/products-routes"

// GET /api/raw-materials/options — form and filter choices.
export async function GET() {
  return catalogOptionsRoute()
}
