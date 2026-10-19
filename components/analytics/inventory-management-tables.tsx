"use client"

import { Fragment, useState, type ReactNode } from "react"
import Image from "next/image"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Info, Loader2 } from "lucide-react"

import { PhotoViewer, RequestStatusIcon, RequestTypeBadge } from "@/components/analytics/inventory-management-detail"
import { ReviewIcon, dayText, itemTitle, photoUrl, timeText } from "@/components/analytics/inventory-management-shared"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { INVENTORY_LOG_LABELS, type InventoryCheck, type InventoryItem, type InventoryLog, type InventoryRequest, type InventoryTotals } from "@/lib/inventory-items-types"

// The four lists of "Работа с инвентарем" (demo module 4859): items (X:
// № | Серийный № | Клиент | Тип инвентаря | Склад | Дата прикрепления | Дата
// проверки), "История движений" (Z), "История проверки" (J) and "Запросы" (Q),
// plus the blue totals bar (module 4870: Одобрено / Не одобрено / Итого).

const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
const td = "px-3 py-3 align-middle"

function SortHeader({ ordering, sortKey, onSort, children }: { ordering: string; sortKey: string; onSort: (key: string) => void; children: ReactNode }) {
  const icon = ordering === sortKey ? <ArrowUp className="h-3.5 w-3.5" /> : ordering === `-${sortKey}` ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
  return (
    <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 font-semibold">
      {children}
      {icon}
    </button>
  )
}

function EmptyRow({ colSpan, loading, error }: { colSpan: number; loading: boolean; error: boolean }) {
  const { t } = useLanguage()
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16 text-center text-[#9aa3b6]">
        {loading ? t("Загрузка...") : error ? "" : t("По вашему запросу ничего не найдено")}
      </td>
    </tr>
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
    <div className="relative bg-[#5869f0] p-[5px] shadow-[0_2px_8px_rgba(99,99,99,0.2)]">
      {loading && !totals ? (
        <div className="flex h-8 items-center justify-center text-white">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-1 py-1.5 text-[13px] font-semibold text-white sm:grid-cols-3">
          <span className="text-center">
            {t("Одобрено")}: {formatMoney(totals?.reviewed ?? 0, 0)}
          </span>
          <span className="text-center">
            {t("Не одобрено")}: {formatMoney(totals?.notReviewed ?? 0, 0)}
          </span>
          <span className="text-center">
            {t("Итого")}: {formatMoney(totals?.total ?? 0, 0)}
          </span>
        </div>
      )}
    </div>
  )
}

