"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ImageOff, PlusCircle } from "lucide-react"

import { buildCashQuery, cashMutate, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { MaterialDate } from "@/components/analytics/cash-material"
import {
  CashModal,
  FormField,
  PrimaryButton,
  ReadonlyField,
  SearchSelect,
  SecondaryButton,
  inputClass,
  mutationError,
  useClientSearch,
  type PickOption,
} from "@/components/analytics/cash-management-shared"
import { photoUrl, qtyText } from "@/components/analytics/inventory-management-shared"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  INVENTORY_REQUEST_TYPES,
  INVENTORY_REQUEST_TYPE_LABELS,
  type InventoryItem,
  type InventoryItemDetail,
  type InventoryItemListResult,
  type InventoryOptions,
  type InventoryProductOption,
  type InventoryRequest,
  type InventoryRequestType,
} from "@/lib/inventory-items-types"

// Dialogs of "Работа с инвентарем" (demo c84): "Добавление / Изменение
// инвентаря" (module 4397), "Передача / Изъятие" (4863), the request
// confirmation "Прикрипления оборудивании" (4868, with "+" = new item) and
// "Новый запрос" (agents' requests come from the mobile app in the demo).

const REQUIRED = "Обязательное поле"
type Errors = Record<string, string>

/** Client select loaded by search (GET /api/clients?q=); like Linko's for_select of Market, the options are names only. */
function ClientPicker({ value, label, onChange, invalid }: { value: string; label: string; onChange: (id: string, name: string) => void; invalid?: boolean }) {
  const { t } = useLanguage()
  const clients = useClientSearch(true)
  const options = useMemo(() => clients.options.map(({ value: id, label: name }) => ({ value: id, label: name })), [clients.options])
  return (
    <SearchSelect
      value={value}
      selectedLabel={label}
      options={options}
      loading={clients.loading}
      onSearch={clients.search}
      placeholder={t("Выберите клиента")}
      invalid={invalid}
      onChange={(id, option) => onChange(id, option?.label ?? "")}
    />
  )
}

/** Items select loaded by search (demo GearSearchField: product, inventory and serial number). */
export function GearPicker({ value, label, params, onChange, invalid }: { value: string; label?: string; params: CashQuery; onChange: (id: string, item: InventoryItem | null) => void; invalid?: boolean }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const list = useCashJson<InventoryItemListResult>(`/api/inventory-items?${buildCashQuery({ ...params, search, pageSize: 30 })}`)
  const items = useMemo(() => list.data?.results ?? [], [list.data])
  const options: PickOption[] = items.map((item) => ({
    value: String(item.id),
    label: `№${item.id} ${item.product.name}${item.stockNumber ? ` (№${item.stockNumber})` : ""}`,
    hint: [item.serialNumber, item.client?.name, item.warehouse].filter(Boolean).join(" · "),
  }))
  return (
    <SearchSelect
      value={value}
      selectedLabel={label}
      options={options}
      loading={list.loading}
      onSearch={setQuery}
      placeholder={t("Выберите инвентарь")}
      invalid={invalid}
      onChange={(id) => onChange(id, items.find((item) => String(item.id) === id) ?? null)}
    />
  )
}

/** Picture → JPEG data URL, longest side ≤ 1280 px. */
async function resizeImage(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image()
      element.onload = () => resolve(element)
      element.onerror = reject
      element.src = url
    })
    const scale = Math.min(1, max / Math.max(image.width, image.height, 1))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Demo ImageUploadField: 250 px drop zone; `value` undefined = the stored photo. `missing`: the item has a photo whose
 * file is gone (a Linko file), shown as Linko's broken image. Like Linko's, a photo is replaced, not removed. */
