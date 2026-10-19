"use client"

import { useState, type ReactNode } from "react"
import { Image as ImageIcon, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react"

import { ConfirmDialog, ErrorBlock, LoadingBlock } from "@/components/analytics/cash-management-shared"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { AddPhotoDialog, SlideshowDialog } from "@/components/products/catalog-photos"
import { YesNo, catalogMutate, errorText, formatNumber, imageUrl } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, type CatalogDetail, type CatalogKind } from "@/lib/products-types"

// Demo ProductDetail (module 2222), opened in place of the clicked row: the name
// ("(Инвентарь)", "ММЛ"), Изменить / Удалить or Восстановить; photos ("Фото отсутствует",
// "добавить фото", up to 5 thumbnails, slideshow); the flags; "Товар:" fields; prices per
// price list (Прайс лист | Нал | Безнал | Мин | Макс, "Обнулить"); "Характеристика:" Балл;
// agent limits (Агенты | Лимит | Реализовано, delete); "Дополнительные параметры" sizes.

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap justify-between gap-x-3 border-b border-dashed border-[#e1e5eb] py-1.5 leading-[22px] last:border-none">
      <span className="text-[#586174]">{label}:</span>
      <span className="max-w-[65%] break-words text-right font-semibold text-[#17233b]">{children}</span>
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
  const iconButton = "flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]"

  return (
    <div className="rounded-sm bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#e1e5eb] px-5 py-3">
        <h2 className="min-w-0 flex-1 text-[18px] font-bold text-[#17233b]">
          {item.name} {item.isInventory && <span className="font-normal text-[#586174]">({t("Инвентарь")})</span>}{" "}
          {item.isMml && <span className="ml-1 rounded-sm bg-[#4f71dc] px-1.5 py-0.5 text-[11px] font-semibold text-white">{t("ММЛ")}</span>}
          {item.deleted && <span className="ml-2 rounded-sm bg-[#e57373] px-1.5 py-0.5 text-[11px] font-semibold text-white">{t("Удалён")}</span>}
        </h2>
        {canEdit && (
          <button type="button" onClick={() => onEdit(item)} title={t("Изменить")} aria-label={t("Изменить")} className={iconButton}>
            <Pencil className="h-5 w-5" />
          </button>
        )}
        {canEdit && item.deleted && (
          <button
            type="button"
            onClick={() => onRestore(item)}
            className="inline-flex h-[30px] items-center gap-1 rounded-sm bg-[rgb(79,113,220)] px-3 text-[13px] font-semibold text-white"
          >
            <RotateCcw className="h-4 w-4" /> {t("Восстановить")}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => onDelete(item, item.deleted)}
            title={t(item.deleted ? "Удалить навсегда" : "Удалить")}
            aria-label={t("Удалить")}
            className={iconButton}
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
        <button type="button" onClick={onClose} title={t("Закрыть")} aria-label={t("Закрыть")} className={iconButton}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[260px_1fr_1.2fr]">
        <div>
          {item.images.length ? (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => setSlide(0)} className="overflow-hidden rounded border border-[#e1e5eb]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(kind, item.id, item.images[0].id)} alt={item.name} className="h-48 w-full object-contain" />
              </button>
              <div className="flex flex-wrap gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setAddPhoto(true)}
                    aria-label={t("добавить фото")}
                    className="flex h-12 w-12 items-center justify-center rounded bg-[#4f71dc] text-white"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
                {thumbs.slice(1).map((image, index) => (
                  <button key={image.id} type="button" onClick={() => setSlide(index + 1)} className="h-12 w-12 overflow-hidden rounded border border-[#e1e5eb]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(kind, item.id, image.id)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
                {item.images.length > thumbs.length && <span className="self-center text-[13px] text-[#586174]">+{item.images.length - thumbs.length}</span>}
              </div>
            </div>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center gap-1 rounded border border-dashed border-[#dbe0e8] text-[14px] text-[#9aa3b6]">
              <ImageIcon className="h-8 w-8" />
              <span>{t("Фото отсутствует")}</span>
              {canEdit && (
                <button type="button" onClick={() => setAddPhoto(true)} className="text-[#4f71dc] hover:underline">
                  {t("добавить фото")}
                </button>
              )}
            </div>
          )}
          <ul className="mt-4 text-[14px]">
            {flags.map(([label, value]) => (
              <li key={label} className="flex items-center justify-between gap-2 py-1">
                <span className="text-[#586174]">{t(label)}:</span>
                <YesNo value={value} />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 font-semibold text-[#17233b]">{t("Товар")}:</p>
          <ul className="text-[14px]">
            <Row label={t("Наименование")}>{item.name}</Row>
            <Row label={t("Полное наименование")}>{item.fullName || none}</Row>
            <Row label={t("Мера")}>{item.unit || t("Неизвестно")}</Row>
            {item.boxUnit && item.boxAmount > 0 && <Row label={item.boxUnit}>{`${formatNumber(item.boxAmount)} ${item.unit}`}</Row>}
            <Row label={t("Тип продукта")}>{item.type || t("Неизвестно")}</Row>
            <Row label={t("Подкатегория")}>{item.subcategory || none}</Row>
            <Row label={t("Бренд")}>{item.brand || none}</Row>
            <Row label={t("Организация")}>{item.organization || none}</Row>
            <Row label={t("Порядковый номер")}>{item.orderNumber || none}</Row>
            <Row label={t("Минимальный остаток")}>{formatNumber(item.minStock)}</Row>
            <Row label={t("Описание")}>{item.description || none}</Row>
            <Row label={t("Штрих - коды товара")}>{item.barcodes.length ? item.barcodes.join(", ") : none}</Row>
            <Row label={t("Артикул")}>{item.article || none}</Row>
            <Row label={t("Поставщик")}>{item.supplier || none}</Row>
            <Row label={t("Код для интеграции")}>{item.code || none}</Row>
            <Row label={t("Икпу")}>{item.ikpu || none}</Row>
            <Row label={t("Код ед.изм. в фактуре")}>{item.invoiceUnitCode || none}</Row>
            <Row label={t("НДС")}>{t(item.vat || "Без НДС")}</Row>
            {item.limitPrice && item.saleMinPrice > 0 && <Row label={t("Минимальная цена продажи")}>{`${formatNumber(item.saleMinPrice, 2)} ${item.salePriceCurrency}`}</Row>}
            {item.limitPrice && item.saleMaxPrice > 0 && <Row label={t("Максимальная")}>{`${formatNumber(item.saleMaxPrice, 2)} ${item.salePriceCurrency}`}</Row>}
            <Row label={t("Объем")}>{item.volume ? `${formatNumber(item.volume, 5)} м³` : none}</Row>
            <Row label={t("Вес")}>{item.weight ? `${formatNumber(item.weight, 5)} ${t("кг")}.` : none}</Row>
            <Row label={t("Вес нетто")}>{item.netWeight ? formatNumber(item.netWeight, 5) : none}</Row>
            <Row label={t("Цвет")}>{item.color || none}</Row>
            {item.trackExpiry && item.expirationDays !== null && <Row label={t("Дата окончания срока годности (дней)")}>{item.expirationDays}</Row>}
            <Row label={t("Дата создания")}>{item.createdDate || none}</Row>
          </ul>
        </div>

        <div className="flex flex-col gap-5 text-[14px]">
          {item.priceLists.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead>
                  <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
                    <th className="py-2 pr-2 font-semibold">{t("Прайс лист")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("Нал")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("Безнал")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("Мин")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("Макс")}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {item.priceLists.map((entry) => (
                    <tr key={entry.name} className="border-b border-dashed border-[#e1e5eb]">
                      <td className="py-2 pr-2">{entry.name}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{`${formatNumber(entry.cash, 2)} ${entry.currency ?? ""}`}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{`${formatNumber(entry.nonCash, 2)} ${entry.nonCashCurrency ?? entry.currency ?? ""}`}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{entry.min ? formatNumber(entry.min, 2) : "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{entry.max ? formatNumber(entry.max, 2) : "—"}</td>
                      <td className="py-2 text-right">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setPending({ kind: "price", name: entry.name })}
                            title={t("Обнулить")}
                            aria-label={t("Обнулить")}
                            className="text-[#9aa3b6] hover:text-[#e57373]"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[#586174]">{t("Прайс листы отсутствуют")}</p>
          )}

          <div>
            <p className="mb-1 font-semibold text-[#17233b]">{t("Характеристика")}:</p>
            <ul>
              <Row label={t("Балл")}>{item.salePoints ? formatNumber(item.salePoints) : t("Неизвестно")}</Row>
            </ul>
          </div>

          {item.limits.length ? (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
                  <th className="py-2 pr-2 font-semibold">{t("Агенты")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("Лимит")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("Реализовано")}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {item.limits.map((limit) => (
                  <tr key={limit.id} className="border-b border-dashed border-[#e1e5eb]">
                    <td className="py-2 pr-2">{limit.agent}</td>
                    <td className="py-2 pr-2">{formatNumber(limit.amount)}</td>
                    <td className="py-2 pr-2">{formatNumber(limit.realized)}</td>
                    <td className="py-2 text-right">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "limit", id: limit.id, agent: limit.agent })}
                          title={t("Удалить")}
                          aria-label={t("Удалить")}
                          className="text-[#9aa3b6] hover:text-[#e57373]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[#586174]">{t("Лимиты для агентов отсутствуют")}</p>
          )}

          {item.boxSizes.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-[#17233b]">{t("Дополнительные параметры")}:</p>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#e1e5eb] text-left text-[#586174]">
                    <th className="py-2 pr-2 font-semibold">{t("Группа")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("Ширина")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("Высота")}</th>
                    <th className="py-2 pr-2 font-semibold">{t("Длина")}</th>
                  </tr>
                </thead>
                <tbody>
                  {item.boxSizes.map((size, index) => (
                    <tr key={index} className="border-b border-dashed border-[#e1e5eb]">
                      <td className="py-2 pr-2">{size.unit || "—"}</td>
                      <td className="py-2 pr-2">{formatNumber(size.width)}</td>
                      <td className="py-2 pr-2">{formatNumber(size.height)}</td>
                      <td className="py-2 pr-2">{formatNumber(size.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
