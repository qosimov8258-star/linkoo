"use client"

import { Fragment, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { ChevronDown, ImagePlus, ListPlus, PackagePlus, Pencil, Plus, Search, Trash2 } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
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

export type Equipment = { id: number; stageId: number; name: string; status: "0" | "1"; image: string; lastShipment: number | null }
type Operation = { id: number; stageId: number; title: string; duration: number; type: "equipment" | "human"; equipmentId: number | null; equipmentName: string }
export type StaffMember = { id: number; stageId: number; employeeId: number | null; employeeName: string; position: string; shift: string; beginTime: string; endTime: string }
type Employee = { id: number; name: string; position: string }

async function run(action: () => Promise<unknown>, after: () => void) {
  try {
    await action()
    after()
  } catch (error) {
    window.alert((error as Error).message)
  }
}

function TabToolbar({ addLabel, onAdd, query, onQuery, count, filter }: { addLabel: string; onAdd: () => void; query: string; onQuery: (value: string) => void; count: number; filter?: ReactNode }) {
  const { t } = useLanguage()
  const [filterOpen, setFilterOpen] = useState(false)
  return (
    <>
      <div className="mb-3 mt-5 flex justify-end">
        <button onClick={onAdd} className="flex items-center gap-1 text-blue-600 hover:underline">
          <Plus className="h-4 w-4" /> {t(addLabel)}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white px-4 py-3 shadow-sm">
        {filter ? (
          <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 text-blue-600">
            {t("Показать фильтр")} <ChevronDown className="h-4 w-4" />
          </button>
        ) : (
          <span />
        )}
        <label className="relative w-72 max-w-full">
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-9 outline-none focus:border-blue-600" />
          <Search className="absolute right-1 top-2 h-5 w-5 text-slate-400" />
        </label>
        <span className="text-slate-600">{count ? `1 - ${count}` : "0 - 0"} {t("из")} {count}</span>
      </div>
      {filter && filterOpen && <div className="border-t bg-slate-50 px-4 py-4">{filter}</div>}
    </>
  )
}

function DataTable({ headers, children, empty, colSpan }: { headers: string[]; children: ReactNode; empty: boolean; colSpan?: number }) {
  const { t } = useLanguage()
  return (
    <div className="overflow-x-auto bg-white shadow-sm">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead className="bg-[#626b7e] text-left text-white">
          <tr>{headers.map((header, index) => <th key={`${header}-${index}`} className="px-6 py-4 font-semibold">{t(header)}</th>)}</tr>
        </thead>
        <tbody>
          {children}
          {empty && <tr><td colSpan={colSpan ?? headers.length} className="p-14 text-center text-slate-400">{t("По вашему запросу ничего не найдено...")}</td></tr>}
        </tbody>
      </table>
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
  const [typeFilter, setTypeFilter] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [componentDialog, setComponentDialog] = useState<{ recipe: Recipe; role: "raw" | "ready" } | null>(null)
  const [normDialog, setNormDialog] = useState<Recipe | null>(null)

  const types = useMemo(() => Array.from(new Set(recipes.map((recipe) => recipe.type).filter(Boolean))), [recipes])
  const rows = recipes.filter((recipe) => (!typeFilter || recipe.type === typeFilter) && matches(query, recipe.name, recipe.type))
  const replace = (recipe: Recipe) => setRecipes(recipes.map((entry) => (entry.id === recipe.id ? recipe : entry)))

  async function updateComponent(id: number, amount: number) {
    await run(async () => replace(await api<Recipe>(`/api/production/recipe-components/${id}`, { method: "PUT", body: { amount } })), () => {})
  }

  async function removeComponent(id: number) {
    if (!window.confirm(t("Удалить запись?"))) return
    await run(async () => replace(await api<Recipe>(`/api/production/recipe-components/${id}`, { method: "DELETE" })), () => {})
  }

  async function removeRecipe(recipe: Recipe) {
    if (!window.confirm(`${t("Удалить продукт")} «${recipe.name}»?`)) return
    await run(() => api(`/api/production/recipes/${recipe.id}`, { method: "DELETE" }), () => {
      setExpanded(null)
      reload()
    })
  }

  return (
    <>
      <TabToolbar
        addLabel="добавить продукцию"
        onAdd={() => setAddOpen(true)}
        query={query}
        onQuery={setQuery}
        count={rows.length}
        filter={
          <Field label="Тип продукта" className="max-w-sm">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClass}>
              <option value="">{t("Все типы")}</option>
              {types.map((type) => <option key={type}>{type}</option>)}
            </select>
          </Field>
        }
      />
      <DataTable headers={["Наименование", "Тип продукта", "Кол-во"]} empty={!rows.length}>
        {rows.map((recipe) => (
          <Fragment key={recipe.id}>
            {expanded === recipe.id ? (
              <tr>
                <td colSpan={3} className="bg-slate-100 p-0">
                  <RecipeDetail
                    recipe={recipe}
                    onClose={() => setExpanded(null)}
                    onDelete={() => removeRecipe(recipe)}
                    onAdd={(role) => setComponentDialog({ recipe, role })}
                    onNorm={() => setNormDialog(recipe)}
                    onUpdateComponent={updateComponent}
                    onRemoveComponent={removeComponent}
                  />
                </td>
              </tr>
            ) : (
              <tr onClick={() => setExpanded(recipe.id)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-6 py-4">{recipe.name}</td>
                <td className="px-6 py-4">{recipe.type}</td>
                <td className="px-6 py-4">{formatAmount(recipe.amount, recipe.unit)}</td>
              </tr>
            )}
          </Fragment>
        ))}
      </DataTable>

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
    <div className="my-3 bg-white shadow-[0_6px_24px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-4">
        <button onClick={onClose} className="text-left text-lg">
          {recipe.name} - <i>{formatAmount(recipe.amount, recipe.unit)}</i>
          {recipe.equipmentName && <span className="ml-3 text-sm text-slate-500">({recipe.equipmentName})</span>}
        </button>
        <div className="flex items-center gap-1 text-slate-600">
          <IconButton label="Изменение нормы" onClick={onNorm}><Pencil className="h-5 w-5" /></IconButton>
          <IconButton label="Удалить продукт" onClick={onDelete}><Trash2 className="h-5 w-5" /></IconButton>
          <IconButton label="Добавить сырье" onClick={() => onAdd("raw")}><ListPlus className="h-5 w-5" /></IconButton>
          <IconButton label="Добавить готовый продукт" onClick={() => onAdd("ready")}><PackagePlus className="h-5 w-5" /></IconButton>
        </div>
      </div>
      <div className="px-6 pb-4">
        <ComponentList title="Сырье" rows={raw} onUpdate={onUpdateComponent} onRemove={onRemoveComponent} />
        {ready.length > 0 && <ComponentList title="Готовый продукт" rows={ready} onUpdate={onUpdateComponent} onRemove={onRemoveComponent} />}
        {!recipe.components.length && <p className="py-6 text-center text-sm text-slate-400">{t("Вы еще не выбрали ни одного сырья")}</p>}
      </div>
    </div>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  return <button onClick={onClick} title={t(label)} aria-label={t(label)} className="rounded p-2 hover:bg-slate-100 hover:text-blue-600">{children}</button>
}

function ComponentList({ title, rows, onUpdate, onRemove }: { title: string; rows: Recipe["components"]; onUpdate: (id: number, amount: number) => void; onRemove: (id: number) => void }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState<number | null>(null)
  const [value, setValue] = useState("")
  if (!rows.length) return null
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="border-b border-dashed border-slate-300 text-left">
          <th className="w-1/2 py-3 font-semibold">{t(title)}</th>
          <th className="py-3 font-semibold">{t("Объем")}</th>
          <th className="w-24" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-200">
            <td className="py-3">{row.name}</td>
            <td className="py-3">
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
                  className="w-28 border-b border-blue-500 outline-none"
                />
              ) : (
                formatAmount(row.amount, row.unit)
              )}
            </td>
            <td className="py-3">
              <RowActions onEdit={() => { setEditing(row.id); setValue(String(row.amount)) }} onDelete={() => onRemove(row.id)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AddRecipeDialog({ stage, equipment, catalog, onClose, onSaved }: { stage: Stage; equipment: Equipment[]; catalog: CatalogItem[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [key, setKey] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [amount, setAmount] = useState("1")
  const [lines, setLines] = useState<DraftLine[]>([])
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
    <Modal title={t("Добавление продукта")} tall onClose={onClose} onSubmit={save} width="max-w-2xl" footer={<SaveButton saving={saving} disabled={!key} />}>
      <div className="space-y-5">
        <Field label="Продукт" required><ItemPicker items={products} value={key} onChange={setKey} placeholder="Продукт" /></Field>
        <Field label="Оборудование">
          <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} className={inputClass}>
            <option value="">—</option>
            {equipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </Field>
        <Field label="Кол-во" required>
          <input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <p className="pt-2 font-semibold">{t("Сырье")}</p>
        <ItemLinesEditor items={rawMaterials} lines={lines} onChange={setLines} emptyText="Вы еще не выбрали ни одного сырья" />
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
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t(role === "ready" ? "Добавить готовый продукт" : "Добавить сырье")} tall onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} disabled={!key} />}>
      <p className="mb-4 text-sm text-slate-500">{recipe.name} {t("— на")} {formatAmount(recipe.amount, recipe.unit)}</p>
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
      window.alert((error as Error).message)
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
  const { data: operations, reload } = useApiData<Operation[]>(`/api/production/operations?stageId=${stage.id}`, [])
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [editing, setEditing] = useState<Operation | "new" | null>(null)
  const rows = operations.filter((row) => (!typeFilter || row.type === typeFilter) && matches(query, row.title, row.equipmentName))
  const typeLabel = (type: Operation["type"]) => t(type === "human" ? "Трудовые затраты" : "Оборудование")

  return (
    <>
      <TabToolbar
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
      />
      <DataTable headers={["Наименование", "Тип продукта", "Оборудование", "Длительность (секунд)", ""]} empty={!rows.length}>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
            <td className="px-6 py-4">{row.title}</td>
            <td className="px-6 py-4">{typeLabel(row.type)}</td>
            <td className="px-6 py-4">{row.type === "equipment" ? row.equipmentName || "N/A" : "N/A"}</td>
            <td className="px-6 py-4">{formatNumber(row.duration)}</td>
            <td className="px-6 py-4">
              <RowActions
                onEdit={() => setEditing(row)}
                onDelete={() => window.confirm(t("Удалить запись?")) && run(() => api(`/api/production/operations/${row.id}`, { method: "DELETE" }), reload)}
              />
            </td>
          </tr>
        ))}
      </DataTable>
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

  return (
    <>
      <TabToolbar addLabel="добавить сотрудников" onAdd={() => setEditing("new")} query={query} onQuery={setQuery} count={rows.length} />
      <DataTable headers={["Сотрудник", "Должность", "Смена", "Время", ""]} empty={!rows.length}>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
            <td className="px-6 py-4">{row.employeeName}</td>
            <td className="px-6 py-4">{row.position}</td>
            <td className="px-6 py-4">{row.shift}</td>
            <td className="px-6 py-4">{row.beginTime || row.endTime ? `${row.beginTime} - ${row.endTime}` : ""}</td>
            <td className="px-6 py-4">
              <RowActions
                onEdit={() => setEditing(row)}
                onDelete={() => window.confirm(t("Удалить запись?")) && run(() => api(`/api/production/staff/${row.id}`, { method: "DELETE" }), reload)}
              />
            </td>
          </tr>
        ))}
      </DataTable>
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

  return (
    <>
      <TabToolbar addLabel="Добавить оборудование" onAdd={() => setEditing("new")} query={query} onQuery={setQuery} count={rows.length} />
      <DataTable headers={["Наименование", "Последний отправленный груз №", "Статус", ""]} empty={!rows.length}>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
            <td className="px-6 py-4">
              <span className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {row.image && <img src={row.image} alt="" className="h-9 w-9 rounded object-cover" />}
                {row.name}
              </span>
            </td>
            <td className="px-6 py-4">{row.lastShipment ?? "-"}</td>
            <td className="px-6 py-4">
              <span className={`mr-2 inline-block h-2 w-2 rounded-full ${row.status === "1" ? "bg-emerald-500" : "bg-slate-400"}`} />
              {t(row.status === "1" ? "работает" : "не работает")}
            </td>
            <td className="px-6 py-4">
              <RowActions
                onEdit={() => setEditing(row)}
                onDelete={() => window.confirm(t("Удалить запись?")) && run(() => api(`/api/production/equipment/${row.id}`, { method: "DELETE" }), reload)}
              />
            </td>
          </tr>
        ))}
      </DataTable>
      {editing && <EquipmentDialog stage={stage} entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </>
  )
}

function EquipmentDialog({ stage, entry, onClose, onSaved }: { stage: Stage; entry: Equipment | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(entry?.name ?? "")
  // A new machine starts as working: shift entries are refused on one that is not.
  const [status, setStatus] = useState<Equipment["status"]>(entry?.status ?? "1")
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
    <Modal title={t(entry ? "Изменение оборудования" : "Добавить оборудование")} onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
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
      <button type="button" onClick={() => fileRef.current?.click()} className="mx-auto mb-6 flex h-36 w-48 flex-col items-center justify-center gap-2 overflow-hidden border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-blue-500">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <ImagePlus className="h-8 w-8" />
            {t("Изображения")}
          </>
        )}
      </button>
      <div className="space-y-5">
        <Field label="Наименование" required><input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></Field>
        <Field label="Производство"><input value={stage.name} disabled className={`${inputClass} text-slate-500`} /></Field>
        <Field label="Статус">
          <select value={status} onChange={(event) => setStatus(event.target.value as Equipment["status"])} className={inputClass}>
            <option value="0">{t("не работает")}</option>
            <option value="1">{t("работает")}</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}
