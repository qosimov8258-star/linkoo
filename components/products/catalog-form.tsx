"use client"

import { useState } from "react"

import {
  BarcodesEditor,
  BoxSizesEditor,
  PricesEditor,
  emptyPrice,
  type BoxSizeDraft,
  type PriceDraft,
} from "@/components/products/catalog-form-parts"
import { CheckField, CreateLink, FormColumn, FormShell, InfoHint, SaveButton, SelectField, TextField, Toggle } from "@/components/products/catalog-form-ui"
import { KIND_TEXT, catalogMutate, errorText } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, leadingNumber, type CatalogDetail, type CatalogKind, type CatalogOptions } from "@/lib/products-types"

// Demo ProductCreateDialog (module 1624; raw = the same with isRaw): the full-screen
// "Добавить продукт" / "Изменить продукт" form (material-ui fields, three 500px columns, sticky
// "Сохранить изменение"). Left: Наименование*, Мера*, "Указать группу" (Группа, Кол-во в
// группе), "ДОП. параметры", Тип продукта → Подкатегория, Поставщик, Бренд, Организация,
// Порядковый номер, Минимальный остаток, Цвет, Описание. Middle: Полное наименование,
// Штрих-коды, Артикул, Код для интеграции, Масса - кг, Вес нетто, Объем, Икпу, Код ед.изм.
// в фактуре, НДС and the toggles (ММЛ, Perfect Store, инвентарь, только в группе, бот, срок
// годности / серии, маркировка, ДОП. параметры sizes, min / max sale price). Right: "Можно
// продавать", "Продажная цена" per price list, "Можно продать за кол-во балов".

type Draft = {
  name: string
  fullName: string
  barcodes: string[]
  article: string
  code: string
  type: string
  subcategory: string
  organization: string
  unit: string
  showGroup: boolean
  showAdditionals: boolean
  boxUnit: string
  boxAmount: string
  orderNumber: string
  supplier: string
  brand: string
  color: string
  description: string
  minStock: string
  weight: string
  netWeight: string
  volume: string
  ikpu: string
  invoiceUnitCode: string
  vatPercent: string
  canSell: boolean
  isMml: boolean
  perfectStore: boolean
  isInventory: boolean
  sellOnlyBox: boolean
  showInBot: boolean
  trackExpiry: boolean
  trackSeries: boolean
  expirationDays: string
  notifyExpireDays: string
  markedProduct: boolean
  limitPrice: boolean
  saleMinPrice: string
  saleMaxPrice: string
  salePriceCurrency: string
  salePoints: string
  boxSizes: BoxSizeDraft[]
  prices: PriceDraft[]
}

const str = (value: number | null) => (value === null || value === 0 ? "" : String(value).replace(".", ","))
const parseNum = (value: string) => leadingNumber(value)
/** "12%" → "12" (the reference edits the VAT as a plain number; "Без НДС" is empty). */
const vatNumber = (vat: string) => vat.match(/\d+(?:[.,]\d+)?/)?.[0] ?? ""
/** A stored price keeps "0" so saving the form does not drop the entry. */
const priceStr = (value: number) => String(value).replace(".", ",")

