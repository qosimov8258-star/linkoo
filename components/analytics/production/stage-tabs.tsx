"use client"

import { askDelete } from "@/lib/ask-confirm"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"

import { useLanguage } from "@/lib/i18n/language-context"
import { strictNumber } from "@/lib/strict-number"
import { CashSnackbar, MultiPick, SearchSelect, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { FilterChip } from "@/components/staff/staff-kit"
import { CatalogFilterBar } from "@/components/products/catalog-filter"
import { filterCount, listUrl } from "@/components/products/catalog-state"
import { EMPTY_CATALOG_FILTERS, type CatalogOptions } from "@/lib/products-types"
import { FilterSelect, RI, RefButton, RefEmpty, RefFilterPanel, RefIconButton, RefToolbar, usePaging } from "@/components/ref/list-kit"
import type { Recipe } from "./batch-detail"
import { EQUIPMENT_PHOTO_ACCEPT, readEquipmentPhoto } from "./equipment-photo"
import {
  api,
  Field,
  inputClass,
  Modal,
  PRODUCTION_WRITE,
  SaveButton,
  useApiData,
  type CatalogItem,
  type Stage,
} from "./production-ui"
import { notify } from "@/lib/notify"
import {
  formatNorm,
  normPickerItems,
  NormItemPicker,
  NormLinesField,
  OperationsChipField,
  parseQuantity,
  QTY_ERROR,
  refusalMessage,
  REQUIRED_ERROR,
  requestJson,
  RobotEmpty,
  useCanChangeProducts,
  useProductsView,
  useSuccessNotice,
  type NormLine,
  type ProductsView,
} from "./stage-products-kit"

/** A machine (GET /api/production/equipment): `status` as stored ("0" не работает, "1" рабочий, other values
 * «получить продукт»), `image` the URL its picture is read from ("" without one). */
export type Equipment = { id: number; stageId: number; stageName?: string; name: string; status: string; image: string; lastShipment: number | null }
/** `stageId`: only where an older version filed it (operations are global; null for new ones). */
type Operation = { id: number; stageId: number | null; title: string; duration: number; type: "equipment" | "human"; equipmentId: number | null; equipmentName: string }
/** A staff row (GET /api/production/staff): an employee on a shift of the Смены directory (`shiftId`; null for an
 * older row whose shift is not there), with the shift's current name and times. */
export type StaffMember = { id: number; stageId: number; employeeId: number | null; employeeName: string; position: string; shiftId: number | null; shift: string; beginTime: string; endTime: string }
/** An employee of the staff dialog's «Сотрудник» list (GET /api/employees). */
type Employee = { id: number; name: string; active?: boolean }

async function run(action: () => Promise<unknown>, after: () => void) {
  try {
    await action()
    after()
  } catch (error) {
    notify((error as Error).message)
  }
}

type Paging = ReturnType<typeof usePaging>

/** The reference's tab card: "+ add" link above, then one white card with the toolbar and the table. */
function TabCard({
  addLabel,
  onAdd,
  query,
  onQuery,
  count,
  filter,
  onApplyFilter,
  paging,
  addAsButton,
  customFilter,
  selectMode,
  onToggleSelect,
  selectedActions,
  filterCount = 0,
  onClearFilter,
  filterOpen: filterOpenProp,
  onFilterOpen,
  children,
}: {
  customFilter?: ReactNode
  selectMode?: boolean
  /** The «Выбрать из списка» icon is shown only with a handler (no dead icon). */
  onToggleSelect?: () => void
  selectedActions?: ReactNode
  addAsButton?: boolean
  addLabel: string
  /** Omitted: no add control (e.g. a user who may not change the data). */
  onAdd?: () => void
  query: string
  onQuery: (value: string) => void
  count: number
  filter?: ReactNode
  /** «Применить» of the filter panel (a filter without it applies as it changes). */
  onApplyFilter?: () => void
  /** Applied filter fields: above 0 the toolbar shows "Фильтр: N" with edit and clear (needs `onClearFilter`). */
  filterCount?: number
  onClearFilter?: () => void
  /** The filter panel's open state, when the caller keeps it (e.g. in the address); internal otherwise. */
  filterOpen?: boolean
  onFilterOpen?: (open: boolean) => void
  paging: Paging
  children: ReactNode
}) {
  const { t } = useLanguage()
  const [ownFilterOpen, setOwnFilterOpen] = useState(false)
  const filterOpen = filterOpenProp ?? ownFilterOpen
  const setFilterOpen = (open: boolean) => (onFilterOpen ? onFilterOpen(open) : setOwnFilterOpen(open))
  const addButton = addAsButton && onAdd
  return (
    <>
      <div className="flex h-[56px] items-center justify-end pr-[16px]">
        {!addAsButton && onAdd && (
          <button type="button" onClick={onAdd} className="text-[13px] text-[#1E4A9A] hover:underline">
            + {t(addLabel)}
          </button>
        )}
      </div>
      <div className="bg-white font-sans text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <RefToolbar
          linkFilter
          filterWidth={284}
          hideFilter={!filter && !addButton && !customFilter}
          searchWidth={266}
          pageSizeMenu
          leftSlot={
            customFilter ? (
              customFilter
            ) : addButton ? (
              <div className="pl-[5px]"><RefButton icon={RI.add} label={t(addLabel)} onClick={onAdd} /></div>
            ) : filter ? (
              filterCount > 0 && onClearFilter && !filterOpen ? (
                <FilterChip count={filterCount} onEdit={() => setFilterOpen(true)} onClear={onClearFilter} />
              ) : (
                <button type="button" onClick={() => setFilterOpen(!filterOpen)} className="text-[13px] text-[#1E4A9A]">
                  {filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")} ⌄
                </button>
              )
            ) : undefined
          }
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen(!filterOpen)}
          filterPanel={
            <RefFilterPanel
              narrow
              onClose={() => setFilterOpen(false)}
              onApply={() => {
                onApplyFilter?.()
                paging.setPage(1)
                setFilterOpen(false)
              }}
            >
              {filter}
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => {
            onQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={paging.start + 1}
          to={count ? paging.end : 0}
          total={count}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={
            selectedActions || onToggleSelect ? (
              <>
                {selectedActions}
                {onToggleSelect && (
                  <RefIconButton path={selectMode ? "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" : RI.checklist} label={t("Выбрать из списка")} color="#5d6474" onClick={onToggleSelect} />
                )}
              </>
            ) : undefined
          }
        />
        {children}
      </div>
    </>
  )
}

/** Columns measured from the reference: px numbers (the first one gets the 30px row inset), or any CSS width such
 * as "33.333%" (the reference's percentage grids, which keep the row buttons inside narrow cards); the last column
 * takes the rest. `loading`: the reference's loader instead of the empty state until the first response. */
function DataTable({ headers, children, empty, widths, hideHead, hideBody, selectAll, loading }: { headers: string[]; children: ReactNode; empty: boolean; colSpan?: number; widths: Array<number | string>; hideHead?: boolean; hideBody?: boolean; selectAll?: { checked: boolean; onChange: (checked: boolean) => void }; loading?: boolean }) {
  const { t } = useLanguage()
  const cols = headers.length
  const width = (index: number) => {
    const value = widths[index] ?? 200
    return typeof value === "number" ? value + (index === 0 ? 30 : 0) : value
  }
  return (
    <div className="overflow-x-auto">
      <style>{".prod-table tbody tr{background:linear-gradient(to right,#d9e0e5 2px,transparent 2px) left bottom/8px 2px repeat-x}"}</style>
      <table
        // The header band is painted once, as the table's own background under the 50 px header row: the thead's colour alone is painted cell by cell, and at a fractional zoom / device scale (125 %, 150 %) light 1 px seams show between the header cells.
        style={hideHead ? undefined : { background: "linear-gradient(#5d6474, #5d6474) top / 100% 50px no-repeat" }}
        className={[
          "w-full min-w-[640px] table-fixed border-collapse text-[13px]",
          "prod-table [&_td]:!h-[50px] [&_td]:!px-2 [&_td]:!py-0 [&_td:first-child]:!pl-[30px] [&_td]:align-middle [&_td]:leading-[16px]",
          "[&_th]:!h-[50px] [&_th]:!px-2 [&_th]:!py-0 [&_th:first-child]:!pl-[30px] [&_th]:text-left [&_th]:leading-[16px]",
          "[&_tbody_tr]:!border-b-0 [&_tbody_tr:hover]:bg-[#f2f5f8]",
        ].join(" ")}
      >
        <colgroup>
          {headers.map((header, index) => (
            <col key={`${header}-${index}`} style={index < cols - 1 ? { width: width(index) } : undefined} />
          ))}
        </colgroup>
        {!hideHead && (
          <thead className="bg-[#5d6474] text-white">
            <tr>{headers.map((header, index) => <th key={`${header}-${index}`} className="font-semibold">{index === 0 && selectAll ? <span className="flex items-center"><input type="checkbox" checked={selectAll.checked} onChange={(event) => selectAll.onChange(event.target.checked)} className="mr-[10px] h-4 w-4 cursor-pointer accent-[#5d6474]" aria-label={t("Выбрать все")} />{t(header)}</span> : header ? t(header) : null}</th>)}</tr>
          </thead>
        )}
        <tbody>{hideBody || loading ? null : children}</tbody>
      </table>
      {loading ? <RollerLoader className="h-[276px] pt-[100px]" /> : empty && <RefEmpty text={t("По вашему запросу ничего не найдено")} />}
    </div>
  )
}

// The reference's list loader (its 8-dot roller at scale 0.75), in the app's accent colour.
const ROLLER_DOTS: Array<[number, number]> = [[50, 50], [54, 45], [57, 39], [58, 32], [57, 25], [54, 19], [50, 14], [45, 10]]

/** Loader shown on white until a list's first response (the stage list, the tab tables). */
export function RollerLoader({ className = "" }: { className?: string }) {
  const { t } = useLanguage()
  return (
    <div role="status" aria-label={t("Загрузка...")} className={`flex justify-center bg-white ${className}`}>
      <style>{"@keyframes prod-roller{to{transform:rotate(360deg)}}"}</style>
      <div className="relative h-16 w-16 shrink-0 scale-75">
        {ROLLER_DOTS.map(([top, left], index) => (
          <div key={index} className="absolute inset-0" style={{ animation: `prod-roller 1.2s cubic-bezier(0.5, 0, 0.5, 1) ${-0.036 * (index + 1)}s infinite`, transformOrigin: "32px 32px" }}>
            <span className="absolute h-[6px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1E4A9A]" style={{ top, left }} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** DELETE that spells a refusal out in the UI language: "Удаление невозможно из-за связи с другими данными:
 * Партии (1), Персонал (2)" from the API's {error, usage}. Null when it went through. */
export async function deleteRecord(url: string, t: (text: string) => string): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(url, { method: "DELETE" })
  } catch {
    return t("Сервер недоступен, попробуйте ещё раз")
  }
  if (response.ok) return null
  const data = (await response.json().catch(() => ({}))) as { error?: unknown; usage?: unknown }
  const base = t(typeof data.error === "string" && data.error ? data.error : "Не удалось выполнить запрос")
  const usage = Array.isArray(data.usage) ? (data.usage as Array<{ label?: unknown; count?: unknown }>).filter((item) => typeof item?.label === "string") : []
  return usage.length ? `${base}: ${usage.map((item) => `${t(String(item.label))} (${Number(item.count) || 0})`).join(", ")}` : base
}

/** Who may change the production master data (the server's rule for /api/production writes; production-ui.tsx). */
export { PRODUCTION_WRITE }

const EDIT_ICON = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const DELETE_ICON = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"

/** Linko's row buttons: its filled pencil and bin, shown on the row under the pointer (or with keyboard focus). */
function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  return (
    <span className="flex justify-end opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={t("Изменить")} title={t("Изменить")} className="flex h-[30px] w-[30px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#555] hover:fill-[#1E4A9A]"><path d={EDIT_ICON} /></svg>
        </button>
      )}
      <button type="button" onClick={onDelete} aria-label={t("Удалить")} title={t("Удалить")} className="flex h-[30px] w-[30px] items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#555] hover:fill-[#e53935]"><path d={DELETE_ICON} /></svg>
      </button>
    </span>
  )
}

const matches = (query: string, ...values: string[]) => {
  const normalized = query.trim().toLocaleLowerCase("ru")
  return !normalized || values.join(" ").toLocaleLowerCase("ru").includes(normalized)
}

// ---------------------------------------------------------------------------
// Продукция
// ---------------------------------------------------------------------------

/** A stage product as /api/production/recipes returns it (lib/production-stages-repo.ts ProductionRecipe). */
type StageRecipe = Recipe & { stageId: number; code: string; operations: Array<{ id: number; operationId: number; title: string; type: "equipment" | "human" }> }
type RecipeLine = Recipe["components"][number]
type ProductsDialog =
  | { kind: "add" }
  | { kind: "line"; recipe: StageRecipe; role: "raw" | "ready" }
  | { kind: "editLine"; line: RecipeLine }
  | { kind: "norm"; recipe: StageRecipe }
  | { kind: "attach"; recipeIds: number[] }

const PRODUCTS_FILTER_WIDTH = 284
const ADD_BOX_ICON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
const MINUS_BOX_ICON = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"

/** The reference's «Продукция» of a stage: its products (newest first) with their norms. «Выбрать из списка» shows
 * checkboxes; with products ticked the toolbar reads «Выбрано: N» with «Прикрепить операцию» and «Снять
 * выделение». The search (name, code), the filter, the page and the opened product are kept in the address. */
export function ProductsTab({ stage, equipment }: { stage: Stage; equipment: Equipment[] }) {
  const { t } = useLanguage()
  const canEdit = useCanChangeProducts(PRODUCTION_WRITE)
  const { data: recipes, setData: setRecipes, reload, loading } = useApiData<StageRecipe[]>(`/api/production/recipes?stageId=${stage.id}`, [])
  const { data: catalog } = useApiData<CatalogItem[]>("/api/production/items", [])
  const [view, setView] = useProductsView(stage.id)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<ProductsDialog | null>(null)
  const notice = useSuccessNotice()

  const { data: filterOptions, reload: reloadOptions } = useApiData<CatalogOptions | null>("/api/products/options", null)
  // The reference's "Фильтр" is the product catalog filter; the matching products decide which recipes stay.
  const matchUrl = filterCount(view.filters) > 0 ? listUrl("product", { tab: "", search: "", ordering: "", page: 1, pageSize: 0, filters: view.filters, detailId: null }, { pageSize: 0 }) : null
  const { data: matching } = useApiData<{ results: Array<{ id: number }> } | null>(matchUrl, null)
  const matchingIds = matchUrl && matching ? new Set(matching.results.map((row) => row.id)) : null
  // The filter picks catalog products (a raw-material recipe never matches it); the search reads the name and the
  // product code, as the reference's.
  const rows = recipes.filter((recipe) => (!matchingIds || (recipe.kind === "product" && matchingIds.has(recipe.itemId))) && matches(view.search, recipe.name, recipe.code))
  const pageCount = Math.max(1, Math.ceil(rows.length / view.pageSize))
  const page = Math.min(view.page, pageCount)
  const start = (page - 1) * view.pageSize
  const end = Math.min(start + view.pageSize, rows.length)
  const visible = rows.slice(start, end)
  const splitIndex = view.expanded === null ? -1 : visible.findIndex((recipe) => recipe.key === view.expanded)
  const expandedRecipe = splitIndex >= 0 ? visible[splitIndex] : null
  const before = splitIndex >= 0 ? visible.slice(0, splitIndex) : []
  const after = splitIndex >= 0 ? visible.slice(splitIndex + 1) : []
  const hasSelection = selectMode && selected.length > 0
  const update = (patch: Partial<ProductsView>) => setView((current) => ({ ...current, ...patch }))
  // A product moved to another stage («Изменение нормы» → Производство) leaves this list.
  const replace = (recipe: StageRecipe) =>
    setRecipes((current) => (recipe.stageId === stage.id ? current.map((entry) => (entry.id === recipe.id ? recipe : entry)) : current.filter((entry) => entry.id !== recipe.id)))
  const closeDialog = () => setDialog(null)
  const saved = () => notice.show("Успешно сохранено")

  async function removeRecipe(recipe: StageRecipe) {
    if (!(await askDelete(recipe.name))) return
    await run(() => api(`/api/production/recipes/${recipe.id}`, { method: "DELETE" }), () => {
      update({ expanded: null })
      setSelected((current) => current.filter((id) => id !== recipe.id))
      reload()
      notice.show("Успешно удалено")
    })
  }

  /** Mezon's bulk delete of the ticked products (the reference has none): one confirmation naming them. */
  async function removeSelected() {
    const chosen = recipes.filter((recipe) => selected.includes(recipe.id))
    if (!chosen.length) return
    const names = chosen.map((recipe) => recipe.name)
    if (!(await askDelete(names.length > 10 ? `${names.slice(0, 10).join(", ")}, …` : names.join(", ")))) return
    let deleted = 0
    for (const recipe of chosen) {
      await run(() => api(`/api/production/recipes/${recipe.id}`, { method: "DELETE" }), () => {
        deleted += 1
      })
    }
    setSelected([])
    update({ expanded: null })
    reload()
    if (deleted) notice.show("Успешно удалено")
  }

  async function removeLine(line: RecipeLine) {
    if (!(await askDelete(line.name))) return
    await run(async () => replace(await api<StageRecipe>(`/api/production/recipe-components/${line.id}`, { method: "DELETE" })), () => notice.show("Успешно удалено"))
  }

  async function detachOperation(link: StageRecipe["operations"][number]) {
    if (!(await askDelete(link.title))) return
    await run(async () => replace(await api<StageRecipe>(`/api/production/product-operations/${link.id}`, { method: "DELETE" })), () => notice.show("Успешно удалено"))
  }

  const toggleSelected = (id: number, checked: boolean) => setSelected((current) => (checked ? (current.includes(id) ? current : [...current, id]) : current.filter((entry) => entry !== id)))
  const selectAll = selectMode ? { checked: visible.length > 0 && visible.every((recipe) => selected.includes(recipe.id)), onChange: (checked: boolean) => setSelected(checked ? visible.map((recipe) => recipe.id) : []) } : undefined
  const productRow = (recipe: StageRecipe) => (
    <tr key={recipe.id} onClick={() => update({ expanded: recipe.key })} className="cursor-pointer hover:bg-[#f2f5f8]">
      <td className="px-6 py-4">
        {selectMode && <input type="checkbox" checked={selected.includes(recipe.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(recipe.id, event.target.checked)} data-no-translate className="mr-[10px] h-4 w-4 cursor-pointer align-middle accent-[#5d6474]" aria-label={recipe.name} />}
        {/* Stored names, product types and units are data: the page translator leaves them alone. */}
        <span data-no-translate>{recipe.name}</span>
      </td>
      <td data-no-translate className="px-6 py-4">{recipe.type || "N/A"}</td>
      <td data-no-translate className="px-6 py-4">{formatNorm(recipe.amount, recipe.unit)}</td>
    </tr>
  )

  return (
    <>
      <div className="flex h-[56px] items-center justify-end pr-[16px]">
        {canEdit && (
          <button type="button" onClick={() => setDialog({ kind: "add" })} className="text-[13px] text-[#1E4A9A] hover:underline">
            + {t("добавить продукцию")}
          </button>
        )}
      </div>
      <div className="bg-white font-sans text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <RefToolbar
          linkFilter
          filterWidth={PRODUCTS_FILTER_WIDTH}
          searchWidth={266}
          pageSizeMenu
          hideSearch={hasSelection}
          leftSlot={
            hasSelection ? (
              <span className="pl-[5px] text-[13px] font-semibold text-[#333]">{t("Выбрано")}: {selected.length}</span>
            ) : (
              <CatalogFilterBar
                kind="product"
                filters={view.filters}
                options={filterOptions}
                open={filterOpen}
                // The applied-filter bar starts 5px left of the filter column and must end inside it (else the search covers its ×).
                barWidth={PRODUCTS_FILTER_WIDTH + 5}
                hidePerfectStore
                searchableType
                onOpen={() => {
                  reloadOptions()
                  setFilterOpen(true)
                }}
                onClose={() => setFilterOpen(false)}
                onClear={() => {
                  setFilterOpen(false)
                  update({ filters: EMPTY_CATALOG_FILTERS, page: 1 })
                }}
                onApply={(next) => {
                  setFilterOpen(false)
                  update({ filters: next, page: 1 })
                }}
              />
            )
          }
          query={view.search}
          onQuery={(value) => update({ search: value, page: 1 })}
          pageSize={view.pageSize}
          onPageSize={(size) => update({ pageSize: size, page: 1 })}
          from={start + 1}
          to={rows.length ? end : 0}
          total={rows.length}
          page={page}
          pageCount={pageCount}
          onPage={(next) => update({ page: next })}
          icons={
            canEdit ? (
              hasSelection ? (
                <>
                  <span className="mr-[10px]"><RefButton red label={`${t("Удалить")} (${selected.length})`} onClick={removeSelected} /></span>
                  <RefIconButton path={ADD_BOX_ICON} label="Прикрепить операцию" color="#5d6474" onClick={() => setDialog({ kind: "attach", recipeIds: selected })} />
                  <RefIconButton path={MINUS_BOX_ICON} label="Снять выделение" color="#5d6474" onClick={() => setSelected([])} />
                </>
              ) : (
                <RefIconButton
                  path={selectMode ? RI.eyeOff : RI.checklist}
                  label={selectMode ? "Спрятать флажки" : "Выбрать из списка"}
                  color="#5d6474"
                  onClick={() => {
                    setSelectMode((value) => !value)
                    setSelected([])
                  }}
                />
              )
            ) : undefined
          }
        />
        <DataTable headers={["Наименование", "Тип товара", "Кол-во"]} widths={[458, 367]} empty={!visible.length} loading={loading && !recipes.length} hideBody={splitIndex >= 0 && before.length === 0} selectAll={selectAll}>
          {(splitIndex >= 0 ? before : visible).map(productRow)}
        </DataTable>
      </div>
      {expandedRecipe && (
        <>
          <RecipeDetail
            recipe={expandedRecipe}
            canEdit={canEdit}
            onClose={() => update({ expanded: null })}
            onDelete={() => removeRecipe(expandedRecipe)}
            onAdd={(role) => setDialog({ kind: "line", recipe: expandedRecipe, role })}
            onNorm={() => setDialog({ kind: "norm", recipe: expandedRecipe })}
            onEditLine={(line) => setDialog({ kind: "editLine", line })}
            onRemoveLine={removeLine}
            onDetach={detachOperation}
          />
          {after.length > 0 && (
            <div className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
              <DataTable headers={["Наименование", "Тип товара", "Кол-во"]} widths={[458, 367]} empty={false} hideHead>
                {after.map(productRow)}
              </DataTable>
            </div>
          )}
        </>
      )}

      {dialog?.kind === "add" && (
        <AddRecipeDialog
          stage={stage}
          equipment={equipment}
          catalog={catalog}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog()
            reload()
            saved()
          }}
        />
      )}
      {dialog?.kind === "line" && (
        <ComponentDialog
          recipe={dialog.recipe}
          role={dialog.role}
          catalog={catalog}
          onClose={closeDialog}
          onSaved={(recipe) => {
            replace(recipe)
            closeDialog()
            saved()
          }}
        />
      )}
      {dialog?.kind === "editLine" && (
        <ComponentEditDialog
          line={dialog.line}
          onClose={closeDialog}
          onSaved={(recipe) => {
            replace(recipe)
            closeDialog()
            saved()
          }}
        />
      )}
      {dialog?.kind === "norm" && (
        <NormDialog
          recipe={dialog.recipe}
          stage={stage}
          equipment={equipment}
          onClose={closeDialog}
          onSaved={(recipe) => {
            replace(recipe)
            if (recipe.stageId !== stage.id) update({ expanded: null })
            closeDialog()
            saved()
          }}
        />
      )}
      {dialog?.kind === "attach" && (
        <AttachOperationsDialog
          recipeIds={dialog.recipeIds}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog()
            // Selections reset after a save.
            setSelected([])
            reload()
            saved()
          }}
        />
      )}
      {notice.node}
    </>
  )
}

/** The opened product: "<name> - <amount unit>" (the whole title closes it, as the reference's), its icons, the raw
 * norm, the ready lines (only when it has some: the reference shows no «Готовый продукт» block otherwise) and the
 * attached operations. The reference's «Изменение нормы» dialog has no control of its own there (only its address
 * opens it): the pencil opens it here. */
function RecipeDetail({
  recipe,
  canEdit,
  onClose,
  onDelete,
  onAdd,
  onNorm,
  onEditLine,
  onRemoveLine,
  onDetach,
}: {
  recipe: StageRecipe
  canEdit: boolean
  onClose: () => void
  onDelete: () => void
  onAdd: (role: "raw" | "ready") => void
  onNorm: () => void
  onEditLine: (line: RecipeLine) => void
  onRemoveLine: (line: RecipeLine) => void
  onDetach: (link: StageRecipe["operations"][number]) => void
}) {
  const raw = recipe.components.filter((component) => component.role === "raw")
  const ready = recipe.components.filter((component) => component.role === "ready")
  return (
    <div className="mx-[-15px] my-5 bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[30px]">
        <button type="button" onClick={onClose} className="flex min-w-0 items-center text-left text-[18px] font-semibold text-[#333]">
          <span data-no-translate className="truncate">{recipe.name}</span>
          <span className="mx-[6px]">-</span>
          <i data-no-translate className="whitespace-nowrap">{formatNorm(recipe.amount, recipe.unit)}</i>
          {recipe.equipmentName && <span data-no-translate className="ml-3 whitespace-nowrap text-[13px] font-normal text-[#666]">({recipe.equipmentName})</span>}
        </button>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-[24px] pr-[12px]">
            <IconButton label="Изменение нормы" onClick={onNorm}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.edit} /></svg></IconButton>
            <IconButton label="Удалить продукт" onClick={onDelete}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></IconButton>
            <IconButton label="Добавить сырье" onClick={() => onAdd("raw")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" /></svg></IconButton>
            <IconButton label="Добавить готовый продукт" onClick={() => onAdd("ready")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm14 0v4h-4v2h4v4h2v-4h4v-2h-4v-4h-2z" /></svg></IconButton>
          </div>
        )}
      </div>
      <div className="pb-[10px] pl-[30px] pr-[30px]">
        {raw.length ? (
          <ComponentList title="Сырье" rows={raw} onEdit={canEdit ? onEditLine : undefined} onRemove={canEdit ? onRemoveLine : undefined} />
        ) : (
          <RobotEmpty text="В данном продукте нет сырья" size={155} />
        )}
        <ComponentList title="Готовый продукт" rows={ready} onEdit={canEdit ? onEditLine : undefined} onRemove={canEdit ? onRemoveLine : undefined} />
        <OperationLinks rows={recipe.operations} onRemove={canEdit ? onDetach : undefined} />
      </div>
    </div>
  )
}