type Expand = { detailId: number | null; onRow: (id: number) => void; renderDetail: (id: number) => ReactNode }
type ListState = { loading: boolean; error: boolean }

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
  const allChecked = rows.length > 0 && rows.every((row) => selected.includes(row.id))
  const colSpan = selectable ? 8 : 7
  return (
    <table className="w-full min-w-[980px] border-collapse text-[14px]">
      <thead>
        <tr className="border-b border-[#e1e5eb] text-[#17233b]">
          {selectable && (
            <th className="w-10 pl-6">
              <input
                type="checkbox"
                aria-label={t("Выбрать все")}
                checked={allChecked}
                onChange={() => onSelect(allChecked ? selected.filter((id) => !rows.some((row) => row.id === id)) : [...new Set([...selected, ...rows.map((row) => row.id)])])}
                className="h-4 w-4 accent-[#4f70e7]"
              />
            </th>
          )}
          <th className={`${th} w-[8%] ${selectable ? "" : "pl-6"}`}>
            <SortHeader ordering={ordering} sortKey="id" onSort={onSort}>
              №
            </SortHeader>
          </th>
          <th className={`${th} w-[15%]`}>{t("Серийный №")}</th>
          <th className={`${th} w-[17%]`}>{t("Клиент")}</th>
          <th className={`${th} w-[18%]`}>{t("Тип инвентаря")}</th>
          <th className={`${th} w-[14%]`}>{t("Склад")}</th>
          <th className={`${th} w-[13%]`}>
            <SortHeader ordering={ordering} sortKey="date" onSort={onSort}>
              {t("Дата прикрепления")}
            </SortHeader>
          </th>
          <th className={`${th} w-[15%] pr-6 text-right`}>{t("Дата проверки")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const open = detailId === row.id
          return (
            <Fragment key={row.id}>
              <tr onClick={() => onRow(row.id)} className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"} ${row.deleted ? "text-[#9aa3b6] line-through decoration-[#e57373]/60" : ""}`}>
                {selectable && (
                  <td className="pl-6" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`№ ${row.id}`}
                      disabled={row.deleted}
                      checked={selected.includes(row.id)}
                      onChange={() => onSelect(selected.includes(row.id) ? selected.filter((id) => id !== row.id) : [...selected, row.id])}
                      className="h-4 w-4 accent-[#4f70e7]"
                    />
                  </td>
                )}
                <td className={`${td} font-semibold ${selectable ? "" : "pl-6"}`}>
                  {row.id}
                  <Comment text={row.comment} />
                </td>
                <td className={td}>{row.serialNumber}</td>
                <td className={td}>{row.client?.name ?? ""}</td>
                <td className={td}>
                  {row.product.name}
                  {row.stockNumber && (
                    <span title={t("Инвентарный №")} className="block text-[13px] text-[#4f71dc]">
                      {row.stockNumber}
                    </span>
                  )}
                </td>
                <td className={td}>{row.warehouse}</td>
                <td className={`${td} whitespace-nowrap`}>{dayText(row.date, language)}</td>
                <td className={`${td} pr-6`}>
                  <span className="flex items-center justify-end gap-2.5 whitespace-nowrap">
                    {dayText(row.reviewedAt || row.createdAt, language)}
                    <ReviewIcon reviewed={row.isReviewed} t={t} />
                  </span>
                </td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={colSpan} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                    {renderDetail(row.id)}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {!rows.length && <EmptyRow colSpan={colSpan} loading={loading} error={error} />}
      </tbody>
    </table>
  )
}

export function LogsTable({ rows, ordering, onSort, loading, error }: { rows: InventoryLog[]; ordering: string; onSort: (key: string) => void } & ListState) {
  const { t, language } = useLanguage()
  return (
    <table className="w-full min-w-[980px] border-collapse text-[14px]">
      <thead>
        <tr className="border-b border-[#e1e5eb] text-[#17233b]">
          <th className={`${th} w-[25%] pl-6`}>{t("Инвентарь")}</th>
          <th className={`${th} w-[16%]`}>
            <SortHeader ordering={ordering} sortKey="created_date" onSort={onSort}>
              {t("Дата создания")}
            </SortHeader>
          </th>
          <th className={`${th} w-[11%]`}>
            <SortHeader ordering={ordering} sortKey="date" onSort={onSort}>
              {t("Дата движения")}
            </SortHeader>
          </th>
          <th className={`${th} w-[18%] text-center`}>
            <SortHeader ordering={ordering} sortKey="client" onSort={onSort}>
              {t("Клиент")}
            </SortHeader>
          </th>
          <th className={`${th} w-[11%]`}>{t("Склад")}</th>
          <th className={`${th} w-[9%]`}>{t("Состояние")}</th>
          <th className={`${th} w-[10%] pr-6`}>{t("Тип")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-[#efefef] hover:bg-[#f2f5f8]">
            <td className={`${td} pl-6`}>
              <span className="flex items-center gap-1.5">
                {row.status === "take" ? <ArrowLeft className="h-4 w-4 shrink-0 text-[#e57373]" /> : <ArrowRight className="h-4 w-4 shrink-0 text-[#81c784]" />}
                <span className={row.item.deleted ? "text-[#9aa3b6] line-through" : ""}>{itemTitle(row.item)}</span>
              </span>
            </td>
            <td className={`${td} whitespace-nowrap`}>{timeText(row.createdAt, language)}</td>
            <td className={`${td} whitespace-nowrap`}>{dayText(row.date, language)}</td>
            <td className={`${td} text-center`}>{row.client?.name ?? ""}</td>
            <td className={td}>{row.warehouse}</td>
            <td className={td}>{t(row.condition)}</td>
            <td className={`${td} pr-6`}>
              <span className="flex items-center gap-2 whitespace-nowrap" title={row.createdBy ? `${t("Создал")}: ${row.createdBy}` : undefined}>
                {row.comment && (
                  <span title={row.comment}>
                    <Info className="h-4 w-4 text-[rgb(79,113,220)]" />
                  </span>
                )}
                {t(INVENTORY_LOG_LABELS[row.status])}
              </span>
            </td>
          </tr>
        ))}
        {!rows.length && <EmptyRow colSpan={7} loading={loading} error={error} />}
      </tbody>
    </table>
  )
}