function PhotoField({ value, stored, missing = false, onChange }: { value: string | undefined; stored: string | null; missing?: boolean; onChange: (value: string | undefined) => void }) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const shown = value === undefined ? stored : value || null
  const broken = value === undefined && !stored && missing
  return (
    <div className="flex flex-col items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          setError("")
          try {
            onChange(await resizeImage(file))
          } catch {
            setError(t("Не удалось прочитать изображение"))
          }
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="relative flex h-[250px] w-[250px] flex-col items-center justify-center gap-2 overflow-hidden border border-dashed border-[#c4cbd6] bg-white text-[#9aa3b6] hover:border-[#1E4A9A]"
      >
        {shown ? <Image src={shown} alt="" fill unoptimized className="object-cover" /> : broken ? <ImageOff className="absolute left-1 top-[calc(50%-8px)] h-4 w-4 text-[#9e9e9e]" aria-hidden /> : (
          <>
            <svg viewBox="0 0 24 24" className="h-12 w-12 fill-[#bdbdbd]" aria-hidden><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
            <span className="text-[13px] text-[#555]">{t("Добавьте фото")}</span>
          </>
        )}
      </button>
      {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
    </div>
  )
}

const FIELD_OF: Record<string, string> = { product: "productId", user: "responsible", client: "clientId" }