const DOTTED = "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"
/** The columns of a product's lists: name, amount, the row icons (each list keeps its bin in the same place). */
const NORM_COLUMNS = "479px 400px minmax(0,1fr)"

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  return <button onClick={onClick} title={t(label)} aria-label={t(label)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#f2f5f8]">{children}</button>
}

/** «Сырье | Объем» / «Готовый продукт | Объем»: a line has «Изменить» (the reference's «Редактирование сырья»; a ready
 * line's pencil is Mezon's, kept as it works) and «Удалить»; every list keeps its icons in the same columns. */
function ComponentList({ title, rows, onEdit, onRemove }: { title: string; rows: RecipeLine[]; onEdit?: (row: RecipeLine) => void; onRemove?: (row: RecipeLine) => void }) {
  const { t } = useLanguage()
  if (!rows.length) return null
  return (
    <div>
      <div className={`relative grid h-[50px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: NORM_COLUMNS }}>
        <div>{t(title)}</div>
        <div>{t("Объем")}</div>
        <div />
      </div>
      {rows.map((row) => (
        <div key={row.id} className={`relative grid min-h-[50px] items-center ${DOTTED}`} style={{ gridTemplateColumns: NORM_COLUMNS }}>
          <div data-no-translate className="min-w-0 break-words pr-4">{row.name}</div>
          <div data-no-translate>{formatNorm(row.amount, row.unit)}</div>
          <div className="flex items-center gap-[15px] pl-[5px]">
            {onRemove && (
              <>
                {onEdit ? (
                  <button type="button" onClick={() => onEdit(row)} aria-label={t("Изменить")} title={t("Изменить")}>
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d={RI.edit} /></svg>
                  </button>
                ) : (
                  <span className="h-5 w-5" aria-hidden />
                )}
                <button type="button" onClick={() => onRemove(row)} aria-label={t("Удалить")} title={t("Удалить")}>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d={RI.trash} /></svg>
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The operations attached to the product («Прикрепить операцию»), each with «Удалить» (detaches it). */
function OperationLinks({ rows, onRemove }: { rows: StageRecipe["operations"]; onRemove?: (row: StageRecipe["operations"][number]) => void }) {
  const { t } = useLanguage()
  if (!rows.length) return null
  return (
    <div>
      <div className={`relative grid h-[50px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: NORM_COLUMNS }}>
        <div>{t("Операции")}</div>
        <div>{t("Тип")}</div>
        <div />
      </div>
      {rows.map((row) => (
        <div key={row.id} className={`relative grid min-h-[50px] items-center ${DOTTED}`} style={{ gridTemplateColumns: NORM_COLUMNS }}>
          <div data-no-translate className="min-w-0 break-words pr-4">{row.title}</div>
          <div>{t(row.type === "human" ? "Трудовые затраты" : "Оборудование")}</div>
          <div className="flex items-center gap-[15px] pl-[5px]">
            {onRemove && (
              <>
                <span className="h-5 w-5" aria-hidden />
                <button type="button" onClick={() => onRemove(row)} aria-label={t("Удалить")} title={t("Удалить")}>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d={RI.trash} /></svg>
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A field's validation message (it clears as soon as the field changes). */
function FieldError({ text }: { text?: string }) {
  const { t } = useLanguage()
  return text ? <span className="mt-1 block text-[12px] font-normal text-[#f44336]">{t(text)}</span> : null
}

/** The reference's «Добавление продукта»: Продукт, Оборудование (of the stage) and Кол-во are required («Это поле
 * обязательно к заполнению»); Кол-во starts empty; «Сырье» is the raw list. */
function AddRecipeDialog({ stage, equipment, catalog, onClose, onSaved }: { stage: Stage; equipment: Equipment[]; catalog: CatalogItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [amount, setAmount] = useState("")
  const [lines, setLines] = useState<NormLine[]>([])
  const [errors, setErrors] = useState<Partial<Record<"product" | "equipment" | "amount", string>>>({})
  const [saving, setSaving] = useState(false)
  const products = useMemo(() => normPickerItems(catalog, true), [catalog])
  const rawItems = useMemo(() => normPickerItems(catalog), [catalog])

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = parseQuantity(amount)
    const next = {
      product: key ? undefined : REQUIRED_ERROR,
      equipment: equipmentId ? undefined : REQUIRED_ERROR,
      amount: value !== null ? undefined : amount.trim() ? QTY_ERROR : REQUIRED_ERROR,
    }
    setErrors(next)
    if (next.product || next.equipment || value === null) return
    setSaving(true)
    try {
      // The list shows the newest line first (the reference's handleAdd); it is sent oldest first, so the saved norm
      // lists its lines in the order they were added, as the reference's does (it lists them by line id DESC).
      const components = [...lines].reverse().filter((line) => line.key !== key).map((line) => ({ role: "raw", ...line }))
      await requestJson("/api/production/recipes", {
        method: "POST",
        body: { stageId: stage.id, key, equipmentId: Number(equipmentId), amount: value, components },
      })
      onSaved()
    } catch (error) {
      notify(refusalMessage(error, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Добавление продукта")} tall closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <div className="space-y-5">
        <Field label="Продукт">
          <NormItemPicker
            items={products}
            value={key}
            invalid={Boolean(errors.product)}
            onChange={(next) => {
              setKey(next)
              // The product cannot be its own raw material (the reference drops such a line).
              setLines((current) => current.filter((line) => line.key !== next))
              setErrors((current) => ({ ...current, product: undefined }))
            }}
          />
          <FieldError text={errors.product} />
        </Field>
        <Field label="Оборудование">
          <select
            value={equipmentId}
            onChange={(event) => {
              setEquipmentId(event.target.value)
              setErrors((current) => ({ ...current, equipment: undefined }))
            }}
            className={`${inputClass} ${errors.equipment ? "border-[#f44336]" : ""}`}
          >
            <option value="" />
            {equipment.map((entry) => <option key={entry.id} value={entry.id} data-no-translate>{entry.name}</option>)}
          </select>
          <FieldError text={errors.equipment} />
        </Field>
        <Field label="Кол-во">
          <input
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              setErrors((current) => ({ ...current, amount: undefined }))
            }}
            inputMode="decimal"
            className={`${inputClass} ${errors.amount ? "border-[#f44336]" : ""}`}
          />
          <FieldError text={errors.amount} />
        </Field>
        <NormLinesField items={rawItems} lines={lines} onChange={setLines} exclude={key || undefined} />
      </div>
    </Modal>
  )
}

/** The reference's «Добавление сырья» / «Добавление продукта» (a ready line) of an opened product: «Наименование
 * товара» and «Кол-во». Like its picker (GET /main/product/?exclude=<the norm's lines>) the lines the norm has are
 * left out, so none is overwritten unseen; the product may be one of its ready lines, never its own raw material. */
function ComponentDialog({ recipe, role, catalog, onClose, onSaved }: { recipe: StageRecipe; role: "raw" | "ready"; catalog: CatalogItem[]; onClose: () => void; onSaved: (recipe: StageRecipe) => void }) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [errors, setErrors] = useState<Partial<Record<"item" | "amount", string>>>({})
  const [saving, setSaving] = useState(false)
  const items = useMemo(() => {
    const taken = new Set(recipe.components.filter((line) => line.role === role).map((line) => line.key))
    return normPickerItems(catalog, role === "ready").filter((item) => !taken.has(item.key) && !(role === "raw" && item.key === recipe.key))
  }, [catalog, recipe, role])

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = parseQuantity(amount)
    const next = { item: key ? undefined : REQUIRED_ERROR, amount: value !== null ? undefined : amount.trim() ? QTY_ERROR : REQUIRED_ERROR }
    setErrors(next)
    if (next.item || value === null) return
    setSaving(true)
    try {
      onSaved(await api<StageRecipe>(`/api/production/recipes/${recipe.id}/components`, { method: "POST", body: { role, key, amount: value } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(role === "ready" ? "Добавление продукта" : "Добавление сырья")} tall closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <div className="space-y-5">
        <Field label="Наименование товара">
          <NormItemPicker
            items={items}
            value={key}
            invalid={Boolean(errors.item)}
            onChange={(next) => {
              setKey(next)
              setErrors((current) => ({ ...current, item: undefined }))
            }}
          />
          <FieldError text={errors.item} />
        </Field>
        <Field label="Кол-во">
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setErrors((current) => ({ ...current, amount: undefined }))
              }}
              inputMode="decimal"
              className={`${inputClass} ${errors.amount ? "border-[#f44336]" : ""}`}
            />
            <span data-no-translate className="text-sm text-slate-500">{items.find((item) => item.key === key)?.unit}</span>
          </div>
          <FieldError text={errors.amount} />
        </Field>
      </div>
    </Modal>
  )
}

/** The reference's «Редактирование сырья» (300px): the line's Кол-во with its unit («Редактирование продукта» for a
 * ready line). */
function ComponentEditDialog({ line, onClose, onSaved }: { line: RecipeLine; onClose: () => void; onSaved: (recipe: StageRecipe) => void }) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState(String(line.amount))
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = parseQuantity(amount)
    if (value === null) {
      setError(amount.trim() ? QTY_ERROR : REQUIRED_ERROR)
      return
    }
    setSaving(true)
    try {
      onSaved(await api<StageRecipe>(`/api/production/recipe-components/${line.id}`, { method: "PUT", body: { amount: value } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(line.role === "ready" ? "Редактирование продукта" : "Редактирование сырья")} width="max-w-[300px]" closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <Field label="Кол-во">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              setError("")
            }}
            inputMode="decimal"
            className={`${inputClass} ${error ? "border-[#f44336]" : ""}`}
          />
          <span data-no-translate className="text-sm text-slate-500">{line.unit}</span>
        </div>
        <FieldError text={error} />
      </Field>
    </Modal>
  )
}

/** The reference's «Изменение нормы»: Производство (the stage: another one moves the product there), Оборудование
 * (of that stage), Продукт and Кол-во. */
function NormDialog({ recipe, stage, equipment, onClose, onSaved }: { recipe: StageRecipe; stage: Stage; equipment: Equipment[]; onClose: () => void; onSaved: (recipe: StageRecipe) => void }) {
  const { t } = useLanguage()
  const { data: stages } = useApiData<Stage[]>("/api/production/stages", [])
  const [stageId, setStageId] = useState(String(recipe.stageId))
  const [equipmentId, setEquipmentId] = useState(String(recipe.equipmentId ?? ""))
  const [amount, setAmount] = useState(String(recipe.amount))
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const ownStage = Number(stageId) === recipe.stageId
  const { data: stageEquipment } = useApiData<Equipment[]>(ownStage ? null : `/api/production/equipment?stageId=${stageId}`, [])
  const machines = ownStage ? equipment : stageEquipment.filter((entry) => entry.stageId === Number(stageId))
  // The norm's own machine stays visible even when the list has not got it (never a hidden value behind «—»).
  const keepOwnMachine = ownStage && recipe.equipmentId !== null && !machines.some((entry) => entry.id === recipe.equipmentId)

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = parseQuantity(amount)
    if (value === null) {
      setError(amount.trim() ? QTY_ERROR : REQUIRED_ERROR)
      return
    }
    setSaving(true)
    try {
      onSaved(await api<StageRecipe>(`/api/production/recipes/${recipe.id}`, { method: "PUT", body: { stageId: Number(stageId), equipmentId: equipmentId ? Number(equipmentId) : null, amount: value } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Изменение нормы")} closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <div className="space-y-5">
        <Field label="Производство">
          <select
            value={stageId}
            onChange={(event) => {
              setStageId(event.target.value)
              // A machine belongs to its stage: back on the norm's stage its own one returns, elsewhere none is picked.
              setEquipmentId(Number(event.target.value) === recipe.stageId ? String(recipe.equipmentId ?? "") : "")
            }}
            className={inputClass}
          >
            {!stages.some((entry) => entry.id === recipe.stageId) && <option value={recipe.stageId} data-no-translate>{stage.name}</option>}
            {stages.map((entry) => <option key={entry.id} value={entry.id} data-no-translate>{entry.name}</option>)}
          </select>
        </Field>
        <Field label="Оборудование">
          <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} className={inputClass}>
            <option value="">—</option>
            {keepOwnMachine && <option value={recipe.equipmentId ?? ""} data-no-translate>{recipe.equipmentName}</option>}
            {machines.map((entry) => <option key={entry.id} value={entry.id} data-no-translate>{entry.name}</option>)}
          </select>
        </Field>
        <Field label="Продукт">
          <input value={recipe.name} disabled className={`${inputClass} text-[#666]`} />
        </Field>
        <Field label="Кол-во">
          <div className="flex items-center gap-2">
            <input
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setError("")
              }}
              inputMode="decimal"
              className={`${inputClass} ${error ? "border-[#f44336]" : ""}`}
            />
            <span data-no-translate className="text-sm text-slate-500">{recipe.unit}</span>
          </div>
          <FieldError text={error} />
        </Field>
      </div>
    </Modal>
  )
}

/** «Прикрепить операцию» of the ticked products: the reference's chip field «Добавление операций» over every
 * operation (they are global), saved as POST /api/production/product-operations. The reference titles this
 * dialog «Добавление лимита» (the title of its catalog's limit dialog, reused); it attaches operations. */
function AttachOperationsDialog({ recipeIds, onClose, onSaved }: { recipeIds: number[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { data: operations } = useApiData<Operation[]>("/api/production/operations", [])
  const [chosen, setChosen] = useState<number[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!chosen.length) {
      setError("Выберите хотя бы одну операцию")
      return
    }
    setSaving(true)
    try {
      await api("/api/production/product-operations", { method: "POST", body: { recipeIds, operationIds: chosen } })
      onSaved()
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Прикрепить операцию")} tall closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <OperationsChipField
        label="Добавление операций"
        options={operations}
        value={chosen}
        invalid={Boolean(error)}
        onChange={(ids) => {
          setChosen(ids)
          setError("")
        }}
      />
      <FieldError text={error} />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Операции
// ---------------------------------------------------------------------------

// Operations are global, as in the reference: one list under every stage (and with no stage selected), and an
// «Оборудование» operation may use a machine of any stage.

/** A machine an operation can use (GET /api/production/operations/equipment): any stage's, with its stage. */
type OperationEquipment = { id: number; stageId: number; name: string; stageName: string }
type OperationField = "title" | "duration" | "equipmentId"

const OPERATION_TYPES = ["equipment", "human"] as const
const OPERATION_TYPE_LABELS: Record<Operation["type"], string> = { equipment: "Оборудование", human: "Трудовые затраты" }
const OPERATIONS_PAGE_SIZE = 25
const OPERATION_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]
const OPERATION_TITLE_MAX = 2000
const FIELD_ERROR = "mt-1 block text-[12px] font-normal text-[#f44336]"

/** The tab's state in the address, as the reference keeps it: ?search=&page=&pageSize=&openFilterDialog=true
 * &openCreateDialog=true&manufactureOperationUpdateDialogOpen={id} (`type` is Mezon's own «Тип» filter). */
function readOperationParams(params: URLSearchParams) {
  const positive = (name: string) => {
    const value = Number(params.get(name))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  const type = params.get("type")
  const pageSize = positive("pageSize")
  return {
    search: params.get("search") ?? "",
    page: positive("page") ?? 1,
    pageSize: pageSize !== null && OPERATION_PAGE_SIZES.includes(pageSize) ? pageSize : OPERATIONS_PAGE_SIZE,
    type: type === "equipment" || type === "human" ? type : "",
    filterOpen: params.get("openFilterDialog") === "true",
    create: params.get("openCreateDialog") === "true",
    editId: positive("manufactureOperationUpdateDialogOpen"),
  }
}

export function OperationsTab() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const canManage = useCanManage(PRODUCTION_WRITE)
  // The address as it is now (a tab click pushes it just before this mounts; the hook may still hold the old one).
  const [initial] = useState(() => readOperationParams(new URLSearchParams(typeof window === "undefined" ? searchParams.toString() : window.location.search)))
  const { data, loading, reload } = useApiData<Operation[] | null>("/api/production/operations", null)
  // Until the first response: the reference's loader, never a false «ничего не найдено».
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle")
  useEffect(() => {
    if (loading) setPhase("loading")
    else setPhase((current) => (current === "loading" ? "done" : current))
  }, [loading])
  const loaded = data !== null || phase === "done"
  const [query, setQuery] = useState(initial.search)
  const [typeFilter, setTypeFilter] = useState<string>(initial.type)
  const [typeDraft, setTypeDraft] = useState<string>(initial.type)
  const [filterOpen, setFilterOpen] = useState(initial.filterOpen)
  const [page, setPage] = useState(initial.page)
  const [pageSize, setPageSize] = useState(initial.pageSize)
  const [editing, setEditing] = useState<Operation | "new" | null>(null)
  // Dialogs named in the address open once the user's rights (and, for an edit, the list) are known.
  const [pendingCreate, setPendingCreate] = useState(initial.create)
  const [pendingEditId, setPendingEditId] = useState<number | null>(initial.editId)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const closeMessage = useCallback(() => setMessage(null), [])

  const rows = (data ?? []).filter((row) => (!typeFilter || row.type === typeFilter) && matches(query, row.title, row.equipmentName))
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = loaded ? Math.min(page, pageCount) : page
  const start = (currentPage - 1) * pageSize
  const paging: Paging = {
    page: currentPage,
    pageSize,
    pageCount,
    start,
    end: Math.min(start + pageSize, rows.length),
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size)
      setPage(1)
    },
  }
  const typeLabel = (type: Operation["type"]) => t(OPERATION_TYPE_LABELS[type])

  useEffect(() => {
    if (!canManage || !pendingCreate) return
    setEditing("new")
    setPendingCreate(false)
  }, [canManage, pendingCreate])
  useEffect(() => {
    if (!canManage || pendingEditId === null || data === null) return
    const found = data.find((row) => row.id === pendingEditId)
    if (found) setEditing(found)
    setPendingEditId(null)
  }, [canManage, pendingEditId, data])

  // Mirror the state into the address (replace: typing and paging add no history entries).
  useEffect(() => {
    const url = new URL(window.location.href)
    const put = (name: string, value: string | null) => (value ? url.searchParams.set(name, value) : url.searchParams.delete(name))
    put("search", query.trim() ? query : null)
    put("page", currentPage > 1 ? String(currentPage) : null)
    put("pageSize", pageSize !== OPERATIONS_PAGE_SIZE ? String(pageSize) : null)
    put("type", typeFilter || null)
    put("openFilterDialog", filterOpen ? "true" : null)
    put("openCreateDialog", editing === "new" || pendingCreate ? "true" : null)
    put("manufactureOperationUpdateDialogOpen", editing && editing !== "new" ? String(editing.id) : pendingEditId !== null ? String(pendingEditId) : null)
    const next = `${url.pathname}${url.search}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next)
  }, [query, currentPage, pageSize, typeFilter, filterOpen, editing, pendingCreate, pendingEditId])

  // Back / Forward to another entry of the page brings its list state back.
  useEffect(() => {
    const onPop = () => {
      const next = readOperationParams(new URLSearchParams(window.location.search))
      setQuery(next.search)
      setTypeFilter(next.type)
      setTypeDraft(next.type)
      setFilterOpen(next.filterOpen)
      setPage(next.page)
      setPageSize(next.pageSize)
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  return (
    <>
      <TabCard
        addLabel="добавить операцию"
        onAdd={canManage ? () => setEditing("new") : undefined}
        query={query}
        onQuery={setQuery}
        count={rows.length}
        filter={
          <FilterSelect
            label="Тип"
            value={typeDraft ? t(OPERATION_TYPE_LABELS[typeDraft as Operation["type"]]) : ""}
            onChange={(label) => setTypeDraft(OPERATION_TYPES.find((type) => t(OPERATION_TYPE_LABELS[type]) === label) ?? "")}
            options={OPERATION_TYPES.map((type) => t(OPERATION_TYPE_LABELS[type]))}
          />
        }
        onApplyFilter={() => setTypeFilter(typeDraft)}
        filterCount={typeFilter ? 1 : 0}
        onClearFilter={() => {
          setTypeFilter("")
          setTypeDraft("")
          setPage(1)
        }}
        filterOpen={filterOpen}
        onFilterOpen={(open) => {
          if (open) setTypeDraft(typeFilter)
          setFilterOpen(open)
        }}
        paging={paging}
      >
        <DataTable headers={["Наименование", "Тип товара", "Оборудование", ""]} widths={["33.333%", "33.333%", "25%"]} empty={!rows.length} loading={!loaded}>
          {rows.slice(paging.start, paging.end).map((row) => (
            <tr key={row.id} className="group">
              <td>
                {/* Stored operation and machine names: the page translator leaves them alone. */}
                <span data-no-translate className="line-clamp-2 [overflow-wrap:anywhere]">{row.title}</span>
              </td>
              <td>{typeLabel(row.type)}</td>
              {/* The reference prints the machine whatever the type ("N/A" without one). */}
              <td>
                <span data-no-translate className="line-clamp-2 [overflow-wrap:anywhere]">{row.equipmentName || "N/A"}</span>
              </td>
              <td>
                {canManage && (
                  <RowActions
                    onEdit={() => setEditing(row)}
                    onDelete={async () => {
                      // The reference's confirmation of an operation names no item.
                      if (!(await askDelete())) return
                      const failure = await deleteRecord(`/api/production/operations/${row.id}`, t)
                      if (failure) notify(failure)
                      else reload()
                    }}
                  />
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      </TabCard>
      {editing && (
        <OperationDialog
          operation={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null)
            reload()
            // The reference confirms a new operation only (an edit or a delete shows nothing).
            if (created) setMessage({ text: "Успешно сохранено", tone: "success" })
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeMessage} />
    </>
  )
}

/** «Добавление / Изменение операции». Like the reference: no client-side browser checks, the messages under the
 * fields (its texts), the duration starts empty (saved as 0), the type as stacked radios, the machine a searchable
 * field over every stage's machines (the stage under each name tells namesakes apart). Unlike it, a negative or
 * fractional duration is refused. */
function OperationDialog({ operation, onClose, onSaved }: { operation: Operation | null; onClose: () => void; onSaved: (created: boolean) => void }) {
  const { t } = useLanguage()
  const { data: machines, loading: machinesLoading } = useApiData<OperationEquipment[]>("/api/production/operations/equipment", [])
  const [title, setTitle] = useState(operation?.title ?? "")
  const [duration, setDuration] = useState(operation ? String(operation.duration) : "")
  const [type, setType] = useState<Operation["type"]>(operation?.type ?? "equipment")
  const [equipmentId, setEquipmentId] = useState(operation?.equipmentId ? String(operation.equipmentId) : "")
  const [errors, setErrors] = useState<Partial<Record<OperationField, string>>>({})
  const [saving, setSaving] = useState(false)
  // An older «Оборудование» operation saved without a machine may stay so (the server allows it too).
  const keepsNoMachine = operation !== null && operation.type === "equipment" && operation.equipmentId === null
  const options = useMemo(() => machines.map((machine) => ({ value: String(machine.id), label: machine.name, hint: machine.stageName })), [machines])
  const clear = (field: OperationField) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  function validate(): { errors: Partial<Record<OperationField, string>>; duration: number } {
    const found: Partial<Record<OperationField, string>> = {}
    if (title === "") found.title = "Это поле обязательно к заполнению"
    else if (!title.trim()) found.title = "Это поле не может быть пустым."
    else if (title.trim().length > OPERATION_TITLE_MAX) found.title = "Не более 2000 символов"
    const text = duration.trim()
    const value = text === "" ? 0 : strictNumber(text)
    if (!Number.isFinite(value) || !Number.isInteger(value)) found.duration = "Требуется целочисленное значение."
    else if (value < 0) found.duration = "Значение не может быть отрицательным"
    else if (value > 1e9) found.duration = "Слишком большое значение"
    if (type === "equipment" && !equipmentId && !keepsNoMachine) found.equipmentId = "Оборудование обязательно!"
    return { errors: found, duration: value }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const checked = validate()
    if (Object.keys(checked.errors).length) {
      setErrors(checked.errors)
      return
    }
    setSaving(true)
    const body = { title, duration: checked.duration, type, equipmentId: type === "equipment" && equipmentId ? Number(equipmentId) : null }
    try {
      const response = await fetch(operation ? `/api/production/operations/${operation.id}` : "/api/production/operations", {
        method: operation ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (response.ok) {
        onSaved(!operation)
        return
      }
      const data = (await response.json().catch(() => ({}))) as { error?: unknown; field?: unknown }
      const text = typeof data.error === "string" && data.error ? data.error : "Не удалось выполнить запрос"
      if (data.field === "title" || data.field === "duration" || data.field === "equipmentId") setErrors({ [data.field]: text })
      else notify(text)
    } catch {
      notify("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const invalid = (field: OperationField) => (errors[field] ? "!border-[#f44336]" : "")
  return (
    <Modal title={t(operation ? "Изменение операции" : "Добавление операции")} tall closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <div className="space-y-5">
        <Field label="Название">
          <input value={title} onChange={(event) => { setTitle(event.target.value); clear("title") }} aria-invalid={Boolean(errors.title)} className={`${inputClass} ${invalid("title")}`} />
          {errors.title && <span className={FIELD_ERROR}>{t(errors.title)}</span>}
        </Field>
        <Field label="Длительность (секунд)">
          <input value={duration} inputMode="numeric" onChange={(event) => { setDuration(event.target.value); clear("duration") }} aria-invalid={Boolean(errors.duration)} className={`${inputClass} ${invalid("duration")}`} />
          {errors.duration && <span className={FIELD_ERROR}>{t(errors.duration)}</span>}
        </Field>
        <div role="radiogroup" aria-label={t("Тип")} className="space-y-3">
          {OPERATION_TYPES.map((value) => (
            <label key={value} className="flex w-fit cursor-pointer items-center gap-2">
              <input type="radio" name="operationType" value={value} checked={type === value} onChange={() => { setType(value); clear("equipmentId") }} />
              {t(OPERATION_TYPE_LABELS[value])}
            </label>
          ))}
        </div>
        {type === "equipment" && (
          <div>
            <span className="mb-1 block text-[13px] font-semibold text-black">{t("Оборудование")}</span>
            <SearchSelect
              variant="underline"
              rawLabels
              value={equipmentId}
              onChange={(value) => { setEquipmentId(value); clear("equipmentId") }}
              options={options}
              selectedLabel={operation?.equipmentId && String(operation.equipmentId) === equipmentId ? operation.equipmentName : undefined}
              loading={machinesLoading}
              invalid={Boolean(errors.equipmentId)}
            />
            {errors.equipmentId && <span className={FIELD_ERROR}>{t(errors.equipmentId)}</span>}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Персонал
// ---------------------------------------------------------------------------

// Персонал and Оборудование keep their list state in the address under Linko's own keys: search, page, pageSize,
// the staff's shift=3-4 (shift ids joined as Linko joins them) and openFilterDialog, the dialogs' openCreateDialog
// = true / openUpdateDialog = true with personId (staff) or equipmentId. A reload, a shared link and a click on
// another stage keep them; a tab switch drops them (the stage page does, as Linko pushes the bare tab route).

const STAFFEQ_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]
const STAFFEQ_PAGE_SIZE = 25
// Linko's field messages; the server answers the same ones (lib/production-staffeq-schemas.ts).
const STAFFEQ_REQUIRED = "Это поле обязательно к заполнению"
const STAFFEQ_BLANK = "Это поле не может быть пустым."
const STAFFEQ_TOO_LONG = "Убедитесь, что в этом поле не больше 255 символов."
const STAFFEQ_FIELD_ERROR = "mt-1 block text-[12px] font-normal text-[#f44336]"

function staffeqParam(name: string): string {
  return typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get(name) ?? "")
}

function staffeqPositiveParam(name: string): number | null {
  const value = Number(staffeqParam(name))
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/** The dialog the address names: openCreateDialog=true → "new", openUpdateDialog=true&{idKey}={id} → that row. */
function staffeqDialogParam(idKey: string): "new" | number | null {
  if (staffeqParam("openCreateDialog") === "true") return "new"
  return staffeqParam("openUpdateDialog") === "true" ? staffeqPositiveParam(idKey) : null
}

/** The address keys of an open dialog (null removes a key). */
function staffeqDialogKeys(idKey: string, dialog: "new" | number | null): Record<string, string | null> {
  return { openCreateDialog: dialog === "new" ? "true" : null, openUpdateDialog: typeof dialog === "number" ? "true" : null, [idKey]: typeof dialog === "number" ? String(dialog) : null }
}

/** Writes this tab's keys into the address (replace: typing and paging add no history entries). */
function setStaffeqParams(values: Record<string, string | null>) {
  const url = new URL(window.location.href)
  for (const [name, value] of Object.entries(values)) {
    if (value) url.searchParams.set(name, value)
    else url.searchParams.delete(name)
  }
  const next = `${url.pathname}${url.search}`
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next)
}

/** A tab's paging, kept in the address as page / pageSize (Linko: 10 … 2000 rows). */
function useStaffeqPaging(total: number): Paging {
  const [page, setPageState] = useState(() => staffeqPositiveParam("page") ?? 1)
  const [pageSize, setPageSizeState] = useState(() => {
    const size = staffeqPositiveParam("pageSize")
    return size !== null && STAFFEQ_PAGE_SIZES.includes(size) ? size : STAFFEQ_PAGE_SIZE
  })
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  const start = (current - 1) * pageSize
  return {
    page: current,
    pageSize,
    pageCount,
    start,
    end: Math.min(start + pageSize, total),
    setPage: (value) => {
      const next = typeof value === "function" ? value(current) : value
      setPageState(next)
      setStaffeqParams({ page: next > 1 ? String(next) : null })
    },
    setPageSize: (size: number) => {
      setPageSizeState(size)
      setPageState(1)
      setStaffeqParams({ pageSize: size !== STAFFEQ_PAGE_SIZE ? String(size) : null, page: null })
    },
  }
}

/** A refused request: the API's message (an i18n key), the field it names, every field's messages and, for a
 * blocked delete, where the record is used. */
class StaffeqRefusal extends Error {
  constructor(
    message: string,
    readonly field: string | null = null,
    readonly fieldErrors: Record<string, string[]> = {},
    readonly usage: Array<{ label: string; count: number }> = [],
  ) {
    super(message)
  }
}

async function staffeqRequest(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new StaffeqRefusal("Сервер недоступен, попробуйте ещё раз")
  }
  const data = (await response.json().catch(() => ({}))) as { error?: unknown; field?: unknown; details?: { fieldErrors?: unknown }; usage?: unknown }
  if (response.ok) return data
  const fieldErrors: Record<string, string[]> = {}
  const raw = data.details?.fieldErrors
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) fieldErrors[key] = value.filter((item): item is string => typeof item === "string")
    }
  }
  const usage = Array.isArray(data.usage)
    ? (data.usage as Array<{ label?: unknown; count?: unknown }>).filter((item) => typeof item?.label === "string").map((item) => ({ label: String(item.label), count: Number(item.count) || 0 }))
    : []
  throw new StaffeqRefusal(typeof data.error === "string" && data.error ? data.error : "Не удалось выполнить запрос", typeof data.field === "string" ? data.field : null, fieldErrors, usage)
}

/** The messages of a refusal that belong under `fields`; null when it names none of them. */
function staffeqFieldErrors<F extends string>(error: unknown, fields: readonly F[]): Partial<Record<F, string>> | null {
  if (!(error instanceof StaffeqRefusal)) return null
  const found: Partial<Record<F, string>> = {}
  for (const field of fields) {
    const message = error.fieldErrors[field]?.[0] ?? (error.field === field ? error.message : undefined)
    if (message) found[field] = message
  }
  return Object.keys(found).length ? found : null
}

/** A refusal in the UI language, with the usage list of a blocked delete ("…: Операции (1), Продукция (1)"). */
function staffeqRefusalText(error: unknown, t: (text: string) => string): string {
  const message = error instanceof Error && error.message ? error.message : "Не удалось выполнить запрос"
  const usage = error instanceof StaffeqRefusal ? error.usage : []
  return usage.length ? `${t(message)}: ${usage.map((item) => `${t(item.label)} (${item.count})`).join(", ")}` : t(message)
}

type StaffField = "employeeId" | "shiftId"
/** A shift of the Смены directory (GET /api/work-shifts). */
type WorkShiftOption = { id: number; name: string; beginTime: string; endTime: string }

/** "08:00:41" → "08:00": Linko shows a shift's times without the seconds. */
const staffTime = (value: string) => value.slice(0, 5)

const STAFF_MENU_ICON = "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"

/** Linko's row menu of Персонал: an always visible ⋮ with «Изменить» and «Удалить». The menu is fixed to the
 * window, so the table's scroll box never clips it; a click outside, Escape or a scroll closes it. */
function StaffRowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!place) return
    const close = () => setPlace(null)
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [place])
  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    setPlace((current) => (current || !rect ? null : { top: rect.bottom, right: Math.max(0, window.innerWidth - rect.right) }))
  }
  const choose = (action: () => void) => {
    setPlace(null)
    action()
  }
  const item = "flex h-[48px] w-full items-center gap-[20px] px-[16px] text-left text-[15px] text-[#333] hover:bg-black/[0.04]"
  return (
    <span className="flex justify-end">
      <button ref={buttonRef} type="button" onClick={toggle} aria-label={t("Действия")} title={t("Действия")} aria-haspopup="menu" aria-expanded={place !== null} className="flex h-[36px] w-[36px] items-center justify-center rounded-full hover:bg-black/[0.06]">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#757575]" aria-hidden><path d={STAFF_MENU_ICON} /></svg>
      </button>
      {place && (
        <div ref={menuRef} role="menu" style={{ top: place.top, right: place.right }} className="fixed z-[70] min-w-[168px] rounded-[2px] bg-white py-[8px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <button type="button" role="menuitem" onClick={() => choose(onEdit)} className={item}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#757575]" aria-hidden><path d={EDIT_ICON} /></svg>
            {t("Изменить")}
          </button>
          <button type="button" role="menuitem" onClick={() => choose(onDelete)} className={item}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#757575]" aria-hidden><path d={DELETE_ICON} /></svg>
            {t("Удалить")}
          </button>
        </div>
      )}
    </span>
  )
}

/** Персонал: Linko's user_shift list of the stage (Сотрудник | Должность | Смена | Время | ⋮). A row is an employee
 * on a shift of the Смены directory, so «Смена» and «Время» follow that shift (and «Должность» the employee). */
export function StaffTab({ stage, staff, reload }: { stage: Stage; staff: StaffMember[]; reload: () => void }) {
  const { t } = useLanguage()
  const canManage = useCanManage(PRODUCTION_WRITE)
  const { data: shifts } = useApiData<WorkShiftOption[]>("/api/work-shifts", [])
  const [query, setQuery] = useState(() => staffeqParam("search"))
  // Linko's «Показать фильтр»: «Смена», any shifts of the directory, applied with «Применить».
  const [shiftIds, setShiftIds] = useState<number[]>(() =>
    staffeqParam("shift")
      .split("-")
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )
  const [shiftDraft, setShiftDraft] = useState<string[]>(() => shiftIds.map(String))
  const [filterOpen, setFilterOpen] = useState(() => staffeqParam("openFilterDialog") === "true")
  const [dialog, setDialog] = useState<"new" | number | null>(() => staffeqDialogParam("personId"))
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const closeMessage = useCallback(() => setMessage(null), [])
  const rows = staff.filter((row) => (!shiftIds.length || (row.shiftId !== null && shiftIds.includes(row.shiftId))) && matches(query, row.employeeName, row.position, row.shift))
  const paging = useStaffeqPaging(rows.length)
  // A dialog named in the address opens once the user's rights (and, for an edit, the row) are known.
  const editing = !canManage || dialog === null ? null : dialog === "new" ? "new" : (staff.find((row) => row.id === dialog) ?? null)
  const shiftOptions = useMemo(() => shifts.map((shift) => ({ value: String(shift.id), label: shift.name })), [shifts])

  const openDialog = (next: "new" | number | null) => {
    setDialog(next)
    setStaffeqParams(staffeqDialogKeys("personId", next))
  }
  const applyShifts = (ids: number[]) => {
    setShiftIds(ids)
    setStaffeqParams({ shift: ids.length ? ids.join("-") : null })
    paging.setPage(1)
  }

  async function remove(row: StaffMember) {
    // Linko's confirmation names the employee.
    if (!(await askDelete(row.employeeName))) return
    try {
      await staffeqRequest(`/api/production/staff/${row.id}`, "DELETE")
      reload()
      setMessage({ text: "Успешно удалено", tone: "success" })
    } catch (error) {
      notify(staffeqRefusalText(error, t))
    }
  }

  return (
    <>
      <TabCard
        addLabel="добавить сотрудников"
        onAdd={canManage ? () => openDialog("new") : undefined}
        query={query}
        onQuery={(value) => {
          setQuery(value)
          setStaffeqParams({ search: value || null })
        }}
        count={rows.length}
        filter={<MultiPick label={t("Смена")} options={shiftOptions} value={shiftDraft} onChange={setShiftDraft} />}
        onApplyFilter={() => applyShifts(shiftDraft.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))}
        filterCount={shiftIds.length ? 1 : 0}
        onClearFilter={() => applyShifts([])}
        filterOpen={filterOpen}
        onFilterOpen={(open) => {
          // The panel always opens on the applied filter: closing it without «Применить» drops the draft.
          if (open) setShiftDraft(shiftIds.map(String))
          setFilterOpen(open)
          setStaffeqParams({ openFilterDialog: open ? "true" : null })
        }}
        paging={paging}
      >
        {/* Linko's grid: Сотрудник 4, Должность 3, Смена 2, Время 2, the ⋮ menu 1 (of 12). */}
        <DataTable headers={["Сотрудник", "Должность", "Смена", "Время", ""]} widths={["33.333%", "25%", "16.667%", "16.667%"]} empty={!rows.length}>
          {rows.slice(paging.start, paging.end).map((row) => (
            <tr key={row.id}>
              <td>
                {/* Stored employee and shift names: the page translator leaves them alone (the position may be a
                    dictionary text and stays translated). */}
                <span data-no-translate className="line-clamp-2 [overflow-wrap:anywhere]">{row.employeeName}</span>
              </td>
              <td>{row.position}</td>
              <td data-no-translate>{row.shift}</td>
              <td>{row.beginTime || row.endTime ? `${staffTime(row.beginTime)} - ${staffTime(row.endTime)}` : ""}</td>
              <td>{canManage && <StaffRowMenu onEdit={() => openDialog(row.id)} onDelete={() => void remove(row)} />}</td>
            </tr>
          ))}
        </DataTable>
      </TabCard>
      {editing && (
        <StaffDialog
          stage={stage}
          member={editing === "new" ? null : editing}
          shifts={shifts}
          onClose={() => openDialog(null)}
          onSaved={() => {
            openDialog(null)
            reload()
            setMessage({ text: "Успешно сохранено", tone: "success" })
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeMessage} />
    </>
  )
}

/** «Добавить сотрудника» / «Изменение сотрудника», one 400 px dialog as in Linko: «Сотрудник», a searchable list of
 * the active employees by "First Last" (fixed on an edit: only the shift changes), and «Смена», a shift of the Смены
 * directory (picked by itself when the directory has only one); the row takes that shift's times. Like Linko,
 * СОХРАНИТЬ is always on and the reasons appear under the fields. */
function StaffDialog({ stage, member, shifts, onClose, onSaved }: { stage: Stage; member: StaffMember | null; shifts: WorkShiftOption[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { data: employees, loading: employeesLoading } = useApiData<Employee[]>(member ? null : "/api/employees", [])
  const [employeeId, setEmployeeId] = useState("")
  const [shiftId, setShiftId] = useState(() => (member?.shiftId ? String(member.shiftId) : shifts.length === 1 ? String(shifts[0].id) : ""))
  const [errors, setErrors] = useState<Partial<Record<StaffField, string>>>({})
  const [saving, setSaving] = useState(false)
  // The directory may arrive after the dialog opened (e.g. a reload of ?openCreateDialog=true): Linko's pick of
  // the only shift still applies then, unless a shift was chosen already.
  useEffect(() => {
    if (!member && shifts.length === 1) setShiftId((current) => current || String(shifts[0].id))
  }, [member, shifts])
  // Linko offers the active employees only (the server refuses the others too).
  const employeeOptions = useMemo(() => employees.filter((entry) => entry.active !== false).map((entry) => ({ value: String(entry.id), label: entry.name })), [employees])
  const shiftOptions = useMemo(() => shifts.map((shift) => ({ value: String(shift.id), label: shift.name })), [shifts])
  const clear = (field: StaffField) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const found: Partial<Record<StaffField, string>> = {}
    if (!member && !employeeId) found.employeeId = STAFFEQ_REQUIRED
    if (!shiftId) found.shiftId = STAFFEQ_REQUIRED
    if (Object.keys(found).length) {
      setErrors(found)
      return
    }
    setSaving(true)
    try {
      if (member) await staffeqRequest(`/api/production/staff/${member.id}`, "PUT", { shiftId: Number(shiftId) })
      else await staffeqRequest("/api/production/staff", "POST", { stageId: stage.id, employeeId: Number(employeeId), shiftId: Number(shiftId) })
      onSaved()
    } catch (error) {
      const fields = staffeqFieldErrors(error, ["employeeId", "shiftId"] as const)
      if (fields) setErrors(fields)
      else notify(staffeqRefusalText(error, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(member ? "Изменение сотрудника" : "Добавить сотрудника")} width="max-w-[400px]" tall closeOnEscape onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <div className="space-y-5">
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-black">{t("Сотрудник")}</span>
          {member ? (
            <input value={member.employeeName} disabled aria-label={t("Сотрудник")} className={`${inputClass} text-[#666]`} />
          ) : (
            <SearchSelect
              variant="underline"
              rawLabels
              value={employeeId}
              onChange={(value) => {
                setEmployeeId(value)
                clear("employeeId")
              }}
              options={employeeOptions}
              loading={employeesLoading}
              invalid={Boolean(errors.employeeId)}
            />
          )}
          {errors.employeeId && <span className={STAFFEQ_FIELD_ERROR}>{t(errors.employeeId)}</span>}
        </div>
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-black">{t("Смена")}</span>
          <SearchSelect
            variant="underline"
            rawLabels
            value={shiftId}
            onChange={(value) => {
              setShiftId(value)
              clear("shiftId")
            }}
            options={shiftOptions}
            // A row whose shift was removed from the directory meanwhile still names it.
            selectedLabel={member?.shift}
            invalid={Boolean(errors.shiftId)}
          />
          {errors.shiftId && <span className={STAFFEQ_FIELD_ERROR}>{t(errors.shiftId)}</span>}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Оборудование
// ---------------------------------------------------------------------------

type EquipmentField = "name" | "stageId" | "image"

/** Linko's status words: "0" не работает, "1" рабочий, any other value «получить продукт». */
const equipmentStatusLabel = (status: string) => (status === "0" ? "не работает" : status === "1" ? "рабочий" : "получить продукт")

const EQUIPMENT_CLEAR_ICON = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** Оборудование: the stage's machines (Наименование | Последняя отгрузка № | Состояние). The same machines are
 * listed, edited and deleted in Настройки → «Оборудования». Mezon keeps edit and delete on the rows here too. */
export function EquipmentTab({ stage, equipment, reload }: { stage: Stage; equipment: Equipment[]; reload: () => void }) {
  const { t } = useLanguage()
  const canManage = useCanManage(PRODUCTION_WRITE)
  const [query, setQuery] = useState(() => staffeqParam("search"))
  const [dialog, setDialog] = useState<"new" | number | null>(() => staffeqDialogParam("equipmentId"))
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const closeMessage = useCallback(() => setMessage(null), [])
  const rows = equipment.filter((row) => matches(query, row.name))
  const paging = useStaffeqPaging(rows.length)
  // A dialog named in the address opens once the user's rights (and, for an edit, the machine) are known.
  const editing = !canManage || dialog === null ? null : dialog === "new" ? "new" : (equipment.find((row) => row.id === dialog) ?? null)

  const openDialog = (next: "new" | number | null) => {
    setDialog(next)
    setStaffeqParams(staffeqDialogKeys("equipmentId", next))
  }

  async function remove(row: Equipment) {
    // Linko's confirmation names the machine; a machine in use stays, and the refusal says where it is used.
    if (!(await askDelete(row.name))) return
    try {
      await staffeqRequest(`/api/production/equipment/${row.id}`, "DELETE")
      reload()
      setMessage({ text: "Успешно удалено", tone: "success" })
    } catch (error) {
      notify(staffeqRefusalText(error, t))
    }
  }

  return (
    <>
      <TabCard
        addAsButton
        addLabel="Добавить оборудование"
        onAdd={canManage ? () => openDialog("new") : undefined}
        query={query}
        onQuery={(value) => {
          setQuery(value)
          setStaffeqParams({ search: value || null })
        }}
        count={rows.length}
        paging={paging}
      >
        {/* Linko's three equal columns; the row buttons sit at the end of the last one, inside the card. */}
        <DataTable headers={["Наименование", "Последняя отгрузка №", "Состояние"]} widths={["33.333%", "33.333%"]} empty={!rows.length}>
          {rows.slice(paging.start, paging.end).map((row) => (
            <tr key={row.id} className="group">
              <td>
                {/* A stored machine name: the page translator leaves it alone. */}
                <span data-no-translate className="line-clamp-2 [overflow-wrap:anywhere]">{row.name}</span>
              </td>
              <td>{row.lastShipment ?? ""}</td>
              <td>
                <span className="flex items-center justify-between gap-2">
                  <span>{t(equipmentStatusLabel(row.status))}</span>
                  {canManage && <RowActions onEdit={() => openDialog(row.id)} onDelete={() => void remove(row)} />}
                </span>
              </td>
            </tr>
          ))}
        </DataTable>
      </TabCard>
      {editing && (
        <EquipmentDialog
          stage={stage}
          entry={editing === "new" ? null : editing}
          onClose={() => openDialog(null)}
          onSaved={() => {
            openDialog(null)
            reload()
            setMessage({ text: "Успешно сохранено", tone: "success" })
          }}
        />
      )}
      <CashSnackbar message={message} onClose={closeMessage} />
    </>
  )
}

/** «Добавить оборудование» / «Изменить оборудование», Linko's 500 px dialog: «Наименование», «Производство» (any
 * stage, the open one to start with; an edit moves the machine, refused while it is in use) and the photo (JPEG or
 * PNG, picked or dropped, scaled down when it would not fit in a request). Mezon keeps its «Статус» on an edit, the
 * one place to set it. Like Linko, СОХРАНИТЬ is always on and the reasons appear under the fields. */
function EquipmentDialog({ stage, entry, onClose, onSaved }: { stage: Stage; entry: Equipment | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { data: stages, loading: stagesLoading } = useApiData<Stage[]>("/api/production/stages", [])
  const initialStage = String(entry?.stageId ?? stage.id)
  const [name, setName] = useState(entry?.name ?? "")
  const [stageId, setStageId] = useState(initialStage)
  const [status, setStatus] = useState(entry?.status ?? "0")
  // undefined: the stored picture stays; "": removed; a data URL: the new picture.
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [reading, setReading] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<EquipmentField, string>>>({})
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const shown = photo === undefined ? (entry?.image ?? "") : photo
  const stageOptions = useMemo(() => stages.map((item) => ({ value: String(item.id), label: item.name })), [stages])
  const clear = (field: EquipmentField) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  async function pick(file: File | undefined) {
    if (!file) return
    setReading(true)
    try {
      setPhoto(await readEquipmentPhoto(file))
      clear("image")
    } catch (error) {
      notify(t(error instanceof Error && error.message ? error.message : "Не удалось прочитать файл"))
    } finally {
      setReading(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving || reading) return
    const found: Partial<Record<EquipmentField, string>> = {}
    if (name === "") found.name = STAFFEQ_REQUIRED
    else if (!name.trim()) found.name = STAFFEQ_BLANK
    else if (name.trim().length > 255) found.name = STAFFEQ_TOO_LONG
    if (!stageId) found.stageId = STAFFEQ_REQUIRED
    if (Object.keys(found).length) {
      setErrors(found)
      return
    }
    setSaving(true)
    // Only what changed: the status and the picture stay unless the user changed them.
    const body: Record<string, unknown> = { stageId: Number(stageId), name }
    if (entry && status !== entry.status) body.status = status
    if (photo !== undefined) body.image = photo
    try {
      await staffeqRequest(entry ? `/api/production/equipment/${entry.id}` : "/api/production/equipment", entry ? "PUT" : "POST", body)
      onSaved()
    } catch (error) {
      const fields = staffeqFieldErrors(error, ["name", "stageId", "image"] as const)
      if (fields) setErrors(fields)
      else notify(staffeqRefusalText(error, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t(entry ? "Изменить оборудование" : "Добавить оборудование")}
      width="max-w-[500px]"
      tall
      closeOnEscape
      onClose={onClose}
      onSubmit={save}
      footer={
        <button type="submit" disabled={saving} className="mr-[-16px] h-[36px] rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-95 disabled:opacity-60">
          {saving ? "..." : t("Сохранить")}
        </button>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={EQUIPMENT_PHOTO_ACCEPT}
        className="hidden"
        onChange={(event) => {
          void pick(event.target.files?.[0])
          event.target.value = ""
        }}
      />
      <div className="space-y-[24px] pt-[24px]">
        <Field label="Наименование">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              clear("name")
            }}
            aria-invalid={Boolean(errors.name)}
            className={`${inputClass} ${errors.name ? "!border-[#f44336]" : ""}`}
          />
          {errors.name && <span className={STAFFEQ_FIELD_ERROR}>{t(errors.name)}</span>}
        </Field>
        <div>
          <span className="mb-1 block text-[13px] font-semibold text-black">{t("Производство")}</span>
          <SearchSelect
            variant="underline"
            rawLabels
            value={stageId}
            onChange={(value) => {
              setStageId(value)
              clear("stageId")
            }}
            options={stageOptions}
            selectedLabel={stageId === initialStage ? entry?.stageName || stage.name : undefined}
            loading={stagesLoading}
            invalid={Boolean(errors.stageId)}
          />
          {errors.stageId && <span className={STAFFEQ_FIELD_ERROR}>{t(errors.stageId)}</span>}
        </div>
        {entry && (
          <Field label="Статус">
            <select value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass}>
              {status !== "0" && status !== "1" && <option value={status}>{t(equipmentStatusLabel(status))}</option>}
              <option value="0">{t("не работает")}</option>
              <option value="1">{t("рабочий")}</option>
            </select>
          </Field>
        )}
        <div>
          <div className="relative ml-[30px] h-[160px] w-[160px]">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                void pick(event.dataTransfer.files?.[0])
              }}
              aria-label={t("Добавьте фото")}
              className={`flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden border border-dashed text-[13px] text-[#333] ${errors.image ? "border-[#f44336]" : "border-[#dcdcdc]"}`}
            >
              {reading ? (
                <RollerLoader />
              ) : shown ? (
                // eslint-disable-next-line @next/next/no-img-element -- the machine's own picture URL or a new data URL
                <img src={shown} alt="" className="h-full w-full object-cover" />
              ) : (
                <>
                  <svg viewBox="0 0 24 24" className="h-8 w-8 fill-[#c4c4c4]" aria-hidden><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
                  {t("Добавьте фото")}
                </>
              )}
            </button>
            {shown && !reading && (
              <button
                type="button"
                onClick={() => {
                  setPhoto("")
                  clear("image")
                }}
                aria-label={t("Удалить фото")}
                title={t("Удалить фото")}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow hover:bg-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#666] hover:fill-[#e57373]" aria-hidden><path d={EQUIPMENT_CLEAR_ICON} /></svg>
              </button>
            )}
          </div>
          {errors.image && <span className={`${STAFFEQ_FIELD_ERROR} ml-[30px]`}>{t(errors.image)}</span>}
        </div>
      </div>
    </Modal>
  )
}
