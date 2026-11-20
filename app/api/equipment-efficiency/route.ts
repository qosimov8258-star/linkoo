import { NextResponse, type NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import {
  GEAR_FIRST_LIMIT,
  GEAR_SECOND_LIMIT,
  getEquipmentClientOrders,
  getEquipmentEfficiency,
  getEquipmentOptions,
  type GearFilters,
} from "@/lib/equipment-efficiency-repo"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { MAX_DB_ID } from "@/lib/strict-number"

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const MAX_AMOUNT = 1e15

/** A list of ids as Linko's URLs write them ("295" or "295-331"); anything else is refused. */
function ids(value: string | null): number[] | null {
  if (!value) return []
  const parts = value.split(/[-,]/)
  if (parts.length > 500 || parts.some((part) => !/^[1-9]\d{0,9}$/.test(part) || Number(part) > MAX_DB_ID)) return null
  return [...new Set(parts.map(Number))]
}

/** An amount bound of a range filter: empty = none. */
function amount(value: string | null): number | null | undefined {
  if (value === null || value.trim() === "") return null
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_AMOUNT ? parsed : undefined
}

/**
 * GET /api/equipment-efficiency → «Эффективность оборудования» (lib/equipment-efficiency-repo.ts) with Linko's query
 * names: fromDate / toDate (default: this month), acceptedDateBegin / acceptedDateEnd, responsibleAgents, division,
 * borders, branch, gear, product, marketTypeParent, factFrom / factTo, factByGearFrom / factByGearTo, search,
 * ordering, firstLimit / secondLimit. `?options=1` answers the filter lists, `?orders=<client id>` that client's
 * orders window (also narrowed by productForOrder / productTypeForOrder). Read-only: every signed-in user.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const query = request.nextUrl.searchParams
  if (query.get("options") === "1") return NextResponse.json(await getEquipmentOptions())

  const today = todayIso()
  const from = query.get("fromDate") || monthStartIso(today)
  const to = query.get("toDate") || monthEndIso(today)
  const acceptedFrom = query.get("acceptedDateBegin") ?? ""
  const acceptedTo = query.get("acceptedDateEnd") ?? ""
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return NextResponse.json({ error: "Неверный период" }, { status: 400 })
  if ((acceptedFrom || acceptedTo) && !(ISO_DAY.test(acceptedFrom) && ISO_DAY.test(acceptedTo) && acceptedFrom <= acceptedTo)) {
    return NextResponse.json({ error: "Неверный период" }, { status: 400 })
  }

  const lists = {
    agents: ids(query.get("responsibleAgents")),
    divisions: ids(query.get("division")),
    zones: ids(query.get("borders")),
    branches: ids(query.get("branch")),
    gears: ids(query.get("gear")),
    gearProducts: ids(query.get("product")),
    clientTypes: ids(query.get("marketType") || query.get("marketTypeParent")),
    products: ids(query.get("productForOrder")),
    productTypes: ids(query.get("productTypeForOrder")),
  }
  if (Object.values(lists).some((list) => list === null)) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  const ranges = {
    factFrom: amount(query.get("factFrom")),
    factTo: amount(query.get("factTo")),
    factByGearFrom: amount(query.get("factByGearFrom")),
    factByGearTo: amount(query.get("factByGearTo")),
    firstLimit: amount(query.get("firstLimit")),
    secondLimit: amount(query.get("secondLimit")),
  }
  if (Object.values(ranges).some((value) => value === undefined)) return NextResponse.json({ error: "Введите число" }, { status: 400 })

  const filters: GearFilters = {
    from,
    to,
    acceptedFrom: acceptedFrom || undefined,
    acceptedTo: acceptedTo || undefined,
    agents: lists.agents ?? [],
    divisions: lists.divisions ?? [],
    zones: lists.zones ?? [],
    branches: lists.branches ?? [],
    gears: lists.gears ?? [],
    gearProducts: lists.gearProducts ?? [],
    clientTypes: lists.clientTypes ?? [],
    products: lists.products ?? [],
    productTypes: lists.productTypes ?? [],
    factFrom: ranges.factFrom,
    factTo: ranges.factTo,
    factByGearFrom: ranges.factByGearFrom,
    factByGearTo: ranges.factByGearTo,
    search: (query.get("search") ?? "").slice(0, 200),
    ordering: query.get("ordering") ?? "",
    firstLimit: ranges.firstLimit ?? GEAR_FIRST_LIMIT,
    secondLimit: ranges.secondLimit ?? GEAR_SECOND_LIMIT,
  }

  const ordersOf = query.get("orders")
  if (ordersOf !== null) {
    const clientId = ids(ordersOf)
    if (!clientId || clientId.length !== 1) return NextResponse.json({ error: "Неверный идентификатор" }, { status: 400 })
    return NextResponse.json(await getEquipmentClientOrders(clientId[0], filters))
  }
  return NextResponse.json(await getEquipmentEfficiency(filters))
}
