"use client"

import { useState, type ReactNode } from "react"
import Image from "next/image"
import { ArrowLeft, ArrowRight, Info, Loader2 } from "lucide-react"

import { PhotoViewer, RequestStatusIcon, RequestTypeBadge } from "@/components/analytics/inventory-management-detail"
import { ReviewIcon, dayText, itemTitle, photoUrl, timeText } from "@/components/analytics/inventory-management-shared"
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
    <span title={text} className="block text-[12px] text-[#4f71dc]">
      ({t("ком.")})
    </span>
  )
}

export function TotalsBar({ totals, loading }: { totals: InventoryTotals | null; loading: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="relative bg-[#5869f0] px-[5px] py-[5px] text-[13px] font-semibold leading-4 text-white">
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

const detailBox = (node: ReactNode) => <div className="-mx-[15px] my-5 bg-[#f2f5f8] px-2 py-3 md:px-4">{node}</div>

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
    <span key="n" className="flex items-center gap-[10px]">
      {selectable && (
        <input
          type="checkbox"
          aria-label={t("Выбрать все")}
          checked={allChecked}
          onChange={() => onSelect(allChecked ? selected.filter((id) => !rows.some((row) => row.id === id)) : [...new Set([...selected, ...rows.map((row) => row.id)])])}
          className="h-4 w-4 accent-[#4f70e7]"
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
    t("Дата проверки"),
  ].map((head) => (typeof head === "string" ? <span key={head}>{head}</span> : head))
  return (
    <RefTable
      cols="123px 231px 231px 230px 231px 239px minmax(0,1fr)"
      heads={heads}
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={(row) => onRow(row.id)}
      rowClass={(row) => `${detailId === row.id ? "!bg-[#eef2ff]" : ""} ${row.deleted ? "text-[#9aa3b6] line-through decoration-[#e57373]/60" : ""}`}
      empty={empty}
      render={(row) => [
        <span key="id" className="flex items-center gap-[10px]">
          {selectable && (
            <span onClick={(event) => event.stopPropagation()} className="flex">
              <input
                type="checkbox"
                aria-label={`№ ${row.id}`}
                disabled={row.deleted}
                checked={selected.includes(row.id)}
                onChange={() => onSelect(selected.includes(row.id) ? selected.filter((id) => id !== row.id) : [...selected, row.id])}
                className="h-4 w-4 accent-[#4f70e7]"
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
            <span title={t("Инвентарный №")} className="block text-[13px] text-[#4f71dc]">
              {row.stockNumber}
            </span>
          )}
        </span>,
        row.warehouse,
        dayText(row.date, language),
        <span key="review" className="flex items-center justify-between">
          <span className="min-w-0">{dayText(row.reviewedAt || row.createdAt, language)}</span>
          <ReviewIcon reviewed={row.isReviewed} t={t} />
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
    <span key="item">{t("Инвентарь")}</span>,
    <SortHeader key="created" ordering={ordering} sortKey="created_date" onSort={onSort}>
      {t("Дата создания")}
    </SortHeader>,
    <SortHeader key="date" ordering={ordering} sortKey="date" onSort={onSort}>
      {t("Дата движения")}
    </SortHeader>,
    <SortHeader key="client" ordering={ordering} sortKey="client" onSort={onSort}>
      {t("Клиент")}
    </SortHeader>,
    <span key="wh">{t("Склад")}</span>,
    <span key="cond">{t("Состояние")}</span>,
    <span key="type">{t("Тип")}</span>,
  ]
  return (
    <RefTable
      cols="minmax(0,25fr) minmax(0,16fr) minmax(0,11fr) minmax(0,18fr) minmax(0,11fr) minmax(0,9fr) minmax(0,10fr)"
      heads={heads}
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      render={(row) => [
        <span key="item" className="flex items-center gap-1.5">
          {row.status === "take" ? <ArrowLeft className="h-4 w-4 shrink-0 text-[#e57373]" /> : <ArrowRight className="h-4 w-4 shrink-0 text-[#81c784]" />}
          <span className={row.item.deleted ? "text-[#9aa3b6] line-through" : ""}>{itemTitle(row.item)}</span>
        </span>,
        timeText(row.createdAt, language),
        dayText(row.date, language),
        row.client?.name ?? "",
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
  const [photo, setPhoto] = useState<string | null>(null)
  return (
    <>
      <RefTable
        cols="minmax(0,8fr) minmax(0,18fr) minmax(0,16fr) minmax(0,18fr) minmax(0,25fr) minmax(0,15fr)"
        heads={["№", t("Клиент"), t("Создал"), t("Дата проверки"), t("Инвентарь"), t("Изображений")].map((head) => (
          <span key={head}>{head}</span>
        ))}
        rows={rows}
        rowKey={(row) => row.id}
        empty={empty}
        render={(row) => [
          <span key="id">
            {row.id}
            <Comment text={row.comment} />
          </span>,
          row.client?.name ?? "",
          row.createdBy || t("Не указан"),
          <span key="checked" className="flex items-center gap-2 whitespace-nowrap">
            {row.createdAt ? timeText(row.createdAt, language) : t("Не указано")}
            <ReviewIcon reviewed={row.isReviewed} t={t} className="h-4 w-4" />
          </span>,
          <span key="item" className={row.item.deleted ? "text-[#9aa3b6] line-through" : ""}>
            {itemTitle(row.item)}
          </span>,
          row.item.hasPhoto ? (
            <button key="photo" type="button" onClick={() => setPhoto(photoUrl(row.item))} className="relative block h-[60px] w-[60px] overflow-hidden rounded-md bg-[#f5f5f5]">
              <Image src={photoUrl(row.item)} alt="" fill unoptimized className="object-cover" />
            </button>
          ) : null,
        ]}
      />
      {photo && <PhotoViewer src={photo} onClose={() => setPhoto(null)} />}
    </>
  )
}

export function RequestsTable({ rows, detailId, onRow, renderDetail, loading, error }: { rows: InventoryRequest[] } & Expand & ListState) {
  const { t, language } = useLanguage()
  const empty = useEmpty({ loading, error })
  return (
    <RefTable
      cols="minmax(0,5fr) minmax(0,10fr) minmax(0,11fr) minmax(0,14fr) minmax(0,13fr) minmax(0,10fr) minmax(0,11fr) minmax(0,10fr) minmax(0,11fr) minmax(0,5fr)"
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
