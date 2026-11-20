"use client"

import { useState, type ReactNode } from "react"
import { ImageOff, Info, Loader2 } from "lucide-react"

import { PhotoViewer, RequestStatusIcon, RequestTypeBadge } from "@/components/analytics/inventory-management-detail"
import { ReviewIcon, dayText, itemTitle, timeText } from "@/components/analytics/inventory-management-shared"
import { RefTable } from "@/components/ref/list-kit"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { INVENTORY_LOG_LABELS, type InventoryCheck, type InventoryItem, type InventoryLog, type InventoryRequest, type InventoryTotals } from "@/lib/inventory-items-types"

// The four lists of "Работа с инвентарем" (demo module 4859): items (X:
// № | Серийный № | Клиент | Тип инвентаря | Склад | Дата прикрепления | Дата
// проверки), "История движений" (Z), "История проверки" (J) and "Запросы" (Q),
// plus the blue totals bar (module 4870: Одобрено / Не одобрено / Итого).
// Built on the shared RefTable so the grid, row height and dotted separators
// match the reference's other lists.

/** Column title; the arrow shows only on the active column like the reference. */
function SortHeader({ ordering, sortKey, onSort, children }: { ordering: string; sortKey: string; onSort: (key: string) => void; children: ReactNode }) {
  const arrow = ordering === sortKey ? "▲" : ordering === `-${sortKey}` ? "▼" : ""
  return (
    <button type="button" onClick={() => onSort(sortKey)} className="text-left font-semibold hover:opacity-80">
      {children}
      {arrow && <span className="ml-1 text-[10px]">{arrow}</span>}
    </button>
  )
}

function Comment({ text }: { text: string }) {
  const { t } = useLanguage()
  if (!text) return null
  return (
    <span title={text} className="block text-[12px] text-[#1E4A9A]">
      ({t("ком.")})
    </span>
  )
}

export function TotalsBar({ totals, loading }: { totals: InventoryTotals | null; loading: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="relative bg-[#1E4A9A] px-[5px] py-[5px] text-[13px] font-semibold leading-4 text-white">
      {loading && !totals ? (
        <div className="flex h-4 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-3 text-center">
          <span>
            {t("Одобрено")}: {formatMoney(totals?.reviewed ?? 0, 0)}
          </span>
          <span>
            {t("Не одобрено")}: {formatMoney(totals?.notReviewed ?? 0, 0)}
          </span>
          <span>
            {t("Итого")}: {formatMoney(totals?.total ?? 0, 0)}
          </span>
        </div>
      )}
    </div>
  )
}

type Expand = { detailId: number | null; onRow: (id: number) => void; renderDetail: (id: number) => ReactNode }
type ListState = { loading: boolean; error: boolean }

function useEmpty({ loading, error }: ListState) {
  const { t } = useLanguage()
  return loading ? t("Загрузка...") : error ? "" : t("По вашему запросу ничего не найдено")
}

// Linko shows the item card in place of its row, 15 px wider than the list on each side, 20 px from the rows around it.
// On a phone the card keeps to the visible width of the scrolling list (the view makes it the query container).
const detailBox = (node: ReactNode) => (
  <div className="bg-[#f2f5f8] py-5 md:-mx-[15px]">
    <div className="max-md:sticky max-md:left-0 max-md:w-[100cqw]">{node}</div>
  </div>
)

// Linko's lists are a 12-column grid between the row's 30 px paddings; every column but the first keeps 8 px on its
// left (RefTable's cells keep 8 px on both sides, so the first cell and a right-aligned last one step out of theirs).
const FIRST_CELL = "-ml-2 block"
const LAST_CELL_RIGHT = "-mr-2 flex items-center justify-end gap-[10px] text-right"

// Material arrow_downward / arrow_upward of История движений (16 px, 5 px before the title).
const MD_ARROW_DOWN = "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"
const MD_ARROW_UP = "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"