function draftOf(item: CatalogDetail | null, options: CatalogOptions | null): Draft {
  const currency = options?.baseCurrency ?? "SUM"
  if (!item) {
    return {
      name: "",
      fullName: "",
      barcodes: [""],
      article: "",
      code: "",
      type: "",
      subcategory: "",
      organization: "",
      unit: "",
      showGroup: false,
      showAdditionals: false,
      boxUnit: "",
      boxAmount: "",
      orderNumber: "",
      supplier: "",
      brand: "",
      color: "",
      description: "",
      minStock: "",
      weight: "",
      netWeight: "",
      volume: "",
      ikpu: "",
      invoiceUnitCode: "",
      vatPercent: "",
      canSell: true,
      isMml: false,
      perfectStore: false,
      isInventory: false,
      sellOnlyBox: false,
      showInBot: true,
      trackExpiry: false,
      trackSeries: false,
      expirationDays: "",
      notifyExpireDays: "",
      markedProduct: false,
      limitPrice: false,
      saleMinPrice: "",
      saleMaxPrice: "",
      salePriceCurrency: currency,
      salePoints: "",
      boxSizes: [],
      prices: [emptyPrice("", "")],
    }
  }
  return {
    ...item,
    barcodes: item.barcodes.length ? item.barcodes : [""],
    vatPercent: vatNumber(item.vat),
    showGroup: Boolean(item.boxUnit || item.boxAmount),
    showAdditionals: item.boxSizes.length > 0,
    boxAmount: str(item.boxAmount),
    minStock: str(item.minStock),
    weight: str(item.weight),
    netWeight: str(item.netWeight),
    volume: str(item.volume),
    expirationDays: item.expirationDays === null ? "" : String(item.expirationDays),
    notifyExpireDays: item.notifyExpireDays === null ? "" : String(item.notifyExpireDays),
    saleMinPrice: str(item.saleMinPrice),
    saleMaxPrice: str(item.saleMaxPrice),
    salePriceCurrency: item.salePriceCurrency || currency,
    salePoints: str(item.salePoints),
    boxSizes: item.boxSizes.map((size) => ({ unit: size.unit, height: str(size.height), width: str(size.width), length: str(size.length) })),
    prices: item.priceLists.length
      ? item.priceLists.map((entry) => ({
          name: entry.name,
          cash: priceStr(entry.cash),
          currency: entry.currency || currency,
          nonCash: priceStr(entry.nonCash),
          nonCashCurrency: entry.nonCashCurrency || entry.currency || currency,
          minMax: entry.min > 0 || entry.max > 0,
          min: str(entry.min),
          max: str(entry.max),
        }))
      : [emptyPrice("", "")],
  }
}

function bodyOf(draft: Draft, baseCurrency: string) {
  const days = (value: string) => (value.trim() ? Math.trunc(parseNum(value)) : null)
  return {
    name: draft.name.trim(),
    fullName: draft.fullName,
    barcodes: draft.barcodes.map((code) => code.trim()).filter(Boolean),
    article: draft.article,
    code: draft.code,
    type: draft.type,
    subcategory: draft.type ? draft.subcategory : "",
    organization: draft.organization,
    unit: draft.unit.trim(),
    boxUnit: draft.showGroup ? draft.boxUnit : "",
    boxAmount: draft.showGroup ? parseNum(draft.boxAmount) : 0,
    orderNumber: draft.orderNumber,
    supplier: draft.supplier,
    brand: draft.brand,
    color: draft.color,
    description: draft.description,
    minStock: parseNum(draft.minStock),
    weight: parseNum(draft.weight),
    netWeight: parseNum(draft.netWeight),
    volume: parseNum(draft.volume),
    ikpu: draft.ikpu,
    invoiceUnitCode: draft.invoiceUnitCode,
    vat: draft.vatPercent.trim() ? `${draft.vatPercent.trim()}%` : "Без НДС",
    canSell: draft.canSell,
    isMml: draft.isMml,
    perfectStore: draft.perfectStore,
    isInventory: draft.isInventory,
    sellOnlyBox: draft.sellOnlyBox,
    showInBot: draft.showInBot,
    trackExpiry: draft.trackExpiry,
    trackSeries: draft.trackExpiry && draft.trackSeries,
    expirationDays: draft.trackExpiry ? days(draft.expirationDays) : null,
    notifyExpireDays: draft.trackExpiry ? days(draft.notifyExpireDays) : null,
    markedProduct: draft.markedProduct,
    limitPrice: draft.limitPrice,
    saleMinPrice: draft.limitPrice ? parseNum(draft.saleMinPrice) : 0,
    saleMaxPrice: draft.limitPrice ? parseNum(draft.saleMaxPrice) : 0,
    salePriceCurrency: draft.limitPrice ? draft.salePriceCurrency : "",
    salePoints: parseNum(draft.salePoints),
    boxSizes: draft.boxSizes
      .filter((size) => size.unit.trim() || size.height || size.width || size.length)
      .map((size) => ({ unit: size.unit.trim(), height: parseNum(size.height), width: parseNum(size.width), length: parseNum(size.length) })),
    // Demo: an empty price row is not sent (a stored 0 is kept).
    priceLists: draft.prices
      .filter((entry) => entry.name && (entry.cash.trim() || entry.nonCash.trim()))
      .map((entry) => ({
        name: entry.name,
        cash: parseNum(entry.cash),
        nonCash: entry.nonCash.trim() ? parseNum(entry.nonCash) : parseNum(entry.cash),
        currency: entry.currency || baseCurrency,
        nonCashCurrency: entry.nonCashCurrency || entry.currency || baseCurrency,
        min: entry.minMax ? parseNum(entry.min) : 0,
        max: entry.minMax ? parseNum(entry.max) : 0,
      })),
  }
}