/** "Добавление инвентаря" / "Изменение инвентаря". `inStock` hides Клиент (new item for a request). */
export function ItemFormDialog({
  item,
  options,
  inStock = false,
  onClose,
  onSaved,
}: {
  item: InventoryItemDetail | null
  options: InventoryOptions | null
  inStock?: boolean
  onClose: () => void
  onSaved: (item: InventoryItemDetail, created: boolean) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({
    warehouse: item?.warehouse ?? (options?.warehouses.length === 1 ? options.warehouses[0].name : ""),
    productId: item?.product.id ? String(item.product.id) : "",
    condition: item?.condition ?? "",
    responsible: item?.responsible ?? "",
    clientId: "",
    clientLabel: "",
    serialNumber: item?.serialNumber ?? "",
    stockNumber: item?.stockNumber ?? "",
    date: item?.date || "",
    comment: item?.comment ?? "",
  })
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  // Like Linko's form, a required field's message goes as soon as the field is filled.
  const set = (patch: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setErrors((current) => {
      const filled = Object.entries(patch).filter(([key, value]) => value && key in current)
      if (!filled.length) return current
      const next = { ...current }
      for (const [key] of filled) delete next[key as keyof Errors]
      return next
    })
  }
  const products = useCashJson<InventoryProductOption[]>(`/api/inventory-items/products?${buildCashQuery({ warehouse: draft.warehouse, includeId: item?.product.id ?? "" })}`)
  // Linko's options: "<name> (<balance> <unit>)" over "Доступно: <available> <unit>" (stock/all_balances?is_gear=true&stock=),
  // the stock of every warehouse while none is chosen.
  const productOptions: PickOption[] = (products.data ?? []).map((product) => ({
    value: String(product.id),
    label: `${product.name} (${qtyText(product.balance, product.unit)})`,
    hint: `${t("Доступно")}: ${qtyText(product.available, product.unit)}`,
  }))
  const named = (values: string[]) => values.map((value) => ({ value, label: value }))
  /** The option list with the item's current value kept when the list no longer has it. */
  const withCurrent = (values: string[] | undefined, current: string | undefined) => (values ?? []).concat(current && !(values ?? []).includes(current) ? [current] : [])
  const conditions = withCurrent(options?.conditions, item?.condition)

  const submit = async () => {
    const missing: Errors = {}
    for (const key of ["warehouse", "productId", "condition", "responsible", "serialNumber", "stockNumber", "date"] as const) if (!draft[key].trim()) missing[key] = t(REQUIRED)
    if (!item && !inStock && !draft.clientId) missing.clientId = t(REQUIRED)
    setErrors(missing)
    if (Object.keys(missing).length) return
    setBusy(true)
    setError("")
    const body = {
      warehouse: draft.warehouse,
      productId: Number(draft.productId),
      condition: draft.condition,
      responsible: draft.responsible,
      clientId: !item && !inStock && draft.clientId ? Number(draft.clientId) : null,
      serialNumber: draft.serialNumber,
      stockNumber: draft.stockNumber,
      date: draft.date,
      comment: draft.comment,
      ...(photo === undefined ? {} : { photo }),
    }
    const result = item ? await cashMutate<InventoryItemDetail>("PUT", `/api/inventory-items/${item.id}`, body) : await cashMutate<InventoryItemDetail>("POST", "/api/inventory-items", body)
    setBusy(false)
    if (!result.ok) {
      const field = result.field ? (FIELD_OF[result.field] ?? result.field) : ""
      if (field) setErrors({ [field]: t(result.error) })
      return setError(mutationError(result, t))
    }
    onSaved(result.data, !item)
  }

  return (
    <CashModal
      title={item ? t("Изменение инвентаря") : t("Добавление инвентаря")}
      onClose={onClose}
      size="inv"
      top={150}
      footerButtons="filled"
      dismissible={false}
      zIndex={item ? 120 : 170}
      footer={
        <>
          {error && <span className="mr-auto text-[12px] text-[#f44336]">{error}</span>}
          <PrimaryButton tone="green" busy={busy} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      {/* Linko: 650 × 701 at 150 px from the top, the fields 283 px wide, the photo 42 px to their right 40 px under the
          header, «Текущий Клиент» 10 px below the photo's top, 62 px from one select to the next. */}
      <div className="mt-[20px] grid min-h-[534px] content-start gap-5 md:grid-cols-[283px_250px] md:gap-x-[42px]">
        <div className="grid content-start gap-3">
          {item && (
            <div className="flex flex-col pt-[10px]">
              <span className="text-[10px] leading-3 text-[#999]">{t("Текущий Клиент")}:</span>
              <span className="min-h-4 text-[13px] font-semibold leading-4 text-[#333]">{item.client?.name ?? ""}</span>
            </div>
          )}
          <FormField label={t("Склад")} required showRequired error={errors.warehouse}>
            <SearchSelect value={draft.warehouse} options={named(withCurrent(options?.stocks, item?.warehouse))} invalid={Boolean(errors.warehouse)} onChange={(warehouse) => set({ warehouse })} />
          </FormField>
          <FormField label={t("Продукт")} required showRequired error={errors.productId}>
            <SearchSelect value={draft.productId} selectedLabel={item?.product.name} options={productOptions} loading={products.loading} invalid={Boolean(errors.productId)} onChange={(productId) => set({ productId })} />
          </FormField>
          {products.data && !products.data.length && <span className="-mt-2 text-[12px] text-[#9aa3b6]">{t("Нет продуктов, отмеченных как инвентарь")}</span>}
          <FormField label={t("Состояние")} required showRequired error={errors.condition}>
            <SearchSelect value={draft.condition} options={conditions.map((value) => ({ value, label: t(value) }))} invalid={Boolean(errors.condition)} onChange={(condition) => set({ condition })} />
          </FormField>
          <FormField label={t("Ответственный")} required showRequired error={errors.responsible}>
            <SearchSelect value={draft.responsible} options={named(withCurrent(options?.staff, item?.responsible))} invalid={Boolean(errors.responsible)} onChange={(responsible) => set({ responsible })} />
          </FormField>
          {!item && !inStock && (
            <FormField label={t("Клиент")} required showRequired error={errors.clientId}>
              <ClientPicker value={draft.clientId} label={draft.clientLabel} invalid={Boolean(errors.clientId)} onChange={(clientId, clientLabel) => set({ clientId, clientLabel })} />
            </FormField>
          )}
          <FormField label={t("Серийный номер")} required showRequired error={errors.serialNumber} className="!min-h-[40px]">
            <input value={draft.serialNumber} maxLength={200} onChange={(event) => set({ serialNumber: event.target.value })} className={inputClass} />
          </FormField>
          {/* Linko's text fields follow each other every 52 px. */}
          <FormField label={t("Инвентарный номер")} required showRequired error={errors.stockNumber} className="!min-h-[40px]">
            <input value={draft.stockNumber} maxLength={200} onChange={(event) => set({ stockNumber: event.target.value })} className={inputClass} />
          </FormField>
          <MaterialDate label={t("Дата")} required value={draft.date} onChange={(date) => set({ date })} error={errors.date} className="-mt-px" />
          <FormField label={`${t("Комментарий")}...`} className="mt-[3px] !min-h-[40px]">
            <input value={draft.comment} maxLength={2000} onChange={(event) => set({ comment: event.target.value })} className={inputClass} />
          </FormField>
        </div>
        <PhotoField value={photo} stored={item?.photoReady ? photoUrl(item) : null} missing={Boolean(item?.hasPhoto)} onChange={setPhoto} />
      </div>
    </CashModal>
  )
}

function InfoList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <ul className="rounded-md bg-[#f7f9fc] px-4 py-2">
      {rows.map(([label, value]) => (
        <li key={label} className="flex justify-between gap-3 border-b border-dashed border-[#e1e5eb] py-1.5 last:border-none">
          <span className="text-[#586174]">{label}:</span>
          <span className="text-right font-semibold">{value || "—"}</span>
        </li>
      ))}
    </ul>
  )
}

