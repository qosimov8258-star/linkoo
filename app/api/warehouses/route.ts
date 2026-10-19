import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createWarehouse, listWarehouses, listWarehousesPage, warehouseErrorResponse } from "@/lib/warehouses-repo"
import {
  warehouseActiveParam,
  warehouseInput,
  warehouseInputSchema,
  warehouseListQuerySchema,
  warehouseQueryObject,
  wantsPagedWarehouses,
  type WarehouseListQuery,
} from "@/lib/warehouses-schema"

// GET /api/warehouses — plain array [{id, name, address, branch, manager, createdDate, online,
// active}] for the warehouse pickers of the other pages: ACTIVE warehouses only, id DESC
// (?active=all | false opts in to the others, ?search= filters by name).
// With ?page / ?pageSize (or ?paged=1) it returns the grid of the "Склады" page instead:
// {count, results: full rows} filtered by ?isActive (true | false | all), ?search, ?stockType,
// ordered by ?ordering (default name) — demo GET stock/stock/.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const query = warehouseListQuerySchema.safeParse(warehouseQueryObject(params))
  if (!query.success) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: query.error.flatten() }, { status: 400 })
  const active = warehouseActiveParam(params)
  if (wantsPagedWarehouses(params)) {
    return NextResponse.json(await listWarehousesPage({ ...query.data, active } as WarehouseListQuery))
  }
  return NextResponse.json(await listWarehouses({ active, search: query.data.search }))
}

// POST /api/warehouses — demo POST stock/stock/ (see lib/warehouses-schema.ts for the body).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, warehouseInputSchema)
  if (parsed.error) return parsed.error
  const input = warehouseInput(parsed.data)
  if ("fields" in input) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", fields: input.fields }, { status: 400 })

  try {
    return NextResponse.json(await createWarehouse(input.input), { status: 201 })
  } catch (error) {
    const response = warehouseErrorResponse(error)
    if (response) return response
    throw error
  }
}
