"use client"

import { useState, type ReactNode } from "react"

import { CashModal, FormField, PrimaryButton, inputClass } from "@/components/analytics/cash-management-shared"
import {
  BarcodesEditor,
  BoxSizesEditor,
  ComboInput,
  LabelWithHint,
  NumberInput,
  PricesEditor,
  emptyPrice,
  type BoxSizeDraft,
  type PriceDraft,
} from "@/components/products/catalog-form-parts"
import { KIND_TEXT, Switch, catalogMutate, errorText } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, VAT_OPTIONS, leadingNumber, type CatalogDetail, type CatalogKind, type CatalogOptions } from "@/lib/products-types"

// Demo ProductCreateDialog (module 1624; raw = the same with isRaw): "Добавить продукт" /
// "Изменить продукт". Left: Наименование*, Мера*, "Указать группу" (Группа, Кол-во в
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
  vat: string
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
      vat: VAT_OPTIONS[0],
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
      prices: [emptyPrice(options?.priceLists[0]?.name ?? "", options?.priceLists[0]?.currency || currency)],
    }
  }
  return {
    ...item,
    barcodes: item.barcodes.length ? item.barcodes : [""],
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
      : [emptyPrice(options?.priceLists[0]?.name ?? "", options?.priceLists[0]?.currency || currency)],
  }
}

