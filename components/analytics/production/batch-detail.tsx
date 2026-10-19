"use client"

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Calculator, ImagePlus, Package, PackagePlus, Pencil, Plus, ShieldAlert, Trash2 } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"
import {
  api,
  Field,
  formatAmount,
  formatDate,
  formatDateTime,
  formatNumber,
  inputClass,
  ItemLinesEditor,
  ItemPicker,
  Modal,
  readImageFile,
  SaveButton,
  STATUS_LABELS,
  STATUS_TEXT,
  useApiData,
  type CatalogItem,
  type DraftLine,
  type PartyStatus,
  type Stage,
  type StockItem,
} from "./production-ui"

type Movement = {
  id: number
  key: string
  name: string
  unit: string
  amount: number
  cost: number
  total: number
  isDefect: boolean
  comment: string
  image: string
  createdAt: string
}
type SummaryLine = { key: string; name: string; unit: string; amount: number; cost: number; total: number }
export type PartyDetail = {
  id: number
  stageId: number | null
  stageName: string
  warehouse: string
  date: string
  comment: string
  status: PartyStatus
  userName: string
  createdAt: string
  finishedAt: string
  made: Movement[]
  raw: Movement[]
  madeDefects: Movement[]
  rawDefects: Movement[]
  totalMade: SummaryLine[]
  totalRaw: SummaryLine[]
  totalRawCost: number
}
type RecipeComponent = { id: number; role: "raw" | "ready"; key: string; name: string; unit: string; amount: number }
export type Recipe = CatalogItem & { itemId: number; amount: number; equipmentName: string; equipmentId: number | null; components: RecipeComponent[] }

type Dialog = "auto" | "defect" | "raw" | "made" | "edit" | null
type Tab = "summary" | "made" | "raw" | "defects"

const TABS: Array<[Tab, string]> = [
  ["summary", "Итоги производства"],
  ["made", "Произведенные продукты"],
  ["raw", "Сырье"],
  ["defects", "Брак"],
]

