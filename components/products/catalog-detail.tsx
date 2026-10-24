"use client"

import { useState, type ReactNode } from "react"
import { Plus, RotateCcw, Trash2 } from "lucide-react"

import { ConfirmDialog, ErrorBlock, LoadingBlock } from "@/components/analytics/cash-management-shared"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { AddPhotoDialog, SlideshowDialog } from "@/components/products/catalog-photos"
import { RI } from "@/components/ref/list-kit"
import { catalogMutate, errorText, formatNumber, imageUrl } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, type CatalogDetail, type CatalogKind } from "@/lib/products-types"

// Demo ProductDetail (module 2222), opened in place of the clicked row: the name
// ("(Инвентарь)", "ММЛ"), Изменить / Удалить or Восстановить; photos ("Фото отсутствует",
// "добавить фото", up to 5 thumbnails, slideshow); the flags; "Товар:" fields; prices per
// price list (Прайс лист | Нал | Безнал | Мин | Макс, "Обнулить"); "Характеристика:" Балл;
// agent limits (Агенты | Лимит | Реализовано, delete); "Дополнительные параметры" sizes.

const CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const CLOSE_X = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** "Label: value" — the label shrinks (wraps) when the value is long, like the reference's rows. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex gap-[5px] text-[13px] leading-[25px] text-[#333]">
      <span className="shrink">{label}:</span>
      <span className="min-w-0 break-words font-semibold">{children}</span>
    </li>
  )
}