export function ItemsTable({
  rows,
  ordering,
  onSort,
  selected,
  onSelect,
  selectable,
  detailId,
  onRow,
  renderDetail,
  loading,
  error,
}: { rows: InventoryItem[]; ordering: string; onSort: (key: string) => void; selected: number[]; onSelect: (ids: number[]) => void; selectable: boolean } & Expand & ListState) {
  const { t, language } = useLanguage()
  const empty = useEmpty({ loading, error })
  const allChecked = rows.length > 0 && rows.every((row) => selected.includes(row.id))
  const heads = [
    <span key="n" className="-ml-2 flex items-center gap-[10px]">
      {selectable && (
        <input
          type="checkbox"
          aria-label={t("Выбрать все")}
          checked={allChecked}
          onChange={() => onSelect(allChecked ? selected.filter((id) => !rows.some((row) => row.id === id)) : [...new Set([...selected, ...rows.map((row) => row.id)])])}
          className="h-4 w-4 accent-[#1E4A9A]"
        />
      )}
      <SortHeader ordering={ordering} sortKey="id" onSort={onSort}>
        №
      </SortHeader>
    </span>,
    t("Серийный №"),
    t("Клиент"),
    t("Тип инвентаря"),
    t("Склад"),
    <SortHeader key="date" ordering={ordering} sortKey="date" onSort={onSort}>
      {t("Дата прикрепления")}
    </SortHeader>,
    <span key="checked" className={LAST_CELL_RIGHT}>
      {t("Дата проверки")}
    </span>,
  ].map((head) => (typeof head === "string" ? <span key={head}>{head}</span> : head))
  return (
    <RefTable
      cols="minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr)"
      heads={heads}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={(row) => onRow(row.id)}
      rowClass={(row) => `${detailId === row.id ? "!hidden" : ""} ${row.deleted ? "text-[#9aa3b6] line-through decoration-[#e57373]/60" : ""}`}
      empty={empty}
      render={(row) => [
        <span key="id" className="-ml-2 flex items-center gap-[10px]">
          {selectable && (
            <span onClick={(event) => event.stopPropagation()} className="flex">
              <input
                type="checkbox"
                aria-label={`№ ${row.id}`}
                disabled={row.deleted}
                checked={selected.includes(row.id)}
                onChange={() => onSelect(selected.includes(row.id) ? selected.filter((id) => id !== row.id) : [...selected, row.id])}
                className="h-4 w-4 accent-[#1E4A9A]"
              />
            </span>
          )}
          <span>
            {row.id}
            <Comment text={row.comment} />
          </span>
        </span>,
        row.serialNumber,
        row.client?.name ?? "",
        <span key="product">
          {row.product.name}
          {row.stockNumber && (
            <span title={t("Инвентарный №")} className="block text-[13px] text-[#1E4A9A]">
              {row.stockNumber}
            </span>
          )}
        </span>,
        row.warehouse,
        // Linko's list fills an item without a date with the day it was registered (its card leaves it blank).
        dayText(row.date || row.createdAt, language),
        // Linko's «Дата проверки» prints the item's creation day (createdDate) right-aligned, 10 px before the icon; a
        // date that wraps keeps its lines left-aligned (a bare text item of the flex row).
        <span key="review" className={LAST_CELL_RIGHT}>
          <span className="min-w-0 text-left">{dayText(row.createdAt, language)}</span>
          <ReviewIcon reviewed={row.isReviewed} t={t} className="h-6 w-6" />
        </span>,
      ]}
      expanded={(row) => (detailId === row.id ? detailBox(renderDetail(row.id)) : null)}
    />
  )
}

export function LogsTable({ rows, ordering, onSort, loading, error }: { rows: InventoryLog[]; ordering: string; onSort: (key: string) => void } & ListState) {
  const { t, language } = useLanguage()
  const empty = useEmpty({ loading, error })
  const heads = [
    <span key="item" className={FIRST_CELL}>
      {t("Инвентарь")}
    </span>,
    <SortHeader key="created" ordering={ordering} sortKey="created_date" onSort={onSort}>
      {t("Дата создания")}
    </SortHeader>,
    <SortHeader key="date" ordering={ordering} sortKey="date" onSort={onSort}>
      {t("Дата движения")}
    </SortHeader>,
    <span key="client" className="block text-center">
      <SortHeader ordering={ordering} sortKey="client" onSort={onSort}>
        {t("Клиент")}
      </SortHeader>
    </span>,
    <span key="wh">{t("Склад")}</span>,
    <span key="cond">{t("Состояние")}</span>,
    <span key="type">{t("Тип")}</span>,
  ]
  return (
    <RefTable
      cols="minmax(0,3fr) minmax(0,2fr) minmax(0,1fr) minmax(0,3fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)"
      // Linko's sortable headers keep room for the arrow, so «Дата движения» wraps.
      headPad={30}
      heads={heads}
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      render={(row) => [
        <span key="item" className="-ml-2 flex">
          <svg viewBox="0 0 24 24" className={`mr-[5px] h-4 w-4 shrink-0 ${row.status === "take" ? "fill-[#e57373]" : "fill-[#81c784]"}`} aria-hidden>
            <path d={row.status === "take" ? MD_ARROW_UP : MD_ARROW_DOWN} />
          </svg>
          <span className={`min-w-0 whitespace-pre-wrap ${row.item.deleted ? "text-[#9aa3b6] line-through" : ""}`}>{itemTitle(row.item)}</span>
        </span>,
        timeText(row.createdAt, language),
        dayText(row.date, language),
        <span key="client" className="block text-center">
          {row.client?.name ?? ""}
        </span>,
        row.warehouse,
        t(row.condition),
        <span key="type" className="flex items-center gap-2 whitespace-nowrap" title={row.createdBy ? `${t("Создал")}: ${row.createdBy}` : undefined}>
          {row.comment && (
            <span title={row.comment}>
              <Info className="h-4 w-4 text-[rgb(79,113,220)]" />
            </span>
          )}
          {t(INVENTORY_LOG_LABELS[row.status])}
        </span>,
      ]}
    />
  )
}