export function BatchDetail({ partyId, stages, onChanged }: { partyId: number; stages: Stage[]; onChanged: () => void }) {
  const { t } = useLanguage()
  const { data: party, setData: setParty } = useApiData<PartyDetail | null>(`/api/production/parties/${partyId}`, null)
  const [tab, setTab] = useState<Tab>("summary")
  const [dialog, setDialog] = useState<Dialog>(null)
  const stageId = party?.stageId ?? null
  const needsOptions = dialog === "auto" || dialog === "defect" || dialog === "raw" || dialog === "made"
  const { data: recipes } = useApiData<Recipe[]>(needsOptions && stageId ? `/api/production/recipes?stageId=${stageId}` : null, [])
  const { data: stock } = useApiData<StockItem[]>(needsOptions && stageId ? `/api/production/items?stageId=${stageId}` : null, [])

  if (!party) return <div className="bg-white p-10 text-center text-slate-400 shadow-lg">{t("Загрузка...")}</div>

  const pending = party.status === "pending"
  const updated = (detail: PartyDetail) => {
    setParty(detail)
    setDialog(null)
    onChanged()
  }

  async function removeMovement(id: number) {
    if (!window.confirm(t("Удалить запись?"))) return
    try {
      await api(`/api/production/movements/${id}`, { method: "DELETE" })
      setParty(await api<PartyDetail>(`/api/production/parties/${partyId}`))
      onChanged()
    } catch (error) {
      window.alert((error as Error).message)
    }
  }

  return (
    <div className="my-3 bg-white shadow-[0_6px_24px_rgba(15,23,42,0.18)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <h3 className="text-xl font-semibold">
          № {party.id} <span className={STATUS_TEXT[party.status]}>{t(STATUS_LABELS[party.status])}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {pending && (
            <>
              <ActionButton color="bg-[#5b7ce6]" icon={<Plus className="h-4 w-4" />} label="Автодобавление" onClick={() => setDialog("auto")} />
              <ActionButton color="bg-[#f0856a]" icon={<ShieldAlert className="h-4 w-4" />} label="Добавить бракованный товар" onClick={() => setDialog("defect")} />
              <ActionButton color="bg-[#5cc6a4]" icon={<Package className="h-4 w-4" />} label="Добавить сырье" onClick={() => setDialog("raw")} />
              <ActionButton color="bg-[#5d6be0]" icon={<PackagePlus className="h-4 w-4" />} label="Добавить продукт" onClick={() => setDialog("made")} />
            </>
          )}
          <button onClick={() => setDialog("edit")} aria-label={t("Изменить")} className="p-2 text-slate-600 hover:text-blue-600">
            <Pencil className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-slate-200 md:border-r">
          <dl className="space-y-2 border-b px-6 py-5 text-sm">
            <InfoRow label="Дата создания" value={formatDateTime(party.createdAt)} />
            <InfoRow label="Дата завершения" value={party.finishedAt ? formatDateTime(party.finishedAt) : t("Не указано")} />
            <InfoRow label="Дата партии" value={formatDate(party.date)} />
            <InfoRow label="Пользователь" value={party.userName} />
            <div>
              <dt className="text-slate-600">{t("Этап производства")}</dt>
              <dd className="mt-1 font-semibold uppercase">{party.stageName}</dd>
            </div>
          </dl>
          <div className="px-6 py-5 text-sm">
            <p className="font-semibold">{t("Комментарий")}:</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-600">{party.comment || t("Комментарий отсутствует")}</p>
          </div>
        </aside>

        <section className="min-w-0 px-6 pb-6">
          <nav className="grid grid-cols-2 sm:grid-cols-4">
            {TABS.map(([value, label]) => (
              <button key={value} onClick={() => setTab(value)} className={`border-b-2 px-2 py-4 text-sm ${tab === value ? "border-blue-600 font-semibold" : "border-transparent text-slate-600"}`}>
                {t(label)}
              </button>
            ))}
          </nav>
          {tab === "summary" && (
            <>
              <LinesTable
                headers={["Произведенные товары", "Кол-во", "Себестоимость", "Срок годности"]}
                rows={party.totalMade.map((line) => [line.name, formatAmount(line.amount, line.unit), formatNumber(line.cost), "-"])}
              />
              <LinesTable
                headers={["Затраченное сырье", "Кол-во", "Себестоимость", "Сумма"]}
                rows={party.totalRaw.map((line) => [line.name, formatAmount(line.amount, line.unit), formatNumber(line.cost), formatNumber(line.total)])}
              />
              <TotalRow value={party.totalRawCost} />
            </>
          )}
          {tab === "made" && (
            <LinesTable
              headers={["Продукт", "Кол-во", "Себестоимость", "Срок годности"]}
              rows={party.made.map((row) => [row.name, formatAmount(row.amount, row.unit), formatNumber(row.cost), "-"])}
              onDelete={pending ? party.made.map((row) => () => removeMovement(row.id)) : undefined}
            />
          )}
          {tab === "raw" && (
            <>
              <LinesTable
                headers={["Продукт", "Кол-во", "Себестоимость", "Сумма"]}
                rows={party.raw.map((row) => [row.name, formatAmount(row.amount, row.unit), formatNumber(row.cost), formatNumber(row.total)])}
                onDelete={pending ? party.raw.map((row) => () => removeMovement(row.id)) : undefined}
              />
              <TotalRow value={party.totalRawCost} />
            </>
          )}
          {tab === "defects" && (
            <>
              <DefectTable title="Бракованный товар" rows={party.madeDefects} onDelete={pending ? removeMovement : undefined} />
              <DefectTable title="Бракованное сырье" rows={party.rawDefects} onDelete={pending ? removeMovement : undefined} />
            </>
          )}
        </section>
      </div>

      {dialog === "auto" && <AutoAddDialog party={party} recipes={recipes} stock={stock} onClose={() => setDialog(null)} onSaved={updated} />}
      {dialog === "defect" && <DefectDialog party={party} recipes={recipes} stock={stock} onClose={() => setDialog(null)} onSaved={updated} />}
      {(dialog === "raw" || dialog === "made") && (
        <ItemsDialog party={party} direction={dialog} items={dialog === "raw" ? stock : recipes} onClose={() => setDialog(null)} onSaved={updated} />
      )}
      {dialog === "edit" && (
        <EditDialog
          party={party}
          stages={stages}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            updated(await api<PartyDetail>(`/api/production/parties/${partyId}`))
          }}
        />
      )}
    </div>
  )
}

