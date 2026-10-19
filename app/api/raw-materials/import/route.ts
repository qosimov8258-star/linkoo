import { catalogImportRoute } from "@/lib/products-routes"

// POST /api/raw-materials/import {mode: "create" | "update", rows} — "Импорт" / "Обновить с excel".
export async function POST(request: Request) {
  return catalogImportRoute(request, "raw_material")
}