/** "Передача / Изъятие" (demo change_market): take from the current client and / or give to another. */
export function ChangeDialog({ item, options, onClose, onSaved }: { item: InventoryItemDetail; options: InventoryOptions | null; onClose: () => void; onSaved: (item: InventoryItemDetail) => void }) {
  const { t } = useLanguage()
  const today = todayIso()
  // Linko opens with both dates empty (an empty date is the day of saving).
  const [draft, setDraft] = useState({ takeDate: "", giveClientId: "", giveLabel: "", giveDate: "", condition: item.condition, comment: "" })
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }))
  const conditions = (options?.conditions ?? []).concat(options?.conditions.includes(item.condition) ? [] : [item.condition])

  const submit = async () => {
    if (!item.client && !draft.giveClientId) return setErrors({ giveClient: t("Выберите клиента") })
    setErrors({})
    setBusy(true)
    setError("")
    const result = await cashMutate<InventoryItemDetail>("POST", `/api/inventory-items/${item.id}/change`, {
      takeDate: item.client ? draft.takeDate || undefined : undefined,
      giveClientId: draft.giveClientId ? Number(draft.giveClientId) : null,
      giveDate: draft.giveClientId ? draft.giveDate || today : undefined,
      condition: draft.condition,
      comment: draft.comment,
    })
    setBusy(false)
    if (!result.ok) {
      if (result.field) setErrors({ [result.field]: t(result.error) })
      return setError(mutationError(result, t))
    }
    onSaved(result.data)
  }

  // Linko's «ПЕРЕДАЧА / ИЗЪЯТИЕ» (#/inventory-management/:id?openChangeDialog=true): «ИНФОРМАЦИЯ:» as plain label / value
  // lines over a rule, «ИЗЪЯТИЕ» while the item is at a client, «ПЕРЕДАЧА» (Передать клиенту, Дата передачи,
  // Состояние with its ×, Комментарий…) and one green «СОХРАНИТЬ». The margins put every line where Linko's is
  // (500 × 694 with a client, 576 without).
  const section = "text-[13px] font-semibold uppercase leading-4"
  return (
    <CashModal
      title={t("Передача / Изъятие")}
      onClose={onClose}
      size="md"
      zIndex={120}
      footerButtons="filled"
      dismissible={false}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton tone="green" busy={busy} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="pb-[39px] text-[13px] text-[#333]">
        <p className={`mt-[15px] ${section}`}>{t("Информация")}:</p>
        <ul className="mt-[10px] border-b border-[#e0e0e0]">
          {[[t("Тип"), item.product.name], [t("Серийный номер"), item.serialNumber], [t("Инвентарный номер"), item.stockNumber]].map(([label, value]) => (
            <li key={label} className="flex justify-between gap-3 leading-[25px]">
              <span>{label}</span>
              <span className="text-right font-semibold">{value}</span>
            </li>
          ))}
        </ul>
        {item.client && (
          <>
            <p className={`mt-[20px] ${section}`}>{t("Изъятие")}</p>
            <p className="mt-[11px] flex justify-between gap-3 leading-4">
              <span>{t("Изъять с клиента")}:</span>
              <strong className="font-semibold">{item.client.name}</strong>
            </p>
            <MaterialDate label={t("Дата изъятия")} value={draft.takeDate} onChange={(takeDate) => set({ takeDate })} className="mt-[8px]" />
          </>
        )}
        <p className={`${item.client ? "mt-[29px]" : "mt-[20px]"} ${section}`}>{t("Передача")}</p>
        <FormField label={t("Передать клиенту")} error={errors.giveClient} className="mt-[14px]">
          <ClientPicker value={draft.giveClientId} label={draft.giveLabel} invalid={Boolean(errors.giveClient)} onChange={(giveClientId, giveLabel) => set({ giveClientId, giveLabel })} />
        </FormField>
        <MaterialDate label={t("Дата передачи")} value={draft.giveDate} onChange={(giveDate) => set({ giveDate })} className="mt-[6px]" />
        <FormField label={t("Состояние")} error={errors.condition} className="mt-[32px]">
          <SearchSelect value={draft.condition} options={conditions.map((value) => ({ value, label: t(value) }))} onChange={(condition) => set({ condition })} />
        </FormField>
        <FormField label={`${t("Комментарий")}...`} className="mt-[12px] !min-h-[40px]">
          <input value={draft.comment} maxLength={2000} onChange={(event) => set({ comment: event.target.value })} className={inputClass} />
        </FormField>
      </div>
    </CashModal>
  )
}

