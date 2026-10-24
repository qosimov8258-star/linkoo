"use client"

import { askDelete } from "@/lib/ask-confirm"
import { Fragment, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { ImagePlus, ListPlus, PackagePlus, Pencil, Trash2 } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
import { CatalogFilterBar } from "@/components/products/catalog-filter"
import { filterCount, listUrl } from "@/components/products/catalog-state"
import { EMPTY_CATALOG_FILTERS, type CatalogFilters, type CatalogOptions } from "@/lib/products-types"
import { RI, RefButton, RefEmpty, RefFilterPanel, RefIconButton, RefToolbar, usePaging } from "@/components/ref/list-kit"
import type { Recipe } from "./batch-detail"
import {
  api,
  Field,
  formatAmount,
  formatNumber,
  inputClass,
  ItemLinesEditor,
  ItemPicker,
  Modal,
  readImageFile,
  SaveButton,
  useApiData,
  type CatalogItem,
  type DraftLine,
  type Stage,
} from "./production-ui"
import { notify } from "@/lib/notify"

export type Equipment = { id: number; stageId: number; name: string; status: "0" | "1"; image: string; lastShipment: number | null }
type Operation = { id: number; stageId: number; title: string; duration: number; type: "equipment" | "human"; equipmentId: number | null; equipmentName: string }
export type StaffMember = { id: number; stageId: number; employeeId: number | null; employeeName: string; position: string; shift: string; beginTime: string; endTime: string }
type Employee = { id: number; name: string; position: string }

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
function TabCard({ addLabel, onAdd, query, onQuery, count, filter, paging, addAsButton, customFilter, selectMode, onToggleSelect, selectedActions, children }: { customFilter?: ReactNode; selectMode?: boolean; onToggleSelect?: () => void; selectedActions?: ReactNode; addAsButton?: boolean; addLabel: string; onAdd: () => void; query: string; onQuery: (value: string) => void; count: number; filter?: ReactNode; paging: Paging; children: ReactNode }) {
  const { t } = useLanguage()
  const [filterOpen, setFilterOpen] = useState(false)
  return (
    <>
      <div className="flex h-[56px] items-center justify-end pr-[16px]">
        {!addAsButton && (
          <button type="button" onClick={onAdd} className="text-[13px] text-[#4f71dc] hover:underline">
            + {t(addLabel)}
          </button>
        )}
      </div>
      <div className="bg-white font-sans text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <RefToolbar
          linkFilter
          filterWidth={284}
          hideFilter={!filter && !addAsButton && !customFilter}
          searchWidth={266}
          leftSlot={
            customFilter ? (
              customFilter
            ) : addAsButton ? (
              <div className="pl-[5px]"><RefButton icon={RI.add} label={t(addLabel)} onClick={onAdd} /></div>
            ) : filter ? (
              <button type="button" onClick={() => setFilterOpen((value) => !value)} className="text-[13px] text-[#4f71dc]">
                {filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")} ⌄
              </button>
            ) : undefined
          }
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <RefFilterPanel narrow onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)}>
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
          from={count ? paging.start + 1 : 0}
          to={count ? paging.end : 0}
          total={count}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={
            <>
              {selectedActions}
              <RefIconButton path={selectMode ? "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" : RI.checklist} label={t("Выбрать из списка")} color="#5d6474" onClick={onToggleSelect} />
            </>
          }
        />
        {children}
      </div>
    </>
  )
}