export function ChecksTable({ rows, loading, error }: { rows: InventoryCheck[] } & ListState) {
  const { t, language } = useLanguage()
  const [photo, setPhoto] = useState<string | null>(null)
  return (
    <>
      <table className="w-full min-w-[900px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-[#e1e5eb] text-[#17233b]">
            <th className={`${th} w-[8%] pl-6`}>№</th>
            <th className={`${th} w-[18%]`}>{t("Клиент")}</th>
            <th className={`${th} w-[16%]`}>{t("Создал")}</th>
            <th className={`${th} w-[18%]`}>{t("Дата проверки")}</th>
            <th className={`${th} w-[25%]`}>{t("Инвентарь")}</th>
            <th className={`${th} w-[15%] pr-6`}>{t("Изображений")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[#efefef] hover:bg-[#f2f5f8]">
              <td className={`${td} pl-6 font-semibold`}>
                {row.id}
                <Comment text={row.comment} />
              </td>
              <td className={td}>{row.client?.name ?? ""}</td>
              <td className={td}>{row.createdBy || t("Не указан")}</td>
              <td className={td}>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {row.createdAt ? timeText(row.createdAt, language) : t("Не указано")}
                  <ReviewIcon reviewed={row.isReviewed} t={t} className="h-4 w-4" />
                </span>
              </td>
              <td className={td}>
                <span className={row.item.deleted ? "text-[#9aa3b6] line-through" : ""}>{itemTitle(row.item)}</span>
              </td>
              <td className={`${td} pr-6`}>
                {row.item.hasPhoto && (
                  <button type="button" onClick={() => setPhoto(photoUrl(row.item))} className="relative block h-[60px] w-[60px] overflow-hidden rounded-md bg-[#f5f5f5]">
                    <Image src={photoUrl(row.item)} alt="" fill unoptimized className="object-cover" />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && <EmptyRow colSpan={6} loading={loading} error={error} />}
        </tbody>
      </table>
      {photo && <PhotoViewer src={photo} onClose={() => setPhoto(null)} />}
    </>
  )
}

export function RequestsTable({ rows, detailId, onRow, renderDetail, loading, error }: { rows: InventoryRequest[] } & Expand & ListState) {
  const { t, language } = useLanguage()
  return (
    <table className="w-full min-w-[1100px] border-collapse text-[14px]">
      <thead>
        <tr className="border-b border-[#e1e5eb] text-[#17233b]">
          <th className={`${th} w-[5%] pl-6`}>№</th>
          <th className={`${th} w-[10%]`}>{t("Тип")}</th>
          <th className={`${th} w-[11%]`}>{t("Клиент")}</th>
          <th className={`${th} w-[14%]`}>{t("Тип инвентаря")}</th>
          <th className={`${th} w-[13%]`}>{t("Инвентарь")}</th>
          <th className={`${th} w-[10%]`}>{t("Запросил")}</th>
          <th className={`${th} w-[11%]`}>{t("Дата запроса")}</th>
          <th className={`${th} w-[10%]`}>{t("Обработал")}</th>
          <th className={`${th} w-[11%]`}>{t("Дата обработки")}</th>
          <th className={`${th} w-[5%] pr-6 text-center`}>{t("Статус")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const open = detailId === row.id
          return (
            <Fragment key={row.id}>
              <tr onClick={() => onRow(row.id)} className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}>
                <td className={`${td} pl-6 font-semibold`}>{row.id}</td>
                <td className={td}>
                  <RequestTypeBadge type={row.type} />
                </td>
                <td className={td}>{row.client?.name ?? ""}</td>
                <td className={td}>{row.product?.name ?? ""}</td>
                <td className={td}>{row.item ? `№${row.item.id} (${row.item.serialNumber || "—"})` : ""}</td>
                <td className={td}>{row.requestedBy}</td>
                <td className={`${td} whitespace-nowrap`}>{row.createdAt ? timeText(row.createdAt, language) : t("Не указано")}</td>
                <td className={td}>{row.updatedBy}</td>
                <td className={`${td} whitespace-nowrap`}>{row.updatedAt ? timeText(row.updatedAt, language) : t("Не указано")}</td>
                <td className={`${td} pr-6`}>
                  <span className="flex justify-center">
                    <RequestStatusIcon status={row.status} />
                  </span>
                </td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={10} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                    {renderDetail(row.id)}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
        {!rows.length && <EmptyRow colSpan={10} loading={loading} error={error} />}
      </tbody>
    </table>
  )
}