export function ChecksTable({ rows, loading, error }: { rows: InventoryCheck[] } & ListState) {
  const { t, language } = useLanguage()
  const empty = useEmpty({ loading, error })
  const [photo, setPhoto] = useState(false)
  return (
    <>
      <RefTable
        cols="minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,3fr) minmax(0,2fr)"
        heads={["№", t("Клиент"), t("Создал"), t("Дата проверки"), t("Инвентарь"), t("Изображений")].map((head, index) => (
          <span key={head} className={index === 0 ? FIRST_CELL : undefined}>
            {head}
          </span>
        ))}
        rows={rows}
        rowKey={(row) => row.id}
        empty={empty}
        render={(row) => [
          <span key="id" className={FIRST_CELL}>
            {row.id}
            <Comment text={row.comment} />
          </span>,
          row.client?.name ?? "",
          row.createdBy || t("Не указан"),
          row.createdAt ? timeText(row.createdAt, language) : t("Не указано"),
          <span key="item" className={`whitespace-pre-wrap ${row.item.deleted ? "text-[#9aa3b6] line-through" : ""}`}>
            {itemTitle(row.item, "  ")}
          </span>,
          // Linko lists the review's own photos (90 px tiles, 5 px apart); its server no longer serves those files, so each
          // tile shows the broken picture, and a click opens the viewer.
          // (Linko pads the cell 10 px above and below; the row adds 7 of them.)
          <span key="photos" className="flex flex-wrap items-center gap-[5px] py-[3px]">
            {row.images.map((image, index) => (
              <button key={`${image.id}-${index}`} type="button" onClick={() => setPhoto(true)} aria-label={t("Изображений")} className="relative mr-[6px] block h-[90px] w-[90px] overflow-hidden rounded-md bg-[#f5f5f5]">
                <ImageOff className="absolute left-1 top-1 h-4 w-4 text-[#9e9e9e]" aria-hidden />
              </button>
            ))}
          </span>,
        ]}
      />
      {photo && <PhotoViewer src={null} onClose={() => setPhoto(false)} />}
    </>
  )
}

export function RequestsTable({ rows, detailId, onRow, renderDetail, loading, error }: { rows: InventoryRequest[] } & Expand & ListState) {
  const { t, language } = useLanguage()
  const empty = useEmpty({ loading, error })
  return (
    <RefTable
      // Linko's widths of the request columns: 4 / 10 / 10 / 16 / 16 / 10 / 10 / 10 / 10 / 4 %.
      cols="minmax(0,4fr) minmax(0,10fr) minmax(0,10fr) minmax(0,16fr) minmax(0,16fr) minmax(0,10fr) minmax(0,10fr) minmax(0,10fr) minmax(0,10fr) minmax(0,4fr)"
      heads={["№", t("Тип"), t("Клиент"), t("Тип инвентаря"), t("Инвентарь"), t("Запросил"), t("Дата запроса"), t("Обработал"), t("Дата обработки"), t("Статус")].map((head) => (
        <span key={head}>{head}</span>
      ))}
      minWidth={1100}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={(row) => onRow(row.id)}
      rowClass={(row) => (detailId === row.id ? "!bg-[#eef2ff]" : "")}
      empty={empty}
      render={(row) => [
        row.id,
        <RequestTypeBadge key="type" type={row.type} />,
        row.client?.name ?? "",
        row.product?.name ?? "",
        row.item ? `№${row.item.id} (${row.item.serialNumber || "—"})` : "",
        row.requestedBy,
        row.createdAt ? timeText(row.createdAt, language) : t("Не указано"),
        row.updatedBy,
        row.updatedAt ? timeText(row.updatedAt, language) : t("Не указано"),
        <span key="status" className="flex justify-center">
          <RequestStatusIcon status={row.status} />
        </span>,
      ]}
      expanded={(row) => (detailId === row.id ? detailBox(renderDetail(row.id)) : null)}
    />
  )
}