const MERA_HINT =
  "Вы можете указать группировки. Например, если вы продаете напиток Кола 1,5 л, укажите ед.ницу измерения штука. А в группе добавьте блок и там укажите 6 штук.(Это означает, что в одном блоке будет находиться 6 штук товара). Продажную цену установите только для 1 штуке"

export function CatalogFormDialog({
  kind,
  item,
  options,
  onClose,
  onSaved,
}: {
  kind: CatalogKind
  item: CatalogDetail | null
  options: CatalogOptions | null
  onClose: () => void
  onSaved: (id: number, created: boolean) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<Draft>(() => draftOf(item, options))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const children = options?.types.find((type) => type.name === draft.type)?.children ?? []
  const units = options?.units ?? []
  const marking = (key: "ikpu") => (draft.markedProduct && !draft[key].trim() ? "Это поле обязательно для работы маркировки" : undefined)
  const err = (key: string) => {
    const message = errors[key] || (key === "ikpu" ? marking("ikpu") : undefined)
    return message ? t(message) : undefined
  }

  const save = async () => {
    const local: Record<string, string> = {}
    if (!draft.name.trim()) local.name = "Это поле обязательно к заполнению"
    if (!draft.unit.trim()) local.unit = "Это поле обязательно к заполнению"
    if (!draft.type.trim()) local.type = "Это поле обязательно к заполнению"
    const body = bodyOf(draft, options?.baseCurrency ?? "SUM")
    if (draft.markedProduct) {
      if (!body.barcodes.length) local.barcodes = "Это поле обязательно для работы маркировки"
      if (!draft.ikpu.trim()) local.ikpu = "Это поле обязательно для работы маркировки"
    }
    setErrors(local)
    if (Object.keys(local).length) {
      document.querySelector("[data-form-scroll]")?.scrollTo({ top: 0 })
      return
    }
    setBusy(true)
    setError("")
    const result = item ? await catalogMutate<{ id: number }>("PUT", `${CATALOG_API[kind]}/${item.id}`, body) : await catalogMutate<{ id: number }>("POST", CATALOG_API[kind], body)
    setBusy(false)
    if (!result.ok) {
      setErrors(result.fields ?? {})
      setError(errorText(result, t))
      return
    }
    onSaved(item ? item.id : result.data.id, !item)
  }

  const text = (key: "name" | "fullName" | "article" | "code" | "orderNumber" | "ikpu" | "invoiceUnitCode", label: string, extra?: { required?: boolean; type?: "text" | "number"; className?: string }) => (
    <TextField label={t(label)} value={draft[key]} onChange={(value) => set({ [key]: value })} error={err(key)} required={extra?.required} type={extra?.type} className={extra?.className} errorShift={key !== "name" && key !== "fullName"} />
  )
  const amount = (key: "boxAmount" | "minStock" | "weight" | "netWeight" | "volume" | "expirationDays" | "notifyExpireDays" | "saleMinPrice" | "saleMaxPrice" | "salePoints", label: string, className?: string) => (
    <TextField label={t(label)} numeric value={draft[key]} onChange={(value) => set({ [key]: value })} error={err(key)} className={className} />
  )
  const select = (key: "unit" | "boxUnit" | "type" | "subcategory" | "supplier" | "brand" | "organization" | "color", label: string, list: string[], className = "", isRequired = false) => (
    <SelectField
      label={t(label)}
      value={draft[key]}
      options={list}
      onChange={(value) => set({ [key]: value, ...(key === "type" ? { subcategory: "" } : {}) })}
      error={err(key)}
      required={isRequired}
      loading={!options}
      className={className}
    />
  )
  const create = (href: string, label: string) => <CreateLink href={`${href}?openCreateDialog=true`} label={t(label)} />

  return (
    <>
      <FormShell
        title={t(item ? KIND_TEXT[kind].editTitle : KIND_TEXT[kind].addTitle)}
        onClose={onClose}
        footer={
          <>
            {error && <span className="mr-4 text-[13px] text-[#f44336]">{error}</span>}
            <SaveButton busy={busy} onClick={() => void save()}>
              {t("Сохранить изменение")}
            </SaveButton>
          </>
        }
      >
        <FormColumn>
          <div className="pt-[11px]">{text("name", "Наименование", { required: true })}</div>
          <div className="mt-8 flex items-start">
            {select("unit", "Мера", units, "w-[368px]", true)}
            <span className="ml-[5px] mt-[-1px]">{create("/analytics/units-of-measure", "Добавить меру")}</span>
            <span className="ml-[18px] mt-[-1px]">
              <InfoHint text={MERA_HINT} />
            </span>
          </div>
          <div className="mt-[18px]">
            <CheckField label={t("Указать группу")} checked={draft.showGroup} onChange={(showGroup) => set({ showGroup })} />
          </div>
          <div className="mt-[10px]">
            <CheckField label={t("ДОП. параметры")} checked={draft.showAdditionals} onChange={(showAdditionals) => set({ showAdditionals })} />
          </div>
          {draft.showGroup && (
            <>
              <div className="mt-7">{select("boxUnit", "Группа", units)}</div>
              <div className="-mt-[1px]">{amount("boxAmount", "Кол-во в группе")}</div>
            </>
          )}
          <div className={`flex items-start ${draft.showGroup ? "mt-[31px]" : "mt-8"}`}>
            {select(
              "type",
              "Тип продукта",
              (options?.types ?? []).map((type) => type.name),
              "w-[410px]",
            )}
            <span className="ml-[5px] mt-[-1px]">{create("/analytics/product-types", "Добавить тип продукта")}</span>
          </div>
          {draft.type && children.length > 0 && <div className="mt-[31px]">{select("subcategory", "Подкатегория", children)}</div>}
          <div className="mt-[31px] flex items-start">
            {select("supplier", "Поставщик", options?.suppliers ?? [], "w-[203px]")}
            {select("brand", "Бренд", options?.brands ?? [], "ml-[5px] w-[202px]")}
            <span className="ml-[5px] mt-[-1px]">{create("/analytics/brands", "Добавить бренд")}</span>
          </div>
          <div className="mt-[31px]">{select("organization", "Организация", options?.organizations ?? [])}</div>
          <div className="flex items-start">
            {text("orderNumber", "Порядковый номер", { className: "w-[410px]" })}
            <span className="ml-[5px] mt-6">
              <InfoHint text="По этому порядку агентам будет высвечиваться продукты для продажи заказа установить порядок от 1 - 9999" />
            </span>
          </div>
          <div className="flex items-start">
            {amount("minStock", "Минимальный остаток", "w-[410px]")}
            <span className="ml-[5px] mt-6">
              <InfoHint text="Сюда можете написать минимальный остаток если ваши складах уменьшильца кол-во товара от минимального остатка система автоматический будет оптравлять уведомления" />
            </span>
          </div>
          <div className="mt-[31px]">{select("color", "Цвет", options?.colors ?? [])}</div>
          <div className="mt-[17px] pb-5">
            <TextField label={t("Описание")} multiline value={draft.description} onChange={(description) => set({ description })} />
          </div>
        </FormColumn>

        <FormColumn className="pb-[395px]">
          <div className="pt-[11px]">{text("fullName", "Полное наименование")}</div>
          <BarcodesEditor
            value={draft.barcodes}
            onChange={(barcodes) => set({ barcodes })}
            error={errors.barcodes || (draft.markedProduct && !draft.barcodes.some((code) => code.trim()) ? "Это поле обязательно для работы маркировки" : undefined)}
          />
          {text("article", "Артикул")}
          {text("code", "Код для интеграции")}
          {amount("weight", `${t("Масса")} - ${t("кг")}`)}
          {amount("netWeight", "Вес нетто")}
          {amount("volume", "Объем")}
          {text("ikpu", "Икпу")}
          {text("invoiceUnitCode", "Код ед.изм. в фактуре", { type: "number" })}
          <TextField label={t("НДС")} type="number" value={draft.vatPercent} onChange={(vatPercent) => set({ vatPercent })} />
          <Toggle
            className="mt-[9px]"
            checked={draft.isMml}
            onChange={(isMml) => set({ isMml })}
            title={t("ММЛ продукт")}
            hint="Если включите этот идентификатор агентам при оформлении заказа система будет рекомендовать этот продукт агентам"
          />
          {kind === "product" && <Toggle className="mt-[15px]" checked={draft.perfectStore} onChange={(perfectStore) => set({ perfectStore })} title={t("Perfect Store продукт")} />}
          <Toggle
            className="mt-[15px]"
            checked={draft.isInventory}
            onChange={(isInventory) => set({ isInventory })}
            title={t("Показывать этот товар в качестве тип инвентаря")}
            hint="Если включите этот параметр при создании инвентаря этот продукт будет высвечиваться в качестве типа инвентаря"
          />
          <Toggle
            className="mt-[15px]"
            checked={draft.sellOnlyBox}
            onChange={(sellOnlyBox) => set({ sellOnlyBox })}
            title={t("Продать только в группе")}
            hint="Если вы хотите, чтобы ваши агенты продавали только в блоках, вы можете включить этот параметр."
          />
          <Toggle className="mt-[15px]" checked={draft.showInBot} onChange={(showInBot) => set({ showInBot })} title={t("Показывать в боте")} subTitle={t("Показывать в телеграм боте")} />
          <Toggle className="mt-[15px]" checked={draft.trackExpiry} onChange={(trackExpiry) => set({ trackExpiry })} title={t("Учитывать срок годности")} />
          {draft.trackExpiry && <Toggle className="mt-[15px]" checked={draft.trackSeries} onChange={(trackSeries) => set({ trackSeries })} title={t("Учитывать серии")} />}
          <Toggle className="mt-[15px]" checked={draft.markedProduct} onChange={(markedProduct) => set({ markedProduct })} title={t("Маркировочный товар")} />
          {draft.showAdditionals && <BoxSizesEditor value={draft.boxSizes} onChange={(boxSizes) => set({ boxSizes })} units={units} />}
          <Toggle
            className={draft.showAdditionals ? "mt-[70px]" : "mt-[15px]"}
            checked={draft.limitPrice}
            onChange={(limitPrice) => set({ limitPrice })}
            title={t("Установить минимальную и максимальную цену для продажи")}
          />
          {draft.limitPrice && (
            <>
              <div className="mt-[5px]">{amount("saleMinPrice", "Минимальная цена продажи")}</div>
              {amount("saleMaxPrice", "Максимальная цена продажи")}
              <SelectField
                label={t("Валюта")}
                value={draft.salePriceCurrency}
                options={[...new Set([draft.salePriceCurrency, ...(options?.currencies ?? [])].filter(Boolean))]}
                onChange={(salePriceCurrency) => set({ salePriceCurrency })}
                className="mt-8"
              />
            </>
          )}
        </FormColumn>

        <FormColumn last>
          <Toggle
            className="mt-10"
            checked={draft.canSell}
            onChange={(canSell) => set({ canSell })}
            title={t("Можно продавать")}
            subTitle={t("Агенты могут продать этот товар")}
          />
          <PricesEditor
            value={draft.prices}
            onChange={(prices) => set({ prices })}
            priceLists={options?.priceLists ?? []}
            currencies={options?.currencies ?? ["SUM"]}
            error={errors.priceLists}
          />
          <div className="flex items-start">
            {amount("salePoints", "Можно продать за кол-во балов", "w-[411px]")}
            <span className="ml-2 mt-[23px]">
              <InfoHint text="Здесь укажите кол-во балов который можно купить этот товар. Например, если ви устанавливаете 10 балов, это означает, что клиент может купить 1 единицу этого товара за 10 балов. Баловые акции могут создать через маркетинговые акции." />
            </span>
          </div>
          <div className="pb-5" />
        </FormColumn>
      </FormShell>
    </>
  )
}
