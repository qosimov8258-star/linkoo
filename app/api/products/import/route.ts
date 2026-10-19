import { catalogImportRoute } from "@/lib/products-routes"

// POST /api/products/import {mode: "create" | "update", rows} — "Импорт" / "Обновить с excel".
export async function POST(request: Request) {
  return catalogImportRoute(request, "product")
}