function ActionButton({ color, icon, label, onClick }: { color: string; icon: ReactNode; label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-95 ${color}`}>
      {icon}
      {t(label)}
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-600">{t(label)}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  )
}

function LinesTable({ headers, rows, onDelete }: { headers: string[]; rows: string[][]; onDelete?: Array<() => void> }) {
  const { t } = useLanguage()
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="border-b border-dashed border-slate-300 text-left">
          {headers.map((header, index) => (
            <th key={header} className={`py-3 font-semibold ${index === 0 ? "w-2/5" : ""}`}>{t(header)}</th>
          ))}
          {onDelete && <th className="w-10" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-b border-dashed border-slate-200">
            {row.map((cell, cellIndex) => <td key={cellIndex} className="py-3">{cell}</td>)}
            {onDelete && (
              <td className="text-right">
                <button onClick={onDelete[index]} aria-label={t("Удалить")} className="p-1 text-slate-500 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TotalRow({ value }: { value: number }) {
  const { t } = useLanguage()
  return (
    <div className="mt-4 flex justify-between pr-10 text-sm font-semibold">
      <span>{t("Итого")}</span>
      <span>{formatNumber(value)}</span>
    </div>
  )
}

function DefectTable({ title, rows, onDelete }: { title: string; rows: Movement[]; onDelete?: (id: number) => void }) {
  const { t } = useLanguage()
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="border-b border-dashed border-slate-300 text-left">
          <th className="w-2/5 py-3 font-semibold">{t(title)}</th>
          <th className="py-3 font-semibold">{t("Кол-во")}</th>
          <th className="py-3 font-semibold">{t("Комментарий")}</th>
          {onDelete && <th className="w-10" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-dashed border-slate-200">
            <td className="py-3">
              <span className="flex items-center gap-2">
                {row.image && (
                  <a href={row.image} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={row.image} alt="" className="h-9 w-9 rounded object-cover" />
                  </a>
                )}
                {row.name}
              </span>
            </td>
            <td className="py-3">{formatAmount(row.amount, row.unit)}</td>
            <td className="py-3 text-slate-600">{row.comment || "-"}</td>
            {onDelete && (
              <td className="text-right">
                <button onClick={() => onDelete(row.id)} aria-label={t("Удалить")} className="p-1 text-slate-500 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

type DialogProps = { party: PartyDetail; onClose: () => void; onSaved: (detail: PartyDetail) => void }

function AutoAddDialog({ party, recipes, stock, onClose, onSaved }: DialogProps & { recipes: Recipe[]; stock: StockItem[] }) {
  const { t } = useLanguage()
  const [recipeKey, setRecipeKey] = useState("")
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")
  const [components, setComponents] = useState<DraftLine[] | null>(null)
  const [saving, setSaving] = useState(false)
  const recipe = recipes.find((entry) => entry.key === recipeKey)
  const stockByKey = useMemo(() => new Map(stock.map((item) => [item.key, item])), [stock])

  function calculate() {
    const quantity = Number(amount.replace(",", "."))
    if (!recipe || !(quantity > 0)) return
    const lines = new Map<string, number>()
    for (const component of recipe.components) {
      const norm = (component.amount * quantity) / (recipe.amount || 1)
      lines.set(component.key, (lines.get(component.key) ?? 0) + norm)
    }
    setComponents(Array.from(lines, ([key, value]) => ({ key, amount: Math.round(value * 1e6) / 1e6 })))
  }

  async function confirm() {
    const quantity = Number(amount.replace(",", "."))
    if (!recipe || !(quantity > 0) || !components) return
    setSaving(true)
    try {
      onSaved(
        await api<PartyDetail>(`/api/production/parties/${party.id}/auto-finish`, {
          method: "POST",
          body: { recipeId: recipe.id, amount: quantity, comment, components },
        }),
      )
    } catch (error) {
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Автодобавление")} tall onClose={onClose} width="max-w-3xl" footer={<SaveButton type="button" label="Подтвердить" saving={saving} disabled={!components} onClick={confirm} />}>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
        <Field label="Продукт">
          <ItemPicker items={recipes} value={recipeKey} onChange={(key) => { setRecipeKey(key); setComponents(null) }} placeholder="Продукт" />
        </Field>
        <Field label="Кол-во">
          <input value={amount} onChange={(event) => { setAmount(event.target.value); setComponents(null) }} inputMode="decimal" className={inputClass} />
        </Field>
        <button type="button" onClick={calculate} disabled={!recipe || !(Number(amount.replace(",", ".")) > 0)} className="flex items-center gap-2 rounded bg-[#5b7ce6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          <Calculator className="h-4 w-4" /> {t("Рассчитать")}
        </button>
      </div>
      {!recipes.length && <p className="mt-3 text-sm text-amber-600">{t("У этапа нет продуктов. Добавьте их в разделе «Этапы производства».")}</p>}

      <h4 className="mt-6 font-semibold">{t("Компоненты")}</h4>
      {components?.length ? (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-dashed border-slate-300 text-left">
              <th className="py-2 font-semibold">{t("Наименование")}</th>
              <th className="py-2 font-semibold">{t("Норма")}</th>
              <th className="py-2 font-semibold">{t("Доступно")}</th>
              <th className="py-2 text-right font-semibold">{t("Изменить / Удалить")}</th>
            </tr>
          </thead>
          <tbody>
            {components.map((line, index) => {
              const item = stockByKey.get(line.key)
              const component = recipe?.components.find((entry) => entry.key === line.key)
              const unit = item?.unit ?? component?.unit ?? ""
              const available = item?.available ?? 0
              return (
                <ComponentRow
                  key={line.key}
                  index={index}
                  name={item?.name ?? component?.name ?? line.key}
                  unit={unit}
                  amount={line.amount}
                  available={available}
                  onChange={(value) => setComponents(components.map((entry, position) => (position === index ? { ...entry, amount: value } : entry)))}
                  onRemove={() => setComponents(components.filter((_, position) => position !== index))}
                />
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="py-12 text-center text-sm text-slate-400">
          {t(components ? "У продукта нет сырья — будет добавлен только готовый продукт" : "Пожалуйста выберите продукт и нажмите на кнопку рассчитать")}
        </p>
      )}
      <Field label="Комментарий" className="mt-4">
        <input value={comment} onChange={(event) => setComment(event.target.value)} className={inputClass} />
      </Field>
    </Modal>
  )
}

function ComponentRow({ index, name, unit, amount, available, onChange, onRemove }: { index: number; name: string; unit: string; amount: number; available: number; onChange: (value: number) => void; onRemove: () => void }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(amount))
  return (
    <tr className="border-b border-dashed border-slate-200">
      <td className="py-2.5">{index + 1}. {name}</td>
      <td className={`py-2.5 ${amount > available ? "text-red-500" : ""}`}>
        {editing ? (
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => {
              const parsed = Number(value.replace(",", "."))
              if (parsed > 0) onChange(parsed)
              setEditing(false)
            }}
            inputMode="decimal"
            className="w-24 border-b border-blue-500 outline-none"
          />
        ) : (
          formatAmount(amount, unit)
        )}
      </td>
      <td className="py-2.5">{formatAmount(available, unit)}</td>
      <td className="py-2.5 text-right">
        <button type="button" onClick={() => { setValue(String(amount)); setEditing(true) }} aria-label={t("Изменить")} className="p-1 text-slate-500 hover:text-blue-600"><Pencil className="h-4 w-4" /></button>
        <button type="button" onClick={onRemove} aria-label={t("Удалить")} className="p-1 text-slate-500 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
      </td>
    </tr>
  )
}

function DefectDialog({ party, recipes, stock, onClose, onSaved }: DialogProps & { recipes: Recipe[]; stock: StockItem[] }) {
  const { t } = useLanguage()
  const [type, setType] = useState<"" | "made" | "raw">("")
  const [key, setKey] = useState("")
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")
  const [image, setImage] = useState("")
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function pickImage(file: File | undefined) {
    if (!file) return
    try {
      setImage(await readImageFile(file))
    } catch (error) {
      window.alert((error as Error).message)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = Number(amount.replace(",", "."))
    if (!type || !key || !(value > 0)) return
    setSaving(true)
    try {
      onSaved(await api<PartyDetail>(`/api/production/parties/${party.id}/defects`, { method: "POST", body: { type, key, amount: value, comment, image } }))
    } catch (error) {
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Добавление брака")} tall onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} disabled={!type || !key} />}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => pickImage(event.target.files?.[0])} />
      <button type="button" onClick={() => fileRef.current?.click()} className="mx-auto mb-6 flex h-40 w-56 flex-col items-center justify-center gap-2 overflow-hidden border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-blue-500">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <ImagePlus className="h-8 w-8" />
            {t("Добавьте фото")}
          </>
        )}
      </button>
      <div className="space-y-5">
        <Field label="Тип брака" required>
          <select value={type} onChange={(event) => { setType(event.target.value as typeof type); setKey("") }} className={inputClass}>
            <option value="">—</option>
            <option value="raw">{t("Сырье")}</option>
            <option value="made">{t("Готовый продукт")}</option>
          </select>
        </Field>
        {type && (
          <Field label="Продукт" required>
            {type === "raw" ? <ItemPicker items={stock} value={key} onChange={setKey} showStock /> : <ItemPicker items={recipes} value={key} onChange={setKey} />}
          </Field>
        )}
        <Field label="Кол-во" required>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Комментарий">
          <input value={comment} onChange={(event) => setComment(event.target.value)} className={inputClass} />
        </Field>
      </div>
    </Modal>
  )
}

function ItemsDialog({ party, direction, items, onClose, onSaved }: DialogProps & { direction: "raw" | "made"; items: CatalogItem[] }) {
  const { t } = useLanguage()
  const [date, setDate] = useState(party.date)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!lines.length) return
    setSaving(true)
    try {
      onSaved(await api<PartyDetail>(`/api/production/parties/${party.id}/items`, { method: "POST", body: { direction, date, items: lines } }))
    } catch (error) {
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={t(direction === "raw" ? "Добавление сырья" : "Добавление продукта")} tall
      onClose={onClose}
      width="max-w-3xl"
      footer={<SaveButton type="button" saving={saving} disabled={!lines.length} onClick={save} />}
    >
      <div className="mb-4 flex items-end gap-6">
        <span className="pb-2 font-semibold">{t("Список товаров")}</span>
        <Field label="Дата" className="w-52">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
      </div>
      {direction === "made" && !items.length && <p className="mb-3 text-sm text-amber-600">{t("У этапа нет продуктов. Добавьте их в разделе «Этапы производства».")}</p>}
      <ItemLinesEditor items={items} lines={lines} onChange={setLines} showStock={direction === "raw"} />
    </Modal>
  )
}

function EditDialog({ party, stages, onClose, onSaved }: { party: PartyDetail; stages: Stage[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLanguage()
  const [stageId, setStageId] = useState(String(party.stageId ?? ""))
  const [status, setStatus] = useState<PartyStatus>(party.status)
  const [date, setDate] = useState(party.date)
  const [comment, setComment] = useState(party.comment)
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await api(`/api/production/parties/${party.id}`, { method: "PUT", body: { stageId: Number(stageId), status, date, comment } })
      await onSaved()
    } catch (error) {
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Изменение партии")} onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} />}>
      <div className="space-y-5">
        <Field label="Этап производства" required>
          <select required value={stageId} onChange={(event) => setStageId(event.target.value)} className={inputClass}>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
        </Field>
        <Field label="Статус" required>
          <select value={status} onChange={(event) => setStatus(event.target.value as PartyStatus)} className={inputClass}>
            {(Object.keys(STATUS_LABELS) as PartyStatus[]).map((value) => <option key={value} value={value}>{t(STATUS_LABELS[value])}</option>)}
          </select>
        </Field>
        <Field label="Дата партии" required>
          <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Комментарий">
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} className={inputClass} />
        </Field>
      </div>
    </Modal>
  )
}