/** Request confirmation (demo "Прикрипления оборудивании"): attach picks an item in a warehouse ("+" adds one). */
export function ConfirmRequestDialog({ request, options, onClose, onSaved }: { request: InventoryRequest; options: InventoryOptions | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [gear, setGear] = useState({ id: request.item ? String(request.item.id) : "", label: request.item ? `№${request.item.id} ${request.item.product}` : "" })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const attach = request.type === "attach"

  const submit = async () => {
    if (attach && !gear.id) return setInvalid(true)
    setBusy(true)
    setError("")
    const result = await cashMutate("POST", `/api/inventory-items/requests/${request.id}/confirm`, { itemId: gear.id ? Number(gear.id) : null })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved()
  }

  return (
    <>
      <CashModal
        title={`${t("Прикрипления оборудивании")}:`}
        onClose={onClose}
        size="md"
        zIndex={140}
        footer={
          <>
            {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
            <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
            <PrimaryButton busy={busy} onClick={() => void submit()}>
              {t("Сохранить")}
            </PrimaryButton>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[14px]">
          <InfoList rows={[[t("Магазин"), request.client?.name ?? ""], [t("Тип"), t(INVENTORY_REQUEST_TYPE_LABELS[request.type])], ...(request.product ? ([[t("Тип инвентаря"), request.product.name]] as Array<[string, string]>) : [])]} />
          {attach ? (
            <FormField label={t("Инвентарь")} required error={invalid ? t(REQUIRED) : undefined}>
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <GearPicker value={gear.id} label={gear.label} params={{ status: "in_stock" }} invalid={invalid} onChange={(id, item) => setGear({ id, label: item ? `№${item.id} ${item.product.name}` : "" })} />
                </span>
                <button type="button" onClick={() => setCreating(true)} title={t("Добавить инвентарь")} aria-label={t("Добавить инвентарь")} className="text-[#92ce95] hover:brightness-90">
                  <PlusCircle className="h-7 w-7" />
                </button>
              </span>
            </FormField>
          ) : (
            <ReadonlyField label={t("Инвентарь")} value={request.item ? `№${request.item.id} ${request.item.product} (${request.item.serialNumber || "—"})` : "—"} />
          )}
        </div>
      </CashModal>
      {creating && (
        <ItemFormDialog
          item={null}
          options={options}
          inStock
          onClose={() => setCreating(false)}
          onSaved={(item) => {
            setCreating(false)
            setInvalid(false)
            setGear({ id: String(item.id), label: `№${item.id} ${item.product.name}` })
          }}
        />
      )}
    </>
  )
}

/** "Новый запрос": attach (client + Тип инвентаря) or detach (an item of that client). */
export function RequestFormDialog({ options, onClose, onSaved }: { options: InventoryOptions | null; onClose: () => void; onSaved: (request: InventoryRequest) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({ type: "attach" as InventoryRequestType, clientId: "", clientLabel: "", productId: "", itemId: "", itemLabel: "", comment: "" })
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }))

  const submit = async () => {
    const missing: Errors = {}
    if (!draft.clientId) missing.client = t(REQUIRED)
    if (draft.type === "detach" && !draft.itemId) missing.gear = t(REQUIRED)
    setErrors(missing)
    if (Object.keys(missing).length) return
    setBusy(true)
    setError("")
    const result = await cashMutate<InventoryRequest>("POST", "/api/inventory-items/requests", {
      type: draft.type,
      clientId: Number(draft.clientId),
      productId: draft.type === "attach" && draft.productId ? Number(draft.productId) : null,
      itemId: draft.type === "detach" ? Number(draft.itemId) : null,
      comment: draft.comment,
    })
    setBusy(false)
    if (!result.ok) {
      if (result.field) setErrors({ [result.field]: t(result.error) })
      return setError(mutationError(result, t))
    }
    onSaved(result.data)
  }

  return (
    <CashModal
      title={t("Новый запрос")}
      onClose={onClose}
      size="md"
      zIndex={120}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
          <PrimaryButton busy={busy} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label={t("Тип")} required>
          <span className="flex gap-2">
            {INVENTORY_REQUEST_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => set({ type, itemId: "", itemLabel: "" })}
                className={`h-9 flex-1 rounded-md border px-3 text-[14px] ${draft.type === type ? (type === "attach" ? "border-[#71ce87] bg-[#f0faf2] font-semibold text-[#3f9d57]" : "border-[#e57373] bg-[#fdf1f1] font-semibold text-[#c94b4b]") : "border-[#dbe0e8] text-[#586174]"}`}
              >
                {t(INVENTORY_REQUEST_TYPE_LABELS[type])}
              </button>
            ))}
          </span>
        </FormField>
        <FormField label={t("Клиент")} required error={errors.client}>
          <ClientPicker value={draft.clientId} label={draft.clientLabel} invalid={Boolean(errors.client)} onChange={(clientId, clientLabel) => set({ clientId, clientLabel, itemId: "", itemLabel: "" })} />
        </FormField>
        {draft.type === "attach" ? (
          <FormField label={t("Тип инвентаря")} error={errors.product}>
            <SearchSelect value={draft.productId} options={(options?.products ?? []).map((product) => ({ value: String(product.id), label: product.name }))} onChange={(productId) => set({ productId })} />
          </FormField>
        ) : (
          <FormField label={t("Инвентарь")} required error={errors.gear}>
            {draft.clientId ? (
              <GearPicker key={draft.clientId} value={draft.itemId} label={draft.itemLabel} params={{ status: "in_market", client: draft.clientId }} invalid={Boolean(errors.gear)} onChange={(itemId, item) => set({ itemId, itemLabel: item ? `№${item.id} ${item.product.name}` : "" })} />
            ) : (
              <span className="text-[13px] text-[#9aa3b6]">{t("Сначала выберите клиента")}</span>
            )}
          </FormField>
        )}
        <FormField label={`${t("Комментарий")}...`} className="!min-h-[40px]">
          <textarea value={draft.comment} maxLength={2000} rows={2} onChange={(event) => set({ comment: event.target.value })} className={`${inputClass} h-auto py-2`} />
        </FormField>
      </div>
    </CashModal>
  )
}
