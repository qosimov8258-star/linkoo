// "Тип ячейки" (demo #/cell-type, API stock/cell_type/hierarchy/) and "Ячейки" (demo #/cell,
// API stock/cell/). Storage rules are in lib/cells-repo.ts.

export const CELL_TYPES_API = "/api/cell-types"
export const CELLS_API = "/api/cells"

export type CellType = {
  id: number
  name: string
  parentId: number | null
  /** "26 авг. 2025". */
  createdDate: string
  /** Local ISO "YYYY-MM-DDTHH:MM:SS". */
  createdAt: string
}

export type CellTypeNode = CellType & { children: CellTypeNode[] }

/** GET /api/cell-types?view=tree — the grid of "Тип ячейки". */
export type CellTypeTreeResult = { count: number; results: CellTypeNode[] }

export type Cell = {
  id: number
  name: string
  barcode: string
  cellTypeId: number | null
  /** Name of the cell type; "" = none. */
  cellType: string
  createdDate: string
  createdAt: string
}

/** GET /api/cells?page=… — the grid of "Ячейки". */
export type CellListResult = { count: number; results: Cell[] }

export type CellTypePayload = { name: string; parentId: number | null }
export type CellPayload = { name: string; barcode: string; cellTypeId: number | null }