function bodyOf(draft: Draft) {
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
    vat: draft.vat,
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
        currency: entry.currency,
        nonCashCurrency: entry.nonCashCurrency,
        min: entry.minMax ? parseNum(entry.min) : 0,
        max: entry.minMax ? parseNum(entry.max) : 0,
      })),
  }
}

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

  const save = async () => {
    const local: Record<string, string> = {}
    if (!draft.name.trim()) local.name = "Обязательное поле"
    if (!draft.unit.trim()) local.unit = "Обязательное поле"
    const body = bodyOf(draft)
    if (draft.markedProduct) {
      if (!body.barcodes.length) local.barcodes = "Это поле обязательно для работы маркировки"
      if (!draft.ikpu.trim()) local.ikpu = "Это поле обязательно для работы маркировки"
    }
    setErrors(local)
    if (Object.keys(local).length) return
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

  const field = (label: ReactNode, node: ReactNode, key?: string, required?: boolean) => (
    <FormField label={label} required={required} error={key && errors[key] ? t(errors[key]) : undefined}>
      {node}
    </FormField>
  )
  const textInput = (key: "name" | "fullName" | "article" | "code" | "orderNumber" | "ikpu" | "invoiceUnitCode") => (
    <input value={draft[key]} onChange={(event) => set({ [key]: event.target.value })} className={`${inputClass} ${errors[key] ? "border-[#e57373]" : ""}`} />
  )
  const numberInput = (
    key: "boxAmount" | "minStock" | "weight" | "netWeight" | "volume" | "expirationDays" | "notifyExpireDays" | "saleMinPrice" | "saleMaxPrice" | "salePoints",
  ) => <NumberInput value={draft[key]} onChange={(value) => set({ [key]: value })} invalid={Boolean(errors[key])} />
  const combo = (key: "unit" | "boxUnit" | "type" | "subcategory" | "supplier" | "brand" | "organization" | "color", list: string[]) => (
    <ComboInput
      id={`catalog-${key}`}
      value={draft[key]}
      onChange={(value) => set({ [key]: value, ...(key === "type" ? { subcategory: "" } : {}) })}
      options={list}
      invalid={Boolean(errors[key])}
    />
  )

  return (
    <CashModal
      title={t(item ? KIND_TEXT[kind].editTitle : KIND_TEXT[kind].addTitle)}
      onClose={onClose}
      size="full"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton tone="blue" busy={busy} onClick={() => void save()}>
            {t(item ? "Сохранить изменение" : "Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3">
          {field(t("Наименование"), textInput("name"), "name", true)}
          {field(
            <LabelWithHint
              label={t("Мера")}
              hint="Вы можете указать группировки. Например, если вы продаете напиток Кола 1,5 л, укажите ед.ницу измерения штука. А в группе добавьте блок и там укажите 6 штук.(Это означает, что в одном блоке будет находиться 6 штук товара). Продажную цену установите только для 1 штуке"
            />,
            combo("unit", units),
            "unit",
            true,
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.showGroup} onChange={(event) => set({ showGroup: event.target.checked })} className="h-4 w-4 accent-[rgb(79,113,220)]" />
              {t("Указать группу")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.showAdditionals}
                onChange={(event) => set({ showAdditionals: event.target.checked })}
                className="h-4 w-4 accent-[rgb(79,113,220)]"
              />
              {t("ДОП. параметры")}
            </label>
          </div>
          {draft.showGroup && (
            <div className="grid grid-cols-2 gap-2">
              {field(t("Группа"), combo("boxUnit", units))}
              {field(t("Кол-во в группе"), numberInput("boxAmount"))}
            </div>
          )}
          {field(
            t("Тип продукта"),
            combo(
              "type",
              (options?.types ?? []).map((type) => type.name),
            ),
          )}
          {draft.type && field(t("Подкатегория"), combo("subcategory", children))}
          <div className="grid grid-cols-2 gap-2">
            {field(t("Поставщик"), combo("supplier", options?.suppliers ?? []))}
            {field(t("Бренд"), combo("brand", options?.brands ?? []))}
          </div>
          {field(t("Организация"), combo("organization", options?.organizations ?? []))}
          {field(
            <LabelWithHint label={t("Порядковый номер")} hint="По этому порядку агентам будет высвечиваться продукты для продажи заказа установить порядок от 1 - 9999" />,
            textInput("orderNumber"),
          )}
          {field(
            <LabelWithHint
              label={t("Минимальный остаток")}
              hint="Сюда можете написать минимальный остаток если ваши складах уменьшильца кол-во товара от минимального остатка система автоматический будет оптравлять уведомления"
            />,
            numberInput("minStock"),
          )}
          {field(t("Цвет"), combo("color", options?.colors ?? []))}
          {field(
            t("Описание"),
            <textarea value={draft.description} onChange={(event) => set({ description: event.target.value })} rows={3} className={`${inputClass} h-auto py-2`} />,
          )}
        </div>

        <div className="flex flex-col gap-3">
          {field(t("Полное наименование"), textInput("fullName"))}
          <BarcodesEditor value={draft.barcodes} onChange={(barcodes) => set({ barcodes })} error={errors.barcodes} />
          {field(t("Артикул"), textInput("article"))}
          {field(t("Код для интеграции"), textInput("code"))}
          <div className="grid grid-cols-3 gap-2">
            {field(`${t("Масса")} - ${t("кг")}`, numberInput("weight"))}
            {field(t("Вес нетто"), numberInput("netWeight"))}
            {field(t("Объем"), numberInput("volume"))}
          </div>
          {field(t("Икпу"), textInput("ikpu"), "ikpu")}
          <div className="grid grid-cols-2 gap-2">
            {field(t("Код ед.изм. в фактуре"), textInput("invoiceUnitCode"))}
            {field(
              t("НДС"),
              <select value={draft.vat} onChange={(event) => set({ vat: event.target.value })} className={inputClass}>
                {[...new Set([draft.vat, ...VAT_OPTIONS])].map((vat) => (
                  <option key={vat} value={vat}>
                    {t(vat)}
                  </option>
                ))}
              </select>,
            )}
          </div>
          <div className="flex flex-col gap-1 border-t border-[#eef1f5] pt-2">
            <Switch
              checked={draft.isMml}
              onChange={(isMml) => set({ isMml })}
              title={
                <LabelWithHint label={t("ММЛ продукт")} hint="Если включите этот идентификатор агентам при оформлении заказа система будет рекомендовать этот продукт агентам" />
              }
            />
            {kind === "product" && <Switch checked={draft.perfectStore} onChange={(perfectStore) => set({ perfectStore })} title={t("Perfect Store продукт")} />}
            <Switch
              checked={draft.isInventory}
              onChange={(isInventory) => set({ isInventory })}
              title={
                <LabelWithHint
                  label={t("Показывать этот товар в качестве тип инвентаря")}
                  hint="Если включите этот параметр при создании инвентаря этот продукт будет высвечиваться в качестве типа инвентаря"
                />
              }
            />
            <Switch
              checked={draft.sellOnlyBox}
              onChange={(sellOnlyBox) => set({ sellOnlyBox })}
              title={<LabelWithHint label={t("Продать только в группе")} hint="Если вы хотите, чтобы ваши агенты продавали только в блоках, вы можете включить этот параметр." />}
            />
            <Switch checked={draft.showInBot} onChange={(showInBot) => set({ showInBot })} title={t("Показывать в боте")} subTitle={t("Показывать в телеграм боте")} />
            <Switch checked={draft.trackExpiry} onChange={(trackExpiry) => set({ trackExpiry })} title={t("Учитывать срок годности")} />
            {draft.trackExpiry && (
              <div className="flex flex-col gap-2 pl-3">
                <Switch checked={draft.trackSeries} onChange={(trackSeries) => set({ trackSeries })} title={t("Учитывать серии")} />
                {field(t("Дата окончания срока годности (дней)"), numberInput("expirationDays"))}
                {field(t("Предупредить, если больше дней"), numberInput("notifyExpireDays"))}
              </div>
            )}
            <Switch checked={draft.markedProduct} onChange={(markedProduct) => set({ markedProduct })} title={t("Маркировочный товар")} />
          </div>
          {draft.showAdditionals && <BoxSizesEditor value={draft.boxSizes} onChange={(boxSizes) => set({ boxSizes })} units={units} />}
          <Switch checked={draft.limitPrice} onChange={(limitPrice) => set({ limitPrice })} title={t("Установить минимальную и максимальную цену для продажи")} />
          {draft.limitPrice && (
            <div className="grid grid-cols-[1fr_1fr_100px] gap-2">
              {field(t("Минимальная цена продажи"), numberInput("saleMinPrice"))}
              {field(t("Максимальная цена продажи"), numberInput("saleMaxPrice"), "saleMaxPrice")}
              {field(
                t("Валюта"),
                <select value={draft.salePriceCurrency} onChange={(event) => set({ salePriceCurrency: event.target.value })} className={inputClass}>
                  {[...new Set([draft.salePriceCurrency, ...(options?.currencies ?? [])].filter(Boolean))].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>,
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-md bg-[#f2f5f8] px-3 py-2">
            <Switch checked={draft.canSell} onChange={(canSell) => set({ canSell })} title={t("Можно продавать")} subTitle={t("Агенты могут продать этот товар")} />
          </div>
          <p className="font-semibold text-[#17233b]">{t("Продажная цена")}</p>
          <PricesEditor
            value={draft.prices}
            onChange={(prices) => set({ prices })}
            priceLists={options?.priceLists ?? []}
            currencies={options?.currencies ?? ["SUM"]}
            savedNames={item?.priceLists.map((entry) => entry.name) ?? []}
            error={errors.priceLists}
          />
          {field(
            <LabelWithHint
              label={t("Можно продать за кол-во балов")}
              hint="Здесь укажите кол-во балов который можно купить этот товар. Например, если ви устанавливаете 10 балов, это означает, что клиент может купить 1 единицу этого товара за 10 балов. Баловые акции могут создать через маркетинговые акции."
            />,
            numberInput("salePoints"),
          )}
        </div>
      </div>
    </CashModal>
  )
}
