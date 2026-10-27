"use client"

import { ChevronDown, ChevronUp, Minus, Plus, X } from "lucide-react"
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

export type ProductDraftPriceEntry = { name: string; cash: string; cashCurrency: string; nonCash: string; nonCashCurrency: string }

export type ProductDraft = {
  name: string
  fullName: string
  barcodes: string[]
  article: string
  integrationCode: string
  type: string
  organization: string
  unit: string
  orderNumber: string
  supplier: string
  brand: string
  description: string
  minStock: string
  volume: string
  weight: string
  netWeight: string
  color: string
  group: string
  ikpu: string
  invoiceUnitCode: string
  vat: string
  salePoints: string
  canSell: boolean
  showInBot: boolean
  markedProduct: boolean
  limitPrice: boolean
  onlyMml: boolean
  perfectStore: boolean
  isInventory: boolean
  groupOnly: boolean
  trackExpiry: boolean
  priceMin: string
  priceMax: string
  priceEntries: ProductDraftPriceEntry[]
  subcategory: string
  attributes: Record<string, string>
}

export type ProductTypeNode = { id: number; name: string; parentId: number | null }
export type ProductAttributeDef = { id: number; name: string; fieldType: string; allTypes: boolean; types: string[] }

type ToggleKey = "onlyMml" | "perfectStore" | "isInventory" | "groupOnly" | "trackExpiry" | "markedProduct"

type Props = {
  editing: boolean
  draft: ProductDraft
  setDraft: (update: (current: ProductDraft) => ProductDraft) => void
  saving: boolean
  canSubmit: boolean
  units: string[]
  types: string[]
  brands: string[]
  organizations: string[]
  vatOptions: string[]
  priceListNames: string[]
  currencies: string[]
  typeTree: ProductTypeNode[]
  attributeDefs: ProductAttributeDef[]
  attributeValues: Record<string, string[]>
  groupOpen: boolean
  setGroupOpen: (value: boolean) => void
  extraOpen: boolean
  setExtraOpen: (value: boolean) => void
  onAddUnit: (value: string) => void
  onAddType: (value: string) => void
  onAddBrand: (value: string) => void
  onAddPriceList: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}

const GREEN = "#7bc67e"
const BLUE = "#4f71dc"

