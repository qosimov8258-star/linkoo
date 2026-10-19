import type { DictionaryUsage } from "./dictionaries-data"

// "Ед.измерения" (demo #/measurement, API main/measurement/ and the tree
// main/measurement/hierarchy/). Two levels (the parent picker lists top-level units only,
// demo params {parent: 0}). Products store the unit NAME in unit / product_group / sub_unit.

export const UNITS_OF_MEASURE_API = "/api/units-of-measure"

/** The first four fields are the original GET /api/units-of-measure array shape. */
export type UnitOfMeasure = {
  id: number
  name: string
  /** "08 окт. 2026". */
  createdDate: string
  parentId: number | null
  /** "Развесной товар" (demo is_weighted). */
  isWeighted: boolean
  /** Local ISO "YYYY-MM-DDTHH:MM:SS". */
  createdAt: string
}

export type UnitOfMeasureNode = UnitOfMeasure & { parentName: string; children: UnitOfMeasureNode[] }

/** GET /api/units-of-measure?view=tree … — top-level units (paged) with their children. */
export type UnitOfMeasureTreeResult = { count: number; results: UnitOfMeasureNode[] }

/** GET /api/units-of-measure/[id] (?usage=1 adds `usage`). */
export type UnitOfMeasureDetail = UnitOfMeasure & { parentName: string; childCount: number; usage?: DictionaryUsage[] }

export type UnitOfMeasurePayload = { name: string; parentId: number | null; isWeighted: boolean }

export const UNIT_ORDERINGS = ["name", "created_date"] as const
export type UnitOrderingField = (typeof UNIT_ORDERINGS)[number]