function Flag({ label, value }: { label: string; value: boolean }) {
  return (
    <li className="flex items-start gap-1 text-[13px] leading-[25px] text-[#333]">
      <span>{label}:</span>
      <svg viewBox="0 0 24 24" className={`mt-[0.5px] h-6 w-6 shrink-0 ${value ? "fill-[#71ce87]" : "fill-[#e57373]"}`}>
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
    ...(kind === "product" ? ([["Perfect store", item.perfectStore]] as Array<[string, boolean]>) : []),
    ["Продать только в группе", item.sellOnlyBox],
    ["Учитывать срок годности", item.trackExpiry],
    ["Можно дать ручную скидку", item.manualDiscount],
    ["Скрыть из списка заказов для агента", item.hideFromAgent],
    ["Учитывать серии", item.trackSeries],
  ]
  const thumbs = item.images.slice(0, 5)

  const unit = item.unit ? ` ${item.unit}.` : ""
  const money = (value: number, currency?: string) => `${formatNumber(value, 2)} ${currency ?? ""}`.trim()

  return (
    <div className="-mx-[15px] rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div onClick={onClose} className="flex h-[65px] cursor-pointer items-center border-b border-[#e0e0e0] px-[30px]">
        <h2 className="min-w-0 flex-1 text-[18px] font-bold leading-[22.5px] text-[#333]">
          {item.name} {item.isInventory && <span className="font-normal text-[#586174]">({t("Инвентарь")})</span>}{" "}
          {item.isMml && <span className="ml-1 rounded-sm bg-[#4f71dc] px-1.5 py-0.5 align-middle text-[11px] font-semibold text-white">{t("ММЛ")}</span>}
          {item.deleted && <span className="ml-2 rounded-sm bg-[#e57373] px-1.5 py-0.5 align-middle text-[11px] font-semibold text-white">{t("Удалён")}</span>}
        </h2>
        {canEdit && item.deleted && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onRestore(item) }} className="mr-6 inline-flex h-[30px] items-center gap-1 rounded-sm bg-[rgb(79,113,220)] px-3 text-[13px] font-semibold text-white">
            <RotateCcw className="h-4 w-4" /> {t("Восстановить")}
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(item) }} title={t("Изменить")} aria-label={t("Изменить")} className="mr-7 flex h-5 w-5 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
              <path d={RI.edit} />
            </svg>
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(item, item.deleted) }} title={t(item.deleted ? "Удалить навсегда" : "Удалить")} aria-label={t("Удалить")} className="mr-[14px] flex h-5 w-5 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
              <path d={RI.trash} />
            </svg>
          </button>
        )}
      </div>

      <div className="grid grid-cols-[297px_440px_1fr] max-lg:grid-cols-1">
        <div className="border-r border-[#e0e0e0] px-[30px] pb-5 pt-5">
          <div className="h-[165px] w-[230px] overflow-hidden bg-[#f2f5f8]">
            {item.images.length > 0 && (
              <button type="button" onClick={() => setSlide(0)} className="block h-full w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(kind, item.id, item.images[0].id)} alt={item.name} className="h-full w-full object-contain" />
              </button>
            )}
          </div>
          <div className="mt-[10px] flex flex-wrap items-center gap-2">
            {canEdit && (
              <button type="button" onClick={() => setAddPhoto(true)} aria-label={t("добавить фото")} title={t("добавить фото")} className="flex h-[38px] w-[38px] items-center justify-center bg-[#9e9e9e] text-white">
                <Plus className="h-6 w-6" />
              </button>
            )}
            {thumbs.slice(1).map((image, index) => (
              <button key={image.id} type="button" onClick={() => setSlide(index + 1)} className="h-[38px] w-[38px] overflow-hidden border border-[#e0e0e0]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(kind, item.id, image.id)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
            {item.images.length > thumbs.length && <span className="text-[13px] text-[#586174]">+{item.images.length - thumbs.length}</span>}
          </div>
          <ul className="mt-[29px]">
            {flags.map(([label, value]) => (
              <Flag key={label} label={t(label)} value={value} />
            ))}
          </ul>
        </div>

        <div className="border-r border-[#e0e0e0] px-[30px] pb-5 pt-[21px]">
          <p className="text-[13px] font-bold leading-[16.25px] text-[#333]">{t("Товар")}:</p>
          <ul className="mt-[10px]">
            <Row label={t("Наименование")}>{item.name}</Row>
            <Row label={t("Полное наименование")}>{item.fullName || none}</Row>
            <Row label={t("Мера")}>{item.unit || t("Неизвестно")}</Row>
            {item.boxUnit && item.boxAmount > 0 && <Row label={item.boxUnit}>{`${formatNumber(item.boxAmount)} ${item.unit}`}</Row>}
            {item.subcategory && <Row label={t("Тип продукта")}>{item.type || t("Неизвестно")}</Row>}
            <Row label={t("Подкатегория")}>{item.subcategory || item.type || none}</Row>
            <Row label={t("Бренд")}>{item.brand || none}</Row>
            <Row label={t("Организация")}>{item.organization || none}</Row>
            <Row label={t("Порядковый номер")}>{item.orderNumber || none}</Row>
            <Row label={t("Минимальный остаток")}>{`${formatNumber(item.minStock)}${unit}`}</Row>
            <Row label={t("Описание")}>{item.description || none}</Row>
            <Row label={t("Штрих - коды товара")}>{item.barcodes.length ? item.barcodes.join(", ") : none}</Row>
            <Row label={t("Артикул")}>{item.article || none}</Row>
            <Row label={t("Поставщик")}>{item.supplier || none}</Row>
            <Row label={t("Код для интеграции")}>{item.code || none}</Row>
            <Row label={t("Объем")}>
              {formatNumber(item.volume, 5)} {"м"}
              <sup>3</sup>.
            </Row>
            <Row label={t("Вес")}>{`${formatNumber(item.weight, 5)} ${t("кг")}.`}</Row>
            <Row label={t("Вес нетто")}>{formatNumber(item.netWeight, 5)}</Row>
            <Row label={t("Цвет")}>{item.color || none}</Row>
            <Row label={t("Икпу")}>{item.ikpu || none}</Row>
            <Row label={t("Код ед.изм. в фактуре")}>{item.invoiceUnitCode || none}</Row>
            <Row label={t("НДС")}>{t(item.vat || "Без НДС")}</Row>
            {item.limitPrice && item.saleMinPrice > 0 && <Row label={t("Минимальная цена продажи")}>{money(item.saleMinPrice, item.salePriceCurrency)}</Row>}
            {item.limitPrice && item.saleMaxPrice > 0 && <Row label={t("Максимальная")}>{money(item.saleMaxPrice, item.salePriceCurrency)}</Row>}
            {item.trackExpiry && item.expirationDays !== null && <Row label={t("Дата окончания срока годности (дней)")}>{item.expirationDays}</Row>}
            <Row label={t("Дата создания")}>{item.createdDate || none}</Row>
          </ul>
        </div>

        <div className="min-w-0 px-[30px] pb-5 pt-5 text-[13px] text-[#333]">
          {item.priceLists.length ? (
            <div>
              <div className="grid h-[34px] grid-cols-[169px_113px_112px_113px_1fr] font-semibold leading-[16.25px]">
                <span>{t("Прайс лист")}</span>
                <span>{t("Нал")}</span>
                <span>{t("Безнал")}</span>
                <span>{t("Мин")}</span>
                <span>{t("Макс")}</span>
              </div>
              {item.priceLists.map((entry) => (
                <div key={entry.name} className="group relative grid min-h-10 grid-cols-[169px_113px_112px_113px_1fr] items-center border-b-2 border-dotted border-[#d9e0e5] leading-[16.25px]">
                  <span className="pr-2 break-words">{entry.name}</span>
                  <span className="whitespace-nowrap">{money(entry.cash, entry.currency)}</span>
                  <span className="whitespace-nowrap">{money(entry.nonCash, entry.nonCashCurrency ?? entry.currency)}</span>
                  <span className="whitespace-nowrap">{money(entry.min, entry.currency)}</span>
                  <span className="whitespace-nowrap">{money(entry.max, entry.currency)}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setPending({ kind: "price", name: entry.name })}
                      title={t("Обнулить")}
                      aria-label={t("Обнулить")}
                      className="absolute right-0 top-1/2 hidden -translate-y-1/2 text-[#9aa3b6] hover:text-[#e57373] group-hover:block"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="leading-[25px] text-[#586174]">{t("Прайс листы отсутствуют")}</p>
          )}

          <div className="mt-[18px]">
            <p className="font-bold leading-[16.25px]">{t("Характеристика")}:</p>
            <ul className="mt-[7px]">
              <Row label={t("Балл")}>{item.salePoints ? formatNumber(item.salePoints) : t("Неизвестно")}</Row>
            </ul>
          </div>

          {item.limits.length ? (
            <div className="mt-[18px]">
              <div className="grid h-[34px] grid-cols-[169px_113px_1fr] font-semibold leading-[16.25px]">
                <span>{t("Агенты")}</span>
                <span>{t("Лимит")}</span>
                <span>{t("Реализовано")}</span>
              </div>
              {item.limits.map((limit) => (
                <div key={limit.id} className="group relative grid min-h-10 grid-cols-[169px_113px_1fr] items-center border-b-2 border-dotted border-[#d9e0e5] leading-[16.25px]">
                  <span className="pr-2 break-words">{limit.agent}</span>
                  <span>{formatNumber(limit.amount)}</span>
                  <span>{formatNumber(limit.realized)}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setPending({ kind: "limit", id: limit.id, agent: limit.agent })}
                      title={t("Удалить")}
                      aria-label={t("Удалить")}
                      className="absolute right-0 top-1/2 hidden -translate-y-1/2 text-[#9aa3b6] hover:text-[#e57373] group-hover:block"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-[18px] leading-[25px] text-[#586174]">{t("Лимиты для агентов отсутствуют")}</p>
          )}

          {item.boxSizes.length > 0 && (
            <div className="mt-[18px]">
              <p className="font-bold leading-[16.25px]">{t("Дополнительные параметры")}:</p>
              <div className="mt-[7px] grid h-[34px] grid-cols-[169px_113px_112px_1fr] font-semibold leading-[16.25px]">
                <span>{t("Группа")}</span>
                <span>{t("Ширина")}</span>
                <span>{t("Высота")}</span>
                <span>{t("Длина")}</span>
              </div>
              {item.boxSizes.map((size, index) => (
                <div key={index} className="grid min-h-10 grid-cols-[169px_113px_112px_1fr] items-center border-b-2 border-dotted border-[#d9e0e5] leading-[16.25px]">
                  <span>{size.unit || "—"}</span>
                  <span>{formatNumber(size.width)}</span>
                  <span>{formatNumber(size.height)}</span>
                  <span>{formatNumber(size.length)}</span>
                </div>
              ))}
            </div>
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
