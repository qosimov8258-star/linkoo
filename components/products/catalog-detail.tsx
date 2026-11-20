"use client"

import { useState, type ReactNode } from "react"
import { Plus } from "lucide-react"

import { ConfirmDialog, ErrorBlock, LoadingBlock } from "@/components/analytics/cash-management-shared"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { AddPhotoDialog, SlideshowDialog } from "@/components/products/catalog-photos"
import { RI } from "@/components/ref/list-kit"
import { catalogMutate, errorText, formatNumber, imageUrl } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, type CatalogAttribute, type CatalogDetail, type CatalogKind } from "@/lib/products-types"

// Demo ProductDetail (module 2222), opened in place of the clicked row: the name
// ("(Инвентарь)", "ММЛ"), Изменить / Удалить or Восстановить; photos ("Фото отсутствует",
// "добавить фото", up to 5 thumbnails, slideshow); the flags; "Товар:" fields; prices per
// price list (Прайс лист | Нал | Безнал | Мин | Макс, "Обнулить"); "Характеристика:" Балл;
// agent limits (Агенты | Лимит | Реализовано, delete); "Дополнительные параметры" sizes.

const CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const CLOSE_X = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** "Label: value" — the label shrinks (wraps) when the value is long, like the reference's rows. */
function Row({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <li className={`flex gap-[5px] text-[13px] leading-[25px] text-[#333] ${className}`}>
      <span className="shrink">{label}:</span>
      <span className="min-w-0 break-words font-semibold">{children}</span>
    </li>
  )
}

function Flag({ label, value }: { label: string; value: boolean }) {
  return (
    <li className="flex items-center text-[13px] leading-[25px] text-[#333]">
      {/* Linko's "label: " sits in a flex row, so its trailing space collapses: the icon follows the colon. */}
      <span>{label}:</span>
      <svg viewBox="0 0 24 24" className={`h-6 w-6 shrink-0 ${value ? "fill-[#8acb8d]" : "fill-[#e57373]"}`}>
        <path d={value ? CHECK_CIRCLE : CLOSE_X} />
      </svg>
    </li>
  )
}