/** Fixed-width columns measured from the reference (px; the last column takes the rest). */
function DataTable({ headers, children, empty, widths, hideHead, hideBody, selectAll }: { headers: string[]; children: ReactNode; empty: boolean; colSpan?: number; widths: number[]; hideHead?: boolean; hideBody?: boolean; selectAll?: { checked: boolean; onChange: (checked: boolean) => void } }) {
  const { t } = useLanguage()
  const cols = headers.length
  return (
    <div className="overflow-x-auto">
      <style>{".prod-table tbody tr{background:linear-gradient(to right,#d9e0e5 2px,transparent 2px) left bottom/8px 2px repeat-x}"}</style>
      <table
        className={[
          "w-full min-w-[640px] table-fixed border-collapse text-[13px]",
          "prod-table [&_td]:!h-[50px] [&_td]:!px-2 [&_td]:!py-0 [&_td:first-child]:!pl-[30px] [&_td]:align-middle [&_td]:leading-[16px]",
          "[&_th]:!h-[50px] [&_th]:!px-2 [&_th]:!py-0 [&_th:first-child]:!pl-[30px] [&_th]:text-left [&_th]:leading-[16px]",
          "[&_tbody_tr]:!border-b-0 [&_tbody_tr:hover]:bg-[#f2f5f8]",
        ].join(" ")}
      >
        <colgroup>
          {headers.map((header, index) => (
            <col key={`${header}-${index}`} style={index < cols - 1 ? { width: (widths[index] ?? 200) + (index === 0 ? 30 : 0) } : undefined} />
          ))}
        </colgroup>
        {!hideHead && (
          <thead className="bg-[#5d6474] text-white">
            <tr>{headers.map((header, index) => <th key={`${header}-${index}`} className="font-semibold">{index === 0 && selectAll ? <span className="flex items-center"><input type="checkbox" checked={selectAll.checked} onChange={(event) => selectAll.onChange(event.target.checked)} className="mr-[10px] h-4 w-4 cursor-pointer accent-[#5d6474]" aria-label={t("Выбрать все")} />{t(header)}</span> : t(header)}</th>)}</tr>
          </thead>
        )}
        <tbody>{hideBody ? null : children}</tbody>
      </table>
      {empty && <RefEmpty text={t("По вашему запросу ничего не найдено")} />}
    </div>
  )
}