/** Full-screen "Добавить / Изменить продукт" form of the original app. */
export function ProductFormDialog(props: Props) {
  const { t } = useLanguage()
  const { draft, setDraft } = props
  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [props])

  function updateEntry(index: number, patch: Partial<ProductDraftPriceEntry>) {
    setDraft((current) => ({ ...current, priceEntries: current.priceEntries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) }))
  }
  function addEntry() {
    setDraft((current) => ({ ...current, priceEntries: [...current.priceEntries, { name: "", cash: "", cashCurrency: "", nonCash: "", nonCashCurrency: "" }] }))
  }
  function removeEntry(index: number) {
    setDraft((current) => {
      const next = current.priceEntries.filter((_, i) => i !== index)
      return { ...current, priceEntries: next.length ? next : [{ name: "", cash: "", cashCurrency: "", nonCash: "", nonCashCurrency: "" }] }
    })
  }
  function promptAdd(label: string, handler: (value: string) => void) {
    const value = window.prompt(label)
    if (value?.trim()) handler(value.trim())
  }

  const typeIdByName = new Map(props.typeTree.map((node) => [node.name, node.id]))
  const topTypes = props.typeTree.filter((node) => node.parentId === null || node.parentId === 0).map((node) => node.name)
  const typeOptions = Array.from(new Set([...topTypes, ...props.types]))
  const selectedTypeId = typeIdByName.get(draft.type)
  const subOptions = props.typeTree.filter((node) => selectedTypeId !== undefined && node.parentId === selectedTypeId).map((node) => node.name)
  const fieldOrder = ["Выбор вариантов", "Текстовое поле", "Цифровое поле"]
  const applicableAttributes = props.attributeDefs
    .filter((attribute) => attribute.allTypes || attribute.types.includes(draft.type))
    .sort((a, b) => fieldOrder.indexOf(a.fieldType) - fieldOrder.indexOf(b.fieldType) || a.id - b.id)
  const setAttribute = (name: string, value: string) => setDraft((current) => ({ ...current, attributes: { ...current.attributes, [name]: value } }))
  const entries = draft.priceEntries
  const blankOnly = entries.length === 1 && !entries[0].name && !entries[0].cash && !entries[0].nonCash
  const toggles: [ToggleKey, string, boolean][] = [
    ["onlyMml", "ММЛ продукт", true],
    ["perfectStore", "Perfect Store продукт", false],
    ["isInventory", "Показывать этот товар в качестве тип инвентаря", true],
    ["groupOnly", "Продать только в группе", true],
  ]

  return createPortal(
    <form onSubmit={props.onSubmit} className="fixed inset-0 z-[100] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[42px]">
        <h2 className="text-[14px] font-bold uppercase">{props.editing ? t("Изменить продукт") : t("Добавить продукт")}</h2>
        <button type="button" onClick={props.onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-3 divide-x divide-[#e8ebf0] overflow-y-auto">
        {/* Column 1 */}
        <div className="px-[30px] pb-10 pt-[23px]">
          <Field label={t("Наименование")} required value={draft.name} onChange={(v) => set("name", v)} />
          <div className="mt-[27px] flex items-end gap-[8px]">
            <div className="flex-1">
              <Select label={t("Мера")} required value={draft.unit} onChange={(v) => set("unit", v)} options={props.units} onClear={() => set("unit", "")} />
            </div>
            <PlusCircle title={t("Добавить меру")} onClick={() => promptAdd(t("Новая мера"), props.onAddUnit)} />
            <span className="ml-[17px]"><InfoIcon title={t("Единица измерения товара")} /></span>
          </div>
          <div className="mt-[20px] space-y-[10px]">
            <CheckRow checked={props.groupOpen} onChange={props.setGroupOpen} label={t("Указать группу")} />
            {props.groupOpen && <Field label={t("Группа")} value={draft.group} onChange={(v) => set("group", v)} />}
            <CheckRow checked={props.extraOpen} onChange={props.setExtraOpen} label={t("ДОП. параметры")} />
          </div>
          <div className="mt-[29px] flex items-end gap-[8px]">
            <div className="flex-1"><Select label={t("Тип продукта")} value={draft.type} onChange={(v) => setDraft((current) => ({ ...current, type: v, subcategory: "", attributes: {} }))} options={typeOptions} onClear={() => setDraft((current) => ({ ...current, type: "", subcategory: "", attributes: {} }))} /></div>
            <PlusCircle title={t("Добавить тип продукта")} onClick={() => promptAdd(t("Новый тип продукта"), props.onAddType)} />
          </div>
          {draft.type && (
            <>
              <div className="mt-[12px] pr-[28px]"><Select label={t("Подкатегория")} value={draft.subcategory} onChange={(v) => set("subcategory", v)} options={subOptions} onClear={() => set("subcategory", "")} /></div>
              {applicableAttributes.length > 0 && (
                <div className="-mx-[30px] mt-[9px] space-y-[12px] bg-[#f2f5f8] pb-[19px] pl-[30px] pr-[40px] pt-[28px]">
                  {applicableAttributes.map((attribute) =>
                    attribute.fieldType === "Выбор вариантов" ? (
                      <Select key={attribute.id} label={attribute.name} value={draft.attributes[attribute.name] ?? ""} onChange={(v) => setAttribute(attribute.name, v)} options={props.attributeValues[attribute.name] ?? []} onClear={() => setAttribute(attribute.name, "")} />
                    ) : (
                      <Field key={attribute.id} label={attribute.name} numeric={attribute.fieldType === "Цифровое поле"} value={draft.attributes[attribute.name] ?? ""} onChange={(v) => setAttribute(attribute.name, v)} />
                    ),
                  )}
                </div>
              )}
            </>
          )}
          <div className={`${draft.type && applicableAttributes.length > 0 ? "mt-[18px]" : "mt-[27px]"} flex items-end gap-[6px]`}>
            <div className="w-[218px]"><Field label={t("Поставщик")} value={draft.supplier} onChange={(v) => set("supplier", v)} /></div>
            <div className="w-[218px]"><Select label={t("Бренд")} value={draft.brand} onChange={(v) => set("brand", v)} options={props.brands} onClear={() => set("brand", "")} /></div>
            <PlusCircle title={t("Добавить бренд")} onClick={() => promptAdd(t("Новый бренд"), props.onAddBrand)} />
          </div>
          <div className="mt-[27px]"><Select label={t("Организация")} value={draft.organization} onChange={(v) => set("organization", v)} options={props.organizations} onClear={() => set("organization", "")} /></div>
          <div className="mt-[12px] flex items-end gap-[16px]">
            <div className="flex-1"><Field label={t("Порядковый номер")} value={draft.orderNumber} onChange={(v) => set("orderNumber", v)} /></div>
            <InfoIcon title={t("Определяет позицию товара в списках")} />
          </div>
          <div className="mt-[12px] flex items-end gap-[16px]">
            <div className="flex-1"><Field label={t("Минимальный остаток")} value={draft.minStock} onChange={(v) => set("minStock", v)} /></div>
            <InfoIcon title={t("Порог для уведомления о нехватке товара")} />
          </div>
          <div className="mt-[27px]"><Field label={t("Цвет")} value={draft.color} onChange={(v) => set("color", v)} /></div>
          <div className="mt-[32px]"><Field label={t("Описание")} value={draft.description} onChange={(v) => set("description", v)} /></div>
        </div>

        {/* Column 2 */}
        <div className="px-[30px] pb-10 pt-[23px]">
          <Field label={t("Полное наименование")} value={draft.fullName} onChange={(v) => set("fullName", v)} />
          {draft.barcodes.map((code, index) => (
            <div key={index} className="mt-[13px]">
              <div className="flex items-end gap-[20px]">
                <div className="flex-1">
                  <Field label={t("Штрих-код")} value={code} onChange={(v) => setDraft((current) => ({ ...current, barcodes: current.barcodes.map((c, i) => (i === index ? v : c)) }))} />
                </div>
                {index === draft.barcodes.length - 1 ? (
                  <PlusCircle dark title={t("Добавить штрих-код")} onClick={() => setDraft((current) => ({ ...current, barcodes: [...current.barcodes, ""] }))} />
                ) : (
                  <button type="button" title={t("Удалить штрих-код")} onClick={() => setDraft((current) => ({ ...current, barcodes: current.barcodes.filter((_, i) => i !== index) }))} className="mb-[8px] flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-[#555] text-[#555]">
                    <Minus className="h-3 w-3 stroke-[3]" />
                  </button>
                )}
              </div>
              <button type="button" onClick={() => setDraft((current) => ({ ...current, barcodes: current.barcodes.map((c, i) => (i === index ? String(Date.now()).slice(-13) : c)) }))} className="mt-[6px] block text-[13px] text-[#4f71dc] hover:underline">
                {t("Сгенерировать")}
              </button>
            </div>
          ))}
          <div className="mt-[2px]"><Field label={t("Артикул")} value={draft.article} onChange={(v) => set("article", v)} /></div>
          <div className="mt-[12px]"><Field label={t("Код для интеграции")} value={draft.integrationCode} onChange={(v) => set("integrationCode", v)} /></div>
          <div className="mt-[12px]"><Field label={t("Масса - кг")} value={draft.weight} onChange={(v) => set("weight", v)} /></div>
          <div className="mt-[12px]"><Field label={t("Вес нетто")} value={draft.netWeight} onChange={(v) => set("netWeight", v)} /></div>
          <div className="mt-[12px]"><Field label={t("Объем")} value={draft.volume} onChange={(v) => set("volume", v)} /></div>
          <div className="mt-[12px]"><Field label={t("Икпу")} value={draft.ikpu} onChange={(v) => set("ikpu", v)} /></div>
          <div className="mt-[12px]"><Field label={t("Код ед.изм. в фактуре")} value={draft.invoiceUnitCode} onChange={(v) => set("invoiceUnitCode", v)} /></div>
          <div className="mt-[12px]"><Select label={t("НДС")} value={draft.vat} onChange={(v) => set("vat", v)} options={props.vatOptions} onClear={() => set("vat", "")} /></div>

          <div className="mt-[10px] space-y-[17px]">
            {toggles.map(([key, label, info]) => (
              <Toggle key={key} checked={draft[key]} onChange={(v) => set(key, v)} label={t(label)} info={info} />
            ))}
            <Toggle checked={draft.showInBot} onChange={(v) => set("showInBot", v)} label={t("Показывать в боте")} sub={t("Показывать в телеграм боте")} />
            <Toggle checked={draft.trackExpiry} onChange={(v) => set("trackExpiry", v)} label={t("Учитывать срок годности")} />
            <Toggle checked={draft.markedProduct} onChange={(v) => set("markedProduct", v)} label={t("Маркировочный товар")} />
            <Toggle checked={draft.limitPrice} onChange={(v) => set("limitPrice", v)} label={t("Установить минимальную и максимальную цену для продажи")} />
          </div>
        </div>

        {/* Column 3 */}
        <div className="px-[30px] pb-10 pt-[39px]">
          <Toggle checked={draft.canSell} onChange={(v) => set("canSell", v)} label={t("Можно продавать")} sub={t("Агенты могут продать этот товар")} />
          <div className="mt-[16px] flex h-[30px] items-center justify-between pr-[8px]">
            <span className="text-[13px] text-[#555]">{t("Продажная цена")}</span>
            {blankOnly ? (
              <BlueButton icon={<Plus className="h-4 w-4 stroke-[3]" />} onClick={addEntry}>{t("Добавить новую цену")}</BlueButton>
            ) : (
              <BlueButton icon={<Minus className="h-4 w-4 stroke-[3]" />} onClick={() => removeEntry(0)}>{t("Удалить новую цену")}</BlueButton>
            )}
          </div>
          {entries.map((entry, index) => (
            <div key={index}>
              {index > 0 && (
                <div className="mt-[10px] flex h-[30px] items-center justify-end">
                  <BlueButton icon={<Minus className="h-4 w-4 stroke-[3]" />} onClick={() => removeEntry(index)}>{t("Удалить новую цену")}</BlueButton>
                </div>
              )}
              <div className="mt-[11px] flex items-end gap-[10px]">
                <div className="flex-1"><Select label={t("Прайс лист")} value={entry.name} onChange={(v) => updateEntry(index, { name: v })} options={props.priceListNames} onClear={() => updateEntry(index, { name: "" })} /></div>
                <PlusCircle title={t("Добавить прайс лист")} onClick={() => promptAdd(t("Название прайс листа"), (value) => { props.onAddPriceList(value); updateEntry(index, { name: value }) })} />
              </div>
              <div className="mt-[27px] flex items-end gap-[10px]">
                <div className="flex-1"><Field label={t("Цена наличные")} value={entry.cash} onChange={(v) => updateEntry(index, { cash: v })} numeric /></div>
                <div className="flex-1"><Select label={t("Валюта")} value={entry.cashCurrency} onChange={(v) => updateEntry(index, { cashCurrency: v })} options={props.currencies} onClear={() => updateEntry(index, { cashCurrency: "" })} /></div>
              </div>
              <div className="mt-[27px] flex items-end gap-[10px]">
                <div className="flex-1"><Field label={t("Цена безналичные")} value={entry.nonCash} onChange={(v) => updateEntry(index, { nonCash: v })} numeric /></div>
                <div className="flex-1"><Select label={t("Валюта")} value={entry.nonCashCurrency} onChange={(v) => updateEntry(index, { nonCashCurrency: v })} options={props.currencies} onClear={() => updateEntry(index, { nonCashCurrency: "" })} /></div>
              </div>
              <div className="mt-[9px]"><Toggle checked={draft.limitPrice} onChange={(v) => set("limitPrice", v)} label={t("Установить минимальную и максимальную цену для продажи")} /></div>
              {draft.limitPrice && index === entries.length - 1 && (
                <div className="mt-[14px] flex gap-[10px]">
                  <div className="flex-1"><Field label={t("Мин")} value={draft.priceMin} onChange={(v) => set("priceMin", v)} numeric /></div>
                  <div className="flex-1"><Field label={t("Макс")} value={draft.priceMax} onChange={(v) => set("priceMax", v)} numeric /></div>
                </div>
              )}
            </div>
          ))}
          {!blankOnly && (
            <div className="mt-[16px] flex justify-end">
              <BlueButton icon={<Plus className="h-4 w-4 stroke-[3]" />} onClick={addEntry}>{t("Добавить новую цену")}</BlueButton>
            </div>
          )}
          <div className="mt-[35px] flex items-end gap-[24px]">
            <div className="flex-1"><Field label={t("Можно продать за кол-во балов")} value={draft.salePoints} onChange={(v) => set("salePoints", v)} /></div>
            <InfoIcon title={t("Количество бонусных баллов, за которые можно продать товар")} />
          </div>
        </div>
      </div>

      <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
        <button type="submit" disabled={props.saving || !props.canSubmit} className="h-9 min-w-[196px] rounded-[3px] bg-[#71ce87] px-[16px] text-[12px] font-bold uppercase text-white hover:brightness-95 disabled:bg-[#ade3b9] disabled:hover:brightness-100">
          {props.saving ? t("Сохранение...") : t(props.editing ? "Сохранить изменение" : "Сохранить")}
        </button>
      </footer>
    </form>,
    document.body,
  )
}

/** Underlined input; the label sits inside while empty and floats above once a value is typed. */
function Field({ label, value, onChange, required, numeric, autoFocus }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; numeric?: boolean; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="relative h-[40px] border-b border-[#d5dae1]">
      <span className={`pointer-events-none absolute left-0 transition-all ${floating ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type={numeric ? "number" : "text"}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent text-[13px] outline-none"
      />
    </div>
  )
}

function Select({ label, value, onChange, options, onClear, required }: { label: string; value: string; onChange: (value: string) => void; options: string[]; onClear: () => void; required?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const list = value && !options.includes(value) ? [value, ...options] : options
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="relative block h-[40px] w-full border-b border-[#d5dae1] text-left">
        <span className={`absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>
          {label}{required && <span className="text-red-500"> *</span>}
        </span>
        {value && <span className="absolute inset-x-0 bottom-[6px] truncate pr-12 text-[13px]">{value}</span>}
        <span className="absolute bottom-[8px] right-0 flex items-center gap-[10px] text-slate-500">
          {value && <span role="button" aria-label={t("Очистить")} onClick={(event) => { event.stopPropagation(); onClear() }}><X className="h-3.5 w-3.5" /></span>}
          {open ? <ChevronUp className="h-4 w-4 fill-current" /> : <ChevronDown className="h-4 w-4 fill-current" />}
        </span>
      </button>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {list.length === 0 ? (
            <li className="px-3 py-2 font-semibold text-slate-400">—</li>
          ) : (
            list.map((option, index) => (
              <li key={`${option}-${index}`}>
                <button type="button" onClick={() => { onChange(option); setOpen(false) }} className={`block w-full px-3 py-2 text-left font-semibold ${option === value ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}>{option}</button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-[14px] text-[13px] font-semibold">
      <span className={`flex h-[16px] w-[16px] items-center justify-center rounded-[2px] border-2 ${checked ? "border-[#5d6474] bg-[#5d6474]" : "border-[#555]"}`}>
        {checked && <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" /></svg>}
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      </span>
      {label}
    </label>
  )
}

function Toggle({ checked, onChange, label, sub, info }: { checked: boolean; onChange: (value: boolean) => void; label: string; sub?: string; info?: boolean }) {
  return (
    <div className="flex items-center gap-[4px]">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="relative h-[22px] w-[40px] shrink-0">
        <span className={`absolute left-[2px] top-[4px] h-[14px] w-[34px] rounded-full ${checked ? "bg-[#a7b8ed]" : "bg-[#bdbdbd]"}`} />
        <span className={`absolute top-0 h-[22px] w-[22px] rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-all ${checked ? "left-[18px] bg-[#4f71dc]" : "left-0 bg-white"}`} />
      </button>
      <span className="leading-[16px]">
        <span className="font-semibold">{label}</span>
        {sub && <span className="block text-[13px] font-normal text-[#555]">{sub}</span>}
      </span>
      {info && <InfoIcon small />}
    </div>
  )
}

function BlueButton({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-[30px] items-center gap-[8px] rounded-[3px] bg-[#4f71dc] px-[10px] text-[13px] font-bold text-white hover:brightness-95">
      <span className="flex h-[16px] w-[16px] items-center justify-center rounded-full bg-white text-[#4f71dc]">{icon}</span>
      {children}
    </button>
  )
}

function PlusCircle({ onClick, title, dark }: { onClick: () => void; title: string; dark?: boolean }) {
  const color = dark ? "#555" : GREEN
  return (
    <button type="button" onClick={onClick} title={title} className="mb-[8px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: color, color }}>
      <Plus className="h-3 w-3 stroke-[3]" />
    </button>
  )
}

function InfoIcon({ title, small }: { title?: string; small?: boolean }) {
  return (
    <span title={title} className={`flex shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${small ? "h-[20px] w-[20px]" : "mb-[8px] h-[20px] w-[20px]"}`} style={{ borderColor: BLUE, color: BLUE }}>
      i
    </span>
  )
}