export function CatalogDetailPanel({
  kind,
  id,
  canEdit,
  version,
  onClose,
  onEdit,
  onDelete,
  onRestore,
  onChanged,
  notify,
  attributes,
}: {
  kind: CatalogKind
  id: number
  canEdit: boolean
  version: number
  onClose: () => void
  onEdit: (item: CatalogDetail) => void
  onDelete: (item: CatalogDetail, hard: boolean) => void
  onRestore: (item: CatalogDetail) => void
  onChanged: () => void
  notify: (text: string, error?: boolean) => void
  /** Справочник → Атрибуты (names and order of «Характеристика»). */
  attributes?: CatalogAttribute[]
}) {
  const { t } = useLanguage()
  const detail = useCashJson<CatalogDetail>(`${CATALOG_API[kind]}/${id}?v=${version}`)
  const [addPhoto, setAddPhoto] = useState(false)
  const [slide, setSlide] = useState<number | null>(null)
  const [pending, setPending] = useState<{ kind: "price"; name: string } | { kind: "limit"; id: number; agent: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const item = detail.data

  if (detail.loading && !item) return <LoadingBlock className="py-10" />
  if (detail.error && !item) return <ErrorBlock error={t(detail.error)} onRetry={detail.reload} />
  if (!item) return null

  const none = t("Не указано")
  const reload = () => {
    detail.reload()
    onChanged()
  }
  const confirmPending = async () => {
    if (!pending) return
    setBusy(true)
    const result =
      pending.kind === "price"
        ? await catalogMutate("PUT", `${CATALOG_API[kind]}/${item.id}`, { priceLists: item.priceLists.filter((entry) => entry.name !== pending.name) })
        : await catalogMutate("DELETE", `${CATALOG_API[kind]}/${item.id}/limits/${pending.id}`)
    setBusy(false)
    if (!result.ok) return notify(errorText(result, t), true)
    setPending(null)
    notify(t("Удалено"))
    reload()
  }
  const flags: Array<[string, boolean]> = [
    ["Можно продавать", item.canSell],
    ["Только ММЛ продукты", item.isMml],
    ["Инвентарь", item.isInventory],
    // Linko's raw material card prints the line too (its form has no such switch, so it reads ✗).
    ["Perfect store", item.perfectStore],
    ["Продать только в группе", item.sellOnlyBox],
    ["Учитывать срок годности", item.trackExpiry],
    ["Можно дать ручную скидку", item.manualDiscount],
    ["Скрыть из списка заказов для агента", item.hideFromAgent],
    ["Учитывать серии", item.trackSeries],
  ]
  // Linko's card: the primary photo, then up to 4 others (the last one carries «N+» when there are more), then «+».
  const others = item.images.slice(1, 5)
  const extra = item.images.length - 1 - others.length

  const unitDot = item.unit ? ` ${item.unit}.` : " ."
  const money = (value: number, currency?: string) => `${formatNumber(value)} ${currency ?? ""}`.trim()
  // «Характеристика»: the attribute values in the form's order (select attributes first, then by id).
  const characteristics = (attributes ?? []).filter((attribute) => (item.attributes ?? {})[String(attribute.id)])
  const tableRow = "grid h-10 items-center leading-[16.25px]"
  const dotted = "border-b-2 border-dotted border-[#d9e0e5]"

  return (
    <div className="-mx-[15px] rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div onClick={onClose} className="flex h-[65px] cursor-pointer items-center border-b border-[#efefef] px-[30px]">
        <h2 className="min-w-0 flex-1 text-[18px] font-bold leading-[22.5px] text-[#333]">
          <span className="relative">
            {item.name}
            {item.isInventory && ` (${t("Инвентарь")})`}
            {item.isMml && <span className="absolute -right-[25px] -top-2 text-[10px] font-normal leading-3 text-[#81c784]">{t("ММЛ")}</span>}
          </span>
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onEdit(item)
            }}
            title={t("Изменить")}
            aria-label={t("Изменить")}
            className="flex h-12 w-12 items-center justify-center"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
              <path d={RI.edit} />
            </svg>
          </button>
        )}
        {/* A deleted item: «Восстановить» instead of «Удалить» (Linko has no delete for good). */}
        {canEdit && item.deleted && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRestore(item)
            }}
            className="ml-[2px] mr-2 inline-flex h-[30px] items-center rounded-[2px] bg-[#1E4A9A] pl-3 pr-4 text-[13px] font-semibold text-white"
          >
            <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white">
              <path d={RI.undo} />
            </svg>
            {t("Восстановить")}
          </button>
        )}
        {canEdit && !item.deleted && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(item, false)
            }}
            title={t("Удалить")}
            aria-label={t("Удалить")}
            className="flex h-12 w-12 items-center justify-center"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
              <path d={RI.trash} />
            </svg>
          </button>
        )}
      </div>

      {/* Linko's two halves: the left one holds the photo / flags block and «Товар:», each as wide as its content
          allows (the flags line wraps only when «Товар:» needs the room). */}
      <div className="flex max-lg:flex-col">
        <div className="flex w-1/2 border-r border-[#efefef] max-lg:w-full">
          <div className="border-r border-[#efefef] px-[30px] py-5">
            <div className="relative min-h-[230px] min-w-[230px]">
              {item.images.length === 0 ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center border border-dashed border-[#ccc] bg-[#f2f5f8] text-center text-[11px] text-[#999]">
                  <span className="relative mb-5 block w-[90px] after:absolute after:left-1/2 after:top-10 after:-ml-8 after:h-px after:w-16 after:bg-[#999]">{t("Фото отсутствует")}</span>
                  {canEdit && (
                    <button type="button" onClick={() => setAddPhoto(true)} className="text-[11px] text-[#1E4A9A] hover:underline">
                      {t("добавить фото")}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => setSlide(0)} className="mr-[7px] flex h-[165px] w-[230px] justify-center bg-[#f2f5f8]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(kind, item.id, item.images[0].id)} alt={item.name} className="h-full max-w-full object-contain" />
                  </button>
                  <div className="mt-[10px] flex flex-wrap">
                    {others.map((image, index) => (
                      <button key={image.id} type="button" onClick={() => setSlide(index + 1)} className="relative mr-[10px] h-[38px] w-[38px] overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageUrl(kind, item.id, image.id)} alt="" className="h-full w-full object-cover" />
                        {extra > 0 && index === others.length - 1 && (
                          <strong className="absolute inset-0 flex items-center justify-center bg-black/35 text-white">{extra}+</strong>
                        )}
                      </button>
                    ))}
                    {canEdit && (
                      <button type="button" onClick={() => setAddPhoto(true)} aria-label={t("добавить фото")} title={t("добавить фото")} className="flex h-[38px] w-[38px] items-center justify-center bg-[#999] text-white">
                        <Plus className="h-6 w-6" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <ul className="mt-[10px]">
              {flags.map(([label, value]) => (
                <Flag key={label} label={t(label)} value={value} />
              ))}
            </ul>
          </div>

          <div className="min-w-0 px-[30px] py-5">
            <p className="text-[13px] font-bold leading-[16.25px] text-[#333]">{t("Товар")}:</p>
            <ul className="mt-[10px]">
              <Row label={t("Наименование")}>{item.name}</Row>
              <Row label={t("Полное наименование")}>{item.fullName || none}</Row>
              <Row label={t("Мера")}>{item.unit || t("Неизвестно")}</Row>
              <Row label={t("Подкатегория")}>{item.subcategory || item.type || t("Неизвестно")}</Row>
              <Row label={t("Бренд")}>{item.brand || none}</Row>
              <Row label={t("Организация")}>{item.organization || none}</Row>
              <Row label={t("Порядковый номер")}>{item.orderNumber || none}</Row>
              <Row label={t("Минимальный остаток")}>{`${item.minStock}${unitDot}`}</Row>
              <Row label={t("Описание")}>{item.description || none}</Row>
              <Row label={t("Штрих - коды товара")}>{item.barcodes.length ? item.barcodes.join(", ") : none}</Row>
              <Row label={t("Артикул")}>{item.article || none}</Row>
              <Row label={t("Поставщик")}>{item.supplier || none}</Row>
              <Row label={t("Код для интеграции")}>{item.code || none}</Row>
              {item.limitPrice && item.saleMinPrice > 0 && <Row label={t("Минимальная цена продажи")}>{money(item.saleMinPrice, item.salePriceCurrency)}</Row>}
              {item.limitPrice && item.saleMaxPrice > 0 && <Row label={t("Максимальная")}>{money(item.saleMaxPrice, item.salePriceCurrency)}</Row>}
              {item.boxUnit && item.boxAmount > 0 && <Row label={item.boxUnit}>{`${formatNumber(item.boxAmount)} ${item.unit}`.trim()}</Row>}
              {/* Linko's <sup> makes this line 3px taller. */}
            <Row label={t("Объем")} className="pt-[3px]">
                {formatNumber(item.volume, 5)} {"м"}
                <sup>3</sup>.
              </Row>
              <Row label={t("Вес")}>{`${formatNumber(item.weight, 5)} ${t("кг")}.`}</Row>
              <Row label={t("Вес нетто")}>{formatNumber(item.netWeight, 5)}</Row>
              <Row label={t("Цвет")}>{item.color || none}</Row>
            </ul>
          </div>
        </div>

        <div className="w-1/2 min-w-0 border-r border-[#efefef] px-[30px] py-[10px] text-[13px] text-[#333] max-lg:w-full">
          {item.priceLists.length ? (
            <div className="overflow-hidden">
              <div className={`${tableRow} grid-cols-[3fr_2fr_2fr_2fr_2fr_1fr] font-semibold`}>
                <span>{t("Прайс лист")}</span>
                <span className="px-2">{t("Нал")}</span>
                <span className="px-2">{t("Безнал")}</span>
                <span className="px-2">{t("Мин")}</span>
                <span className="px-2">{t("Макс")}</span>
                <span />
              </div>
              {item.priceLists.map((entry) => {
                const nonCashCurrency = entry.nonCashCurrency ?? entry.currency
                return (
                  <div key={entry.name} className={`group ${tableRow} ${dotted} grid-cols-[3fr_2fr_2fr_2fr_2fr_1fr]`}>
                    <span className="break-words">{entry.name}</span>
                    <span className="px-2">{money(entry.cash, entry.currency)}</span>
                    <span className="px-2">{money(entry.nonCash, nonCashCurrency)}</span>
                    <span className="px-2">{money(entry.min, nonCashCurrency)}</span>
                    <span className="px-2">{money(entry.max, nonCashCurrency)}</span>
                    <span className="flex justify-end">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "price", name: entry.name })}
                          title={t("Обнулить")}
                          aria-label={t("Обнулить")}
                          className="flex h-12 w-12 items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                        >
                          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                            <path d={RI.trash} />
                          </svg>
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="leading-[25px]">{t("Прайс листы отсутствуют")}</p>
          )}

          <div className="mt-[15px]">
            <p className="font-bold leading-[16.25px]">{t("Характеристика")}:</p>
            <ul className="mt-[10px]">
              {characteristics.map((attribute) => (
                <Row key={attribute.id} label={attribute.name}>
                  {(item.attributes ?? {})[String(attribute.id)]}
                </Row>
              ))}
              <Row label={t("Балл")}>{item.salePoints ? formatNumber(item.salePoints) : t("Неизвестно")}</Row>
            </ul>
          </div>

          {item.limits.length ? (
            <div className="overflow-hidden">
              <div className={`${tableRow} grid-cols-[5fr_3fr_3fr_1fr] font-semibold`}>
                <span>{t("Агенты")}</span>
                <span className="px-2">{t("Лимит")}</span>
                <span className="px-2">{t("Реализовано")}</span>
                <span />
              </div>
              {item.limits.map((limit) => (
                <div key={limit.id} className={`group ${tableRow} ${dotted} grid-cols-[5fr_3fr_3fr_1fr]`}>
                  <span className="break-words">{limit.agent}</span>
                  <span className="px-2">{formatNumber(limit.amount)}</span>
                  <span className="px-2">{formatNumber(limit.realized)}</span>
                  <span className="flex justify-end">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setPending({ kind: "limit", id: limit.id, agent: limit.agent })}
                        title={t("Удалить")}
                        aria-label={t("Удалить")}
                        className="flex h-12 w-12 items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                          <path d={RI.trash} />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="leading-[16.25px]">{t("Лимиты для агентов отсутствуют")}</p>
          )}

          {item.boxSizes.length > 0 && (
            <>
              <p className="leading-[16.25px]">{t("Дополнительные параметры")}</p>
              <div className="overflow-hidden">
                <div className={`${tableRow} grid-cols-3 font-semibold`}>
                  <span>{t("Ширина")}</span>
                  <span className="px-2">{t("Высота")}</span>
                  <span>{t("Длина")}</span>
                </div>
                {item.boxSizes.map((size, index) => (
                  <div key={index} className={`${tableRow} ${dotted} grid-cols-3`}>
                    <span>{formatNumber(size.width)}</span>
                    <span className="px-2">{formatNumber(size.height)}</span>
                    <span>{formatNumber(size.length)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {addPhoto && (
        <AddPhotoDialog
          kind={kind}
          itemId={item.id}
          onClose={() => setAddPhoto(false)}
          onSaved={() => {
            setAddPhoto(false)
            notify(t("Фотография добавлена"))
            reload()
          }}
        />
      )}
      {slide !== null && (
        <SlideshowDialog kind={kind} itemId={item.id} images={item.images} start={slide} canEdit={canEdit} onClose={() => setSlide(null)} onChanged={reload} notify={notify} />
      )}
      {pending && (
        <ConfirmDialog
          title={t(pending.kind === "price" ? "Обнулить" : "Удалить")}
          text={pending.kind === "price" ? `${t("Прайс лист")} - ${pending.name}` : `${t("Лимит для")} ${pending.agent}`}
          busy={busy}
          onConfirm={() => void confirmPending()}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
