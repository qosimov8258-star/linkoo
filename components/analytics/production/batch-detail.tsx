"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Calculator, ImagePlus, Pencil, Trash2 } from "lucide-react"

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
  STATUS_TRANSITIONS,
  todayIso,
  useApiData,
  type CatalogItem,
  type DraftLine,
  type PartyStatus,
  type Stage,
  type StockItem,
} from "./production-ui"
import { notify } from "@/lib/notify"

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
    if (!(await askDelete())) return
    try {
      await api(`/api/production/movements/${id}`, { method: "DELETE" })
      setParty(await api<PartyDetail>(`/api/production/parties/${partyId}`))
      onChanged()
    } catch (error) {
      notify((error as Error).message)
    }
  }

  const MADE_SUMMARY = "436px 218px 218px minmax(0,1fr)"
  const PLAIN = "454px 182px 182px minmax(0,1fr)"
  const RAW = "363px 273px 182px minmax(0,1fr)"
  return (
    <div className="mx-[-15px] my-5 bg-white font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex h-[66px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[6px]">
        <h3 className="text-[18px] font-semibold">
          № {party.id} <span className={STATUS_TEXT[party.status]}>{t(STATUS_LABELS[party.status])}</span>
        </h3>
        <div className="flex items-center gap-[10px]">
          {pending && (
            <>
              <ActionButton color="bg-[#4f71dc]" icon="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" label="Автодобавление" onClick={() => setDialog("auto")} />
              <ActionButton color="bg-[#fa8072]" icon="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" label="Добавить бракованный товар" onClick={() => setDialog("defect")} />
              <ActionButton color="bg-[#4db6ac]" icon="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z" label="Добавить сырье" onClick={() => setDialog("raw")} />
              <ActionButton color="bg-[#4f71dc]" icon="M10 17l5-5-5-5v10zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" label="Добавить продукт" onClick={() => setDialog("made")} />
            </>
          )}
          <button onClick={() => setDialog("edit")} aria-label={t("Изменить")} className="-ml-[10px] flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-[320px_minmax(0,1fr)]">
        <aside>
          <dl className="border-b border-[#efefef] px-[30px] pb-[18px] pt-[15px]">
            <InfoRow label="Дата создания" value={formatDateTime(party.createdAt)} />
            <InfoRow label="Дата завершения" value={party.finishedAt ? formatDateTime(party.finishedAt) : t("Не указано")} />
            <InfoRow label="Дата партии" value={formatDate(party.date)} />
            <InfoRow label="Пользователь" value={party.userName} />
            <InfoRow label="Этап производства" value={party.stageName} />
          </dl>
          <div className="px-[30px] py-[20px]">
            <p className="font-semibold">{t("Комментарий")}:</p>
            <p className="mt-[5px] whitespace-pre-wrap">{party.comment || t("Комментарий отсутствует")}</p>
          </div>
        </aside>

        <section className="min-w-0 pb-[20px] pl-[22px] pr-[40px]">
          <nav className="relative ml-[8px] mr-[10px] grid h-[50px] grid-cols-4">
            {TABS.map(([value, label]) => (
              <button key={value} onClick={() => setTab(value)} className="text-center text-[13px]">
                {t(label)}
              </button>
            ))}
            <span className="absolute bottom-0 h-[2px] bg-[#4f71dc] transition-transform duration-300" style={{ width: "25%", transform: `translateX(${TABS.findIndex(([value]) => value === tab) * 100}%)` }} />
          </nav>
          {tab === "summary" && (
            <>
              <LinesTable
                cols={MADE_SUMMARY}
                headers={["Произведенные товары", "Кол-во", "Себестоимость", "Срок годности"]}
                rows={party.totalMade.map((line) => [line.name, formatAmount(line.amount, line.unit), formatNumber(line.cost), "-"])}
              />
              <LinesTable
                cols={MADE_SUMMARY}
                headers={["Затраченное сырье", "Кол-во", "Себестоимость", "Сумма"]}
                rows={party.totalRaw.map((line) => [line.name, formatAmount(line.amount, line.unit), formatNumber(line.cost), formatNumber(line.total)])}
              />
              <TotalRow cols={MADE_SUMMARY} value={party.totalRawCost} />
            </>
          )}
          {tab === "made" && (
            <LinesTable
              cols={PLAIN}
              loose
              headers={["Товар", "Кол-во", "Себестоимость", "Срок годности"]}
              rows={party.made.map((row) => [row.name, formatAmount(row.amount, row.unit), formatNumber(row.cost), "-"])}
              onDelete={pending ? party.made.map((row) => () => removeMovement(row.id)) : undefined}
            />
          )}
          {tab === "raw" && (
            <>
              <LinesTable
                cols={RAW}
                loose
                headers={["Товар", "Кол-во", "Себестоимость", "Сумма"]}
                rows={party.raw.map((row) => [row.name, formatAmount(row.amount, row.unit), formatNumber(row.cost), formatNumber(row.total)])}
                onDelete={pending ? party.raw.map((row) => () => removeMovement(row.id)) : undefined}
              />
              <TotalRow cols={RAW} value={party.raw.reduce((sum, row) => sum + row.total, 0)} />
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

function ActionButton({ color, icon, label, onClick }: { color: string; icon: string; label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button onClick={onClick} className={`flex h-[36px] items-center rounded-[3px] px-4 text-[13px] font-semibold text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-95 ${color}`}>
      <svg viewBox="0 0 24 24" className="mr-[10px] h-6 w-6 fill-white" aria-hidden><path d={icon} /></svg>
      {t(label)}
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex min-h-[25px] flex-wrap items-center justify-between leading-[16px]">
      <dt className="mr-3 whitespace-nowrap">{t(label)}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}

const DOTTED = "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

/** `loose`: the reference's single-list tabs (Произведенные продукты / Сырье) use 60px rows and indent the cells. */
function LinesTable({ headers, rows, onDelete, cols, loose }: { headers: string[]; rows: string[][]; onDelete?: Array<() => void>; cols: string; loose?: boolean }) {
  const { t } = useLanguage()
  const grid = onDelete ? `${cols} 40px` : cols
  return (
    <div>
      <div className={`relative grid h-[56px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: grid }}>
        {headers.map((header) => <div key={header} className={loose ? "pl-2" : ""}>{t(header)}</div>)}
        {onDelete && <div />}
      </div>
      {rows.map((row, index) => (
        <div key={index} className={`relative grid items-center ${loose ? "min-h-[60px]" : "min-h-[50px]"} ${DOTTED}`} style={{ gridTemplateColumns: grid }}>
          {row.map((cell, cellIndex) => <div key={cellIndex} className={loose ? "pl-[13px]" : ""}>{cell}</div>)}
          {onDelete && (
            <button onClick={onDelete[index]} aria-label={t("Удалить")} className="flex h-8 w-8 items-center justify-center justify-self-end">
              <Trash2 className="h-4 w-4 text-[#5d6474]" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function TotalRow({ value, cols }: { value: number; cols: string }) {
  const { t } = useLanguage()
  return (
    <div className="grid h-[50px] items-center font-semibold" style={{ gridTemplateColumns: cols }}>
      <span className="pl-[5px]">{t("Итого")}</span>
      <span /><span />
      <span className="pl-[5px]">{formatNumber(value)}</span>
    </div>
  )
}

function DefectTable({ title, rows, onDelete }: { title: string; rows: Movement[]; onDelete?: (id: number) => void }) {
  const { t } = useLanguage()
  // Name | amount | photo (the reference lists the defect's photo in the third column).
  const grid = onDelete ? "636px 281px minmax(0,1fr) 40px" : "636px 281px minmax(0,1fr)"
  return (
    <div>
      <div className={`relative grid h-[56px] items-center font-semibold ${DOTTED}`} style={{ gridTemplateColumns: grid }}>
        <div className="pl-2">{t(title)}</div>
        <div className="pl-2">{t("Кол-во")}</div>
        <div />
        {onDelete && <div />}
      </div>
      {rows.map((row) => (
        <div key={row.id} title={row.comment || undefined} className={`relative grid min-h-[60px] items-center ${DOTTED}`} style={{ gridTemplateColumns: grid }}>
          <span className="pl-[13px]">{row.name}</span>
          <span className="pl-[13px]">{formatAmount(row.amount, row.unit)}</span>
          <span>
            {row.image && (
              <a href={row.image} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={row.image} alt={row.name} className="h-10 w-10 rounded object-cover" />
              </a>
            )}
          </span>
          {onDelete && (
            <button onClick={() => onDelete(row.id)} aria-label={t("Удалить")} className="flex h-8 w-8 items-center justify-center justify-self-end">
              <Trash2 className="h-4 w-4 text-[#5d6474]" />
            </button>
          )}
        </div>
      ))}
    </div>
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
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Автодобавление")} tall onClose={onClose} width="max-w-[1000px]" footer={<SaveButton type="button" label="Подтвердить" saving={saving} disabled={!components} onClick={confirm} />}>
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
      notify((error as Error).message)
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
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Добавление брака")} tall width="max-w-[700px]" onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} disabled={!type || !key} />}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => pickImage(event.target.files?.[0])} />
      <button type="button" onClick={() => fileRef.current?.click()} className="mx-auto mb-6 flex h-[200px] w-[200px] flex-col items-center justify-center gap-2 overflow-hidden border border-dashed border-[#dcdcdc] text-[13px] text-[#333]">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-[#c4c4c4]" aria-hidden><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
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
      notify((error as Error).message)
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
          <input type="date" value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} className={inputClass} />
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
  // Lines are booked on their own day in the batch's warehouse: once there
  // are any, the batch date and stage stay as they are.
  const hasLines = party.made.length + party.raw.length + party.madeDefects.length + party.rawDefects.length > 0

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await api(`/api/production/parties/${party.id}`, { method: "PUT", body: { stageId: Number(stageId), status, date, comment } })
      await onSaved()
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Изменение партии")} width="max-w-[700px]" onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} label="Изменить" />}>
      <div className="space-y-5">
        <Field label="Этап производства" required>
          <select required value={stageId} disabled={hasLines} onChange={(event) => setStageId(event.target.value)} className={inputClass}>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
        </Field>
        <Field label="Статус" required>
          <select value={status} onChange={(event) => setStatus(event.target.value as PartyStatus)} className={inputClass}>
            {STATUS_TRANSITIONS[party.status].map((value) => <option key={value} value={value}>{t(STATUS_LABELS[value])}</option>)}
          </select>
        </Field>
        <Field label="Дата партии" required>
          <input required type="date" value={date} max={todayIso()} disabled={hasLines} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
        {hasLines && <p className="-mt-3 text-xs text-slate-500">{t("В партии уже есть товары — этап и дату изменить нельзя")}</p>}
        <Field label="Комментарий">
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} className={inputClass} />
        </Field>
      </div>
    </Modal>
  )
}