function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  return (
    <span className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
      {onEdit && <button onClick={onEdit} aria-label={t("Изменить")} className="p-1 text-slate-500 hover:text-blue-600"><Pencil className="h-4 w-4" /></button>}
      <button onClick={onDelete} aria-label={t("Удалить")} className="p-1 text-slate-500 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
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

export function ProductsTab({ stage, equipment }: { stage: Stage; equipment: Equipment[] }) {
  const { t } = useLanguage()
  const { data: recipes, setData: setRecipes, reload } = useApiData<Recipe[]>(`/api/production/recipes?stageId=${stage.id}`, [])
  const { data: catalog } = useApiData<CatalogItem[]>("/api/production/items", [])
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_CATALOG_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [componentDialog, setComponentDialog] = useState<{ recipe: Recipe; role: "raw" | "ready" } | null>(null)
  const [normDialog, setNormDialog] = useState<Recipe | null>(null)

  const { data: filterOptions, reload: reloadOptions } = useApiData<CatalogOptions | null>("/api/products/options", null)
  // The reference's "Фильтр" is the product catalog filter; the matching products decide which recipes stay.
  const matchUrl = filterCount(filters) > 0 ? listUrl("product", { tab: "", search: "", ordering: "", page: 1, pageSize: 0, filters, detailId: null }, { pageSize: 0 }) : null
  const { data: matching } = useApiData<{ results: Array<{ id: number }> } | null>(matchUrl, null)
  const matchingIds = matchUrl && matching ? new Set(matching.results.map((row) => row.id)) : null
  const rows = recipes.filter((recipe) => (!matchingIds || matchingIds.has(recipe.itemId)) && matches(query, recipe.name, recipe.type))
  const paging = usePaging(rows.length)
  const visible = rows.slice(paging.start, paging.end)
  const splitIndex = expanded == null ? -1 : visible.findIndex((recipe) => recipe.id === expanded)
  const expandedRecipe = splitIndex >= 0 ? visible[splitIndex] : null
  const before = splitIndex >= 0 ? visible.slice(0, splitIndex) : []
  const after = splitIndex >= 0 ? visible.slice(splitIndex + 1) : []
  const replace = (recipe: Recipe) => setRecipes(recipes.map((entry) => (entry.id === recipe.id ? recipe : entry)))

  async function updateComponent(id: number, amount: number) {
    await run(async () => replace(await api<Recipe>(`/api/production/recipe-components/${id}`, { method: "PUT", body: { amount } })), () => {})
  }

  async function removeComponent(id: number) {
    if (!(await askDelete())) return
    await run(async () => replace(await api<Recipe>(`/api/production/recipe-components/${id}`, { method: "DELETE" })), () => {})
  }

  async function removeSelected() {
    if (!(await askDelete())) return
    for (const id of selected) await run(() => api(`/api/production/recipes/${id}`, { method: "DELETE" }), () => {})
    setSelected([])
    setExpanded(null)
    reload()
  }

  const toggleSelected = (id: number, checked: boolean) => setSelected((current) => (checked ? [...current, id] : current.filter((entry) => entry !== id)))
  const nameCell = (recipe: Recipe) => (
    <td className="px-6 py-4">
      {selectMode && <input type="checkbox" checked={selected.includes(recipe.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelected(recipe.id, event.target.checked)} className="mr-[10px] h-4 w-4 cursor-pointer align-middle accent-[#5d6474]" aria-label={recipe.name} />}
      {recipe.name}
    </td>
  )
  const selectAll = selectMode ? { checked: visible.length > 0 && visible.every((recipe) => selected.includes(recipe.id)), onChange: (checked: boolean) => setSelected(checked ? visible.map((recipe) => recipe.id) : []) } : undefined

  async function removeRecipe(recipe: Recipe) {
    if (!(await askDelete(recipe.name))) return
    await run(() => api(`/api/production/recipes/${recipe.id}`, { method: "DELETE" }), () => {
      setExpanded(null)
      reload()
    })
  }

  return (
    <>
      <TabCard
        addLabel="добавить продукцию"
        onAdd={() => setAddOpen(true)}
        query={query}
        onQuery={setQuery}
        count={rows.length}
        customFilter={
          <CatalogFilterBar
            kind="product"
            filters={filters}
            options={filterOptions}
            open={filterOpen}
            onOpen={() => {
              reloadOptions()
              setFilterOpen(true)
            }}
            onClose={() => setFilterOpen(false)}
            onClear={() => setFilters(EMPTY_CATALOG_FILTERS)}
            onApply={(next) => {
              setFilters(next)
              setFilterOpen(false)
              paging.setPage(1)
            }}
          />
        }
        selectMode={selectMode}
        onToggleSelect={() => {
          setSelectMode((value) => !value)
          setSelected([])
        }}
        selectedActions={
          selectMode && selected.length > 0 ? (
            <RefButton red label={`${t("Удалить")} (${selected.length})`} onClick={removeSelected} />
          ) : undefined
        }
       paging={paging}>
      <DataTable headers={["Наименование", "Тип товара", "Кол-во"]} widths={[458, 367]} empty={!visible.length} hideBody={splitIndex >= 0 && before.length === 0} selectAll={selectAll}>
        {(splitIndex >= 0 ? before : visible).map((recipe) => (
          <tr key={recipe.id} onClick={() => setExpanded(recipe.id)} className="cursor-pointer hover:bg-[#f2f5f8]">
            {nameCell(recipe)}
            <td className="px-6 py-4">{recipe.type}</td>
            <td className="px-6 py-4">{formatAmount(recipe.amount, recipe.unit)}</td>
          </tr>
        ))}
      </DataTable>
      </TabCard>
      {expandedRecipe && (
        <>
          <RecipeDetail
            recipe={expandedRecipe}
            onClose={() => setExpanded(null)}
            onDelete={() => removeRecipe(expandedRecipe)}
            onAdd={(role) => setComponentDialog({ recipe: expandedRecipe, role })}
            onNorm={() => setNormDialog(expandedRecipe)}
            onUpdateComponent={updateComponent}
            onRemoveComponent={removeComponent}
          />
          {after.length > 0 && (
            <div className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
              <DataTable headers={["Наименование", "Тип товара", "Кол-во"]} widths={[458, 367]} empty={false} hideHead>
                {after.map((recipe) => (
                  <tr key={recipe.id} onClick={() => setExpanded(recipe.id)} className="cursor-pointer hover:bg-[#f2f5f8]">
                    {nameCell(recipe)}
                    <td className="px-6 py-4">{recipe.type}</td>
                    <td className="px-6 py-4">{formatAmount(recipe.amount, recipe.unit)}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          )}
        </>
      )}

      {addOpen && <AddRecipeDialog stage={stage} equipment={equipment} catalog={catalog} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); reload() }} />}
      {componentDialog && (
        <ComponentDialog
          recipe={componentDialog.recipe}
          role={componentDialog.role}
          catalog={catalog}
          onClose={() => setComponentDialog(null)}
          onSaved={(recipe) => { replace(recipe); setComponentDialog(null) }}
        />
      )}
      {normDialog && <NormDialog recipe={normDialog} equipment={equipment} onClose={() => setNormDialog(null)} onSaved={(recipe) => { replace(recipe); setNormDialog(null) }} />}
    </>
  )
}

function RecipeDetail({
  recipe,
  onClose,
  onDelete,
  onAdd,
  onNorm,
  onUpdateComponent,
  onRemoveComponent,
}: {
  recipe: Recipe
  onClose: () => void
  onDelete: () => void
  onAdd: (role: "raw" | "ready") => void
  onNorm: () => void
  onUpdateComponent: (id: number, amount: number) => void
  onRemoveComponent: (id: number) => void
}) {
  const { t } = useLanguage()
  const raw = recipe.components.filter((component) => component.role === "raw")
  const ready = recipe.components.filter((component) => component.role === "ready")
  return (
    <div className="mx-[-15px] my-5 bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[30px]">
        <div className="flex items-center text-[20px]">
          <button onClick={onClose} className="text-left">{recipe.name}</button>
          <span className="mx-[6px]">-</span>
          <button onClick={onNorm} title={t("Изменение нормы")} aria-label={t("Изменение нормы")} className="italic">{formatAmount(recipe.amount, recipe.unit)}</button>
          {recipe.equipmentName && <span className="ml-3 text-[13px] text-[#666]">({recipe.equipmentName})</span>}
        </div>
        <div className="flex items-center gap-[24px] pr-[12px]">
          <IconButton label="Удалить продукт" onClick={onDelete}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></IconButton>
          <IconButton label="Добавить сырье" onClick={() => onAdd("raw")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" /></svg></IconButton>
          <IconButton label="Добавить готовый продукт" onClick={() => onAdd("ready")}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm14 0v4h-4v2h4v4h2v-4h4v-2h-4v-4h-2z" /></svg></IconButton>
        </div>
      </div>
      <div className="pb-[10px] pl-[30px] pr-[30px]">
        {raw.length ? (
          <ComponentList title="Сырье" rows={raw} onUpdate={onUpdateComponent} onRemove={onRemoveComponent} cols="479px 400px minmax(0,1fr)" />
        ) : (
          <p className="py-8 text-center text-[#888]">{t("Вы еще не выбрали ни одного сырья")}</p>
        )}
        <div>
          <div className={`relative grid h-[50px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: "667px minmax(0,1fr) 40px" }}>
            <div>{t("Готовый продукт")}</div>
            <div>{t("Объем")}</div>
            <div />
          </div>
          <div className={`relative grid min-h-[50px] items-center ${DOTTED}`} style={{ gridTemplateColumns: "667px minmax(0,1fr) 40px" }}>
            <div>{recipe.name}</div>
            <div>{formatAmount(recipe.amount, recipe.unit)}</div>
            <button onClick={onDelete} aria-label={t("Удалить продукт")} className="flex h-8 w-8 items-center justify-center justify-self-end">
              <Trash2 className="h-5 w-5 text-[#5d6474]" />
            </button>
          </div>
        </div>
        {ready.length > 0 && <ComponentList title="Готовый продукт" rows={ready} onUpdate={onUpdateComponent} onRemove={onRemoveComponent} cols="667px minmax(0,1fr) 120px" hideHeader />}
      </div>
    </div>
  )
}

const DOTTED = "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  return <button onClick={onClick} title={t(label)} aria-label={t(label)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-[#f2f5f8]">{children}</button>
}

function ComponentList({ title, rows, onUpdate, onRemove, cols, hideHeader }: { title: string; rows: Recipe["components"]; onUpdate: (id: number, amount: number) => void; onRemove: (id: number) => void; cols: string; hideHeader?: boolean }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState<number | null>(null)
  const [value, setValue] = useState("")
  if (!rows.length) return null
  return (
    <div>
      {!hideHeader && (
        <div className={`relative grid h-[50px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: cols }}>
          <div>{t(title)}</div>
          <div>{t("Объем")}</div>
          <div />
        </div>
      )}
      {rows.map((row) => (
        <div key={row.id} className={`relative grid min-h-[50px] items-center ${DOTTED}`} style={{ gridTemplateColumns: cols }}>
          <div>{row.name}</div>
          <div>
            {editing === row.id ? (
              <input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                onBlur={() => {
                  const parsed = Number(value.replace(",", "."))
                  if (parsed > 0 && parsed !== row.amount) onUpdate(row.id, parsed)
                  setEditing(null)
                }}
                inputMode="decimal"
                className="w-28 border-b border-[#4f71dc] outline-none"
              />
            ) : (
              formatAmount(row.amount, row.unit)
            )}
          </div>
          <div className="flex items-center gap-[15px] pl-[5px]">
            <button onClick={() => { setEditing(row.id); setValue(String(row.amount)) }} aria-label={t("Изменить")}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
            </button>
            <button onClick={() => onRemove(row.id)} aria-label={t("Удалить")}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function AddRecipeDialog({ stage, equipment, catalog, onClose, onSaved }: { stage: Stage; equipment: Equipment[]; catalog: CatalogItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [amount, setAmount] = useState("1")
  const [lines, setLines] = useState<DraftLine[]>([])
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const products = useMemo(() => catalog.filter((item) => item.kind === "product"), [catalog])
  const rawMaterials = useMemo(() => [...catalog].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "raw_material" ? -1 : 1)), [catalog])

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = Number(amount.replace(",", "."))
    if (!key || !(value > 0)) return
    setSaving(true)
    await run(
      () =>
        api("/api/production/recipes", {
          method: "POST",
          body: { stageId: stage.id, key, equipmentId: equipmentId ? Number(equipmentId) : null, amount: value, components: lines.map((line) => ({ role: "raw", ...line })) },
        }),
      onSaved,
    )
    setSaving(false)
  }

  return (
    <Modal title={t("Добавление продукта")} tall onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} disabled={!key} />}>
      <div className="space-y-5">
        <Field label="Продукт" required><ItemPicker items={products} value={key} onChange={setKey} placeholder="" /></Field>
        <Field label="Оборудование">
          <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} className={inputClass}>
            <option value="">—</option>
            {equipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </Field>
        <Field label="Кол-во" required>
          <input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <div className="flex items-center justify-between pt-2">
          <p className="text-[16px] font-semibold">{t("Сырье")}</p>
          <button type="button" onClick={() => setAdding((value) => !value)} className="text-[13px] text-[#129fdd] hover:underline">+ {t("добавить сырье")}</button>
        </div>
        <ItemLinesEditor items={rawMaterials} lines={lines} onChange={setLines} emptyText="Вы еще не выбрали ни одного сырья" hideInput={!adding} />
      </div>
    </Modal>
  )
}

function ComponentDialog({ recipe, role, catalog, onClose, onSaved }: { recipe: Recipe; role: "raw" | "ready"; catalog: CatalogItem[]; onClose: () => void; onSaved: (recipe: Recipe) => void }) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [saving, setSaving] = useState(false)
  const items = useMemo(() => (role === "ready" ? catalog.filter((item) => item.kind === "product") : catalog), [catalog, role])

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = Number(amount.replace(",", "."))
    if (!key || !(value > 0)) return
    setSaving(true)
    try {
      onSaved(await api<Recipe>(`/api/production/recipes/${recipe.id}/components`, { method: "POST", body: { role, key, amount: value } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(role === "ready" ? "Добавить готовый продукт" : "Добавить сырье")} tall onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} disabled={!key} />}>
      <p className="mb-4 text-sm text-slate-500">{recipe.name} — {t("на")} {formatAmount(recipe.amount, recipe.unit)}</p>
      <div className="space-y-5">
        <Field label="Наименование" required><ItemPicker items={items} value={key} onChange={setKey} /></Field>
        <Field label="Объем" required>
          <div className="flex items-center gap-2">
            <input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={inputClass} />
            <span className="text-sm text-slate-500">{items.find((item) => item.key === key)?.unit}</span>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

function NormDialog({ recipe, equipment, onClose, onSaved }: { recipe: Recipe; equipment: Equipment[]; onClose: () => void; onSaved: (recipe: Recipe) => void }) {
  const { t } = useLanguage()
  const [equipmentId, setEquipmentId] = useState(String(recipe.equipmentId ?? ""))
  const [amount, setAmount] = useState(String(recipe.amount))
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = Number(amount.replace(",", "."))
    if (!(value > 0)) return
    setSaving(true)
    try {
      onSaved(await api<Recipe>(`/api/production/recipes/${recipe.id}`, { method: "PUT", body: { equipmentId: equipmentId ? Number(equipmentId) : null, amount: value } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Изменение нормы")} onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <p className="mb-4 font-semibold">{recipe.name}</p>
      <div className="space-y-5">
        <Field label="Оборудование">
          <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} className={inputClass}>
            <option value="">—</option>
            {equipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </Field>
        <Field label="Кол-во" required>
          <div className="flex items-center gap-2">
            <input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={inputClass} />
            <span className="text-sm text-slate-500">{recipe.unit}</span>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Операции
// ---------------------------------------------------------------------------

export function OperationsTab({ stage, equipment }: { stage: Stage; equipment: Equipment[] }) {
  const { t } = useLanguage()
  const { data: operations, reload } = useApiData<Operation[]>("/api/production/operations", [])
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [editing, setEditing] = useState<Operation | "new" | null>(null)
  const rows = operations.filter((row) => (!typeFilter || row.type === typeFilter) && matches(query, row.title, row.equipmentName))
  const paging = usePaging(rows.length)
  const typeLabel = (type: Operation["type"]) => t(type === "human" ? "Трудовые затраты" : "Оборудование")

  return (
    <>
      <TabCard
        addLabel="добавить операцию"
        onAdd={() => setEditing("new")}
        query={query}
        onQuery={setQuery}
        count={rows.length}
        filter={
          <Field label="Тип" className="max-w-sm">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClass}>
              <option value="">{t("Все типы")}</option>
              <option value="equipment">{t("Оборудование")}</option>
              <option value="human">{t("Трудовые затраты")}</option>
            </select>
          </Field>
        }
       paging={paging}>
      <DataTable headers={["Наименование", "Тип товара", "Оборудование", ""]} widths={[367, 367, 275]} empty={!rows.length}>
        {rows.slice(paging.start, paging.end).map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
            <td className="px-6 py-4">{row.title}</td>
            <td className="px-6 py-4">{typeLabel(row.type)}</td>
            <td className="px-6 py-4">{row.type === "equipment" ? row.equipmentName || "N/A" : "N/A"}</td>
            <td className="px-6 py-4">
              <RowActions
                onEdit={() => setEditing(row)}
                onDelete={async () => (await askDelete()) && run(() => api(`/api/production/operations/${row.id}`, { method: "DELETE" }), reload)}
              />
            </td>
          </tr>
        ))}
      </DataTable>
      </TabCard>
      {editing && <OperationDialog stage={stage} equipment={equipment} operation={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function OperationDialog({ stage, equipment, operation, onClose, onSaved }: { stage: Stage; equipment: Equipment[]; operation: Operation | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(operation?.title ?? "")
  const [duration, setDuration] = useState(String(operation?.duration ?? 0))
  const [type, setType] = useState<Operation["type"]>(operation?.type ?? "equipment")
  const [equipmentId, setEquipmentId] = useState(String(operation?.equipmentId ?? ""))
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const body = { stageId: stage.id, title, duration: Number(duration) || 0, type, equipmentId: type === "equipment" && equipmentId ? Number(equipmentId) : null }
    await run(() => api(operation ? `/api/production/operations/${operation.id}` : "/api/production/operations", { method: operation ? "PUT" : "POST", body }), onSaved)
    setSaving(false)
  }

  return (
    <Modal title={t(operation ? "Изменение операции" : "Добавление операции")} onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <div className="space-y-5">
        <Field label="Название" required><input required value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} /></Field>
        <Field label="Длительность (секунд)"><input type="number" min={0} value={duration} onChange={(event) => setDuration(event.target.value)} className={inputClass} /></Field>
        <div className="flex gap-6">
          {(["equipment", "human"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" checked={type === value} onChange={() => setType(value)} />
              {t(value === "equipment" ? "Оборудование" : "Трудовые затраты")}
            </label>
          ))}
        </div>
        {type === "equipment" && (
          <Field label="Оборудование">
            <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} className={inputClass}>
              <option value="">—</option>
              {equipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Персонал
// ---------------------------------------------------------------------------

export function StaffTab({ stage, staff, reload }: { stage: Stage; staff: StaffMember[]; reload: () => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null)
  const rows = staff.filter((row) => matches(query, row.employeeName, row.position, row.shift))
  const paging = usePaging(rows.length)

  return (
    <>
      <TabCard addLabel="добавить сотрудников" onAdd={() => setEditing("new")} query={query} onQuery={setQuery} count={rows.length}  paging={paging}>
      <DataTable headers={["Сотрудник", "Должность", "Смена", "Время", ""]} widths={[367, 275, 183, 183]} empty={!rows.length}>
        {rows.slice(paging.start, paging.end).map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
            <td className="px-6 py-4">{row.employeeName}</td>
            <td className="px-6 py-4">{row.position}</td>
            <td className="px-6 py-4">{row.shift}</td>
            <td className="px-6 py-4">{row.beginTime || row.endTime ? `${row.beginTime} - ${row.endTime}` : ""}</td>
            <td className="px-6 py-4">
              <RowActions
                onEdit={() => setEditing(row)}
                onDelete={async () => (await askDelete()) && run(() => api(`/api/production/staff/${row.id}`, { method: "DELETE" }), reload)}
              />
            </td>
          </tr>
        ))}
      </DataTable>
      </TabCard>
      {editing && <StaffDialog stage={stage} member={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function StaffDialog({ stage, member, onClose, onSaved }: { stage: Stage; member: StaffMember | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { data: employees } = useApiData<Employee[]>("/api/employees", [])
  const [employeeId, setEmployeeId] = useState(String(member?.employeeId ?? ""))
  const [shift, setShift] = useState(member?.shift ?? "")
  const [beginTime, setBeginTime] = useState(member?.beginTime ?? "08:00")
  const [endTime, setEndTime] = useState(member?.endTime ?? "18:00")
  const [saving, setSaving] = useState(false)
  const employee = employees.find((entry) => String(entry.id) === employeeId)

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = employee?.name ?? member?.employeeName
    if (!name) return
    setSaving(true)
    const body = { stageId: stage.id, employeeId: employee?.id ?? member?.employeeId ?? null, employeeName: name, position: employee?.position ?? member?.position ?? "", shift, beginTime, endTime }
    await run(() => api(member ? `/api/production/staff/${member.id}` : "/api/production/staff", { method: member ? "PUT" : "POST", body }), onSaved)
    setSaving(false)
  }

  return (
    <Modal title={t(member ? "Изменение сотрудника" : "Добавить сотрудника")} onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} disabled={!employeeId && !member} />}>
      <div className="space-y-5">
        <Field label="Сотрудник" required>
          <select required={!member} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className={inputClass}>
            <option value="">{member?.employeeName ?? "—"}</option>
            {employees.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.position ? ` (${entry.position})` : ""}</option>)}
          </select>
        </Field>
        <Field label="Смена"><input value={shift} onChange={(event) => setShift(event.target.value)} placeholder="1-смена" className={inputClass} /></Field>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Время начала"><input type="time" value={beginTime} onChange={(event) => setBeginTime(event.target.value)} className={inputClass} /></Field>
          <Field label="Время окончания"><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className={inputClass} /></Field>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Оборудование
// ---------------------------------------------------------------------------

export function EquipmentTab({ stage, equipment, reload }: { stage: Stage; equipment: Equipment[]; reload: () => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<Equipment | "new" | null>(null)
  const rows = equipment.filter((row) => matches(query, row.name))
  const paging = usePaging(rows.length)

  return (
    <>
      <TabCard addAsButton addLabel="Добавить оборудование" onAdd={() => setEditing("new")} query={query} onQuery={setQuery} count={rows.length}  paging={paging}>
      <DataTable headers={["Наименование", "Последняя отгрузка №", "Состояние", ""]} widths={[367, 367, 367]} empty={!rows.length}>
        {rows.slice(paging.start, paging.end).map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
            <td className="px-6 py-4">
              <span className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {row.image && <img src={row.image} alt="" className="h-9 w-9 rounded object-cover" />}
                {row.name}
              </span>
            </td>
            <td className="px-6 py-4">{row.lastShipment ?? ""}</td>
            <td className="px-6 py-4">
              <span className={`mr-2 inline-block h-2 w-2 rounded-full ${row.status === "1" ? "bg-emerald-500" : "bg-slate-400"}`} />
              {t(row.status === "1" ? "работает" : "не работает")}
            </td>
            <td className="px-6 py-4">
              <RowActions
                onEdit={() => setEditing(row)}
                onDelete={async () => (await askDelete()) && run(() => api(`/api/production/equipment/${row.id}`, { method: "DELETE" }), reload)}
              />
            </td>
          </tr>
        ))}
      </DataTable>
      </TabCard>
      {editing && <EquipmentDialog stage={stage} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function EquipmentDialog({ stage, entry, onClose, onSaved }: { stage: Stage; entry: Equipment | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(entry?.name ?? "")
  const [status, setStatus] = useState<Equipment["status"]>(entry?.status ?? "0")
  const [image, setImage] = useState(entry?.image ?? "")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    const body = { stageId: stage.id, name, status, image }
    await run(() => api(entry ? `/api/production/equipment/${entry.id}` : "/api/production/equipment", { method: entry ? "PUT" : "POST", body }), onSaved)
    setSaving(false)
  }

  return (
    <Modal
      title={t(entry ? "Изменение оборудования" : "Добавить оборудование")}
      width="max-w-[500px]"
      onClose={onClose}
      onSubmit={save}
      footer={
        <button type="submit" disabled={saving || !name.trim()} className="mr-[-16px] h-[36px] rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-95 disabled:opacity-60">
          {saving ? "..." : t("Сохранить")}
        </button>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          if (file) await run(async () => setImage(await readImageFile(file)), () => {})
        }}
      />
      <div className="space-y-[24px] pt-[24px]">
        <Field label="Наименование" required><input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
        <Field label="Производство"><input value={stage.name} disabled className={`${inputClass} text-[#666]`} /></Field>
        {entry && (
          <Field label="Статус">
            <select value={status} onChange={(event) => setStatus(event.target.value as Equipment["status"])} className={inputClass}>
              <option value="0">{t("не работает")}</option>
              <option value="1">{t("работает")}</option>
            </select>
          </Field>
        )}
        <button type="button" onClick={() => fileRef.current?.click()} className="ml-[30px] flex h-[160px] w-[160px] flex-col items-center justify-center gap-2 overflow-hidden border border-dashed border-[#dcdcdc] text-[13px] text-[#333]">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-full w-full object-cover" />
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-8 w-8 fill-[#c4c4c4]" aria-hidden><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
              {t("Добавьте фото")}
            </>
          )}
        </button>
      </div>
    </Modal>
  )
}
