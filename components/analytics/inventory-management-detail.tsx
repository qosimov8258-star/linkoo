"use client"

import { useState, type ReactNode } from "react"
import Image from "next/image"
import { ArrowLeftRight, CheckCircle2, Clock3, Eye, Pencil, Trash2, X, XCircle } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, ErrorBlock, LoadingBlock, inputClass, mutationError } from "@/components/analytics/cash-management-shared"
import { ChangeDialog, ConfirmRequestDialog, ItemFormDialog } from "@/components/analytics/inventory-management-dialogs"
import { ReviewIcon, dayText, photoUrl, timeText } from "@/components/analytics/inventory-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  INVENTORY_REQUEST_STATUS_LABELS,
  INVENTORY_REQUEST_TYPE_LABELS,
  type InventoryItemDetail,
  type InventoryOptions,
  type InventoryRequest,
  type InventoryRequestStatus,
  type InventoryRequestType,
} from "@/lib/inventory-items-types"

// Detail panels shown in place of the clicked row: the item (demo module 4861:
// Просмотреть → "История движений" of the item, "Передача / Изъятие",
// "Изменить", Одобрить / Не одобрить, Удалить) and the request (module 4867:
// Подтвердить / Отклонить while "В процессе").

type Notify = (text: string, error?: boolean) => void

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap justify-between gap-x-3 border-b border-dashed border-[#e1e5eb] py-1.5 leading-[22px] last:border-none">
      <span className="text-[#586174]">{label}:</span>
      <span className="max-w-[70%] text-right font-semibold text-[#17233b]">{children || "—"}</span>
    </li>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-[#efefef] px-4 py-4 last:border-none md:px-[30px]">
      <p className="mb-2 font-semibold uppercase">{title}:</p>
      <div className="whitespace-pre-line">{children}</div>
    </div>
  )
}

/** Full-size photo over the page (demo image dialog / slideshow). */
export function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="relative h-[min(80vh,720px)] w-[min(92vw,720px)] bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <Image src={src} alt="" fill unoptimized className="object-contain" />
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-[#586174] hover:text-[#17233b]">
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export function RequestTypeBadge({ type }: { type: InventoryRequestType }) {
  const { t } = useLanguage()
  const attach = type === "attach"
  return (
    <span className={`inline-block w-max whitespace-nowrap rounded-lg border px-2 py-0.5 text-[13px] leading-[18px] ${attach ? "border-[#71ce87] text-[#71ce87]" : "border-[#e57373] text-[#e57373]"}`}>
      {t(INVENTORY_REQUEST_TYPE_LABELS[type])}
    </span>
  )
}

export function RequestStatusIcon({ status }: { status: InventoryRequestStatus }) {
  const { t } = useLanguage()
  const label = t(INVENTORY_REQUEST_STATUS_LABELS[status])
  const icon = status === "confirmed" ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : status === "canceled" ? <XCircle className="h-5 w-5 text-red-600" /> : <Clock3 className="h-5 w-5 text-[#facc15]" />
  return (
    <span title={label} role="img" aria-label={label} className="inline-flex">
      {icon}
    </span>
  )
}

const STATUS_COLOR: Record<InventoryRequestStatus, string> = { confirmed: "text-green-600", canceled: "text-red-600", pending: "text-[#d4a40a]" }

const iconButton = "flex h-10 w-10 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8] disabled:cursor-not-allowed disabled:opacity-40"
const actionButton = "inline-flex h-[30px] items-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"

function PanelShell({ title, onClose, actions, children }: { title: ReactNode; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="bg-white text-[14px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex min-h-[65px] flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-4 py-2 md:px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] truncate text-[18px] font-semibold text-[#333]">{title}</h3>
        {actions && <div className="relative z-[3] flex flex-wrap items-center justify-end gap-2.5">{actions}</div>}
      </div>
      <div className="flex flex-col md:flex-row">{children}</div>
    </div>
  )
}

export function ItemDetailPanel({
  id,
  canEdit,
  options,
  onClose,
  onChanged,
  onDeleted,
  onHistory,
  onFilterClient,
  notify,
}: {
  id: number
  canEdit: boolean
  options: InventoryOptions | null
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
  onHistory: (id: number) => void
  onFilterClient: (id: number) => void
  notify: Notify
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<InventoryItemDetail>(`/api/inventory-items/${id}`)
  const [dialog, setDialog] = useState<"edit" | "change" | "delete" | "photo" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = detail.data

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const saved = (text: string) => {
    setDialog(null)
    notify(t(text))
    detail.reload()
    onChanged()
  }
  const review = async () => {
    setBusy(true)
    const result = await cashMutate("POST", `/api/inventory-items/${id}/review`, { isReviewed: !data.isReviewed })
    setBusy(false)
    if (!result.ok) return notify(mutationError(result, t), true)
    saved("Успешно сохранено")
  }
  const remove = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate("DELETE", `/api/inventory-items/${id}`)
    setBusy(false)
    if (!result.ok) return setError(result.status === 409 ? t("Удаление невозможно из-за связи с другими данными") : mutationError(result, t))
    setDialog(null)
    notify(t("Успешно Удалено"))
    onDeleted()
  }
  const live = canEdit && !data.deleted
  const reviewLabel = data.isReviewed ? t("Не одобрить") : t("Одобрить")

  return (
    <PanelShell
      title={
        <>
          № {data.id}
          {data.deleted && <span className="ml-3 rounded bg-[#fdecec] px-2 py-0.5 text-[12px] font-semibold text-[#d64545]">{t("Удален")}</span>}
        </>
      }
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={() => onHistory(data.id)} className={`${actionButton} bg-[rgb(79,113,220)]`}>
            <Eye className="h-4 w-4" /> {t("Просмотреть")}
          </button>
          {live && (
            <>
              <button type="button" onClick={() => setDialog("change")} className={`${actionButton} bg-[rgb(79,113,220)]`}>
                <ArrowLeftRight className="h-4 w-4" /> {t("Передача / Изъятие")}
              </button>
              <button type="button" onClick={() => setDialog("edit")} className={`${actionButton} bg-[rgb(79,113,220)]`}>
                <Pencil className="h-4 w-4" /> {t("Изменить")}
              </button>
              <button type="button" disabled={busy} onClick={() => void review()} title={reviewLabel} aria-label={reviewLabel} className={iconButton}>
                {data.isReviewed ? <XCircle className="h-5 w-5 text-[#e66767]" /> : <CheckCircle2 className="h-5 w-5 text-[#71ce87]" />}
              </button>
              <button type="button" onClick={() => setDialog("delete")} title={t("Удалить")} aria-label={t("Удалить")} className={iconButton}>
                <Trash2 className="h-5 w-5" />
              </button>
            </>
          )}
        </>
      }
    >
      <div className="border-b border-[#efefef] px-4 py-4 md:w-[340px] md:shrink-0 md:border-b-0 md:border-r md:px-[30px]">
        <ul>
          <InfoRow label={t("Склад")}>{data.warehouse}</InfoRow>
          <InfoRow label={t("Тип")}>{data.product.name}</InfoRow>
          <InfoRow label={t("Состояние")}>{t(data.condition)}</InfoRow>
          <InfoRow label={t("Клиент")}>
            {data.client ? (
              data.client.id ? (
                <button type="button" onClick={() => onFilterClient(data.client!.id!)} className="text-[rgb(79,113,220)] hover:underline">
                  {data.client.name}
                </button>
              ) : (
                data.client.name
              )
            ) : (
              t("На складе")
            )}
          </InfoRow>
          <InfoRow label={t("Серийный номер")}>{data.serialNumber}</InfoRow>
          <InfoRow label={t("Инвентарный номер")}>{data.stockNumber}</InfoRow>
          <InfoRow label={t("Дата прикрепления")}>{dayText(data.date, language)}</InfoRow>
          <InfoRow label={t("Дата создания")}>{dayText(data.createdAt, language)}</InfoRow>
          <InfoRow label={t("Одобрено")}>
            <span className="inline-flex items-center gap-2">
              {data.reviewedAt && <span className="text-[12px] font-normal text-[#586174]">{[data.reviewedBy, timeText(data.reviewedAt, language)].filter(Boolean).join(", ")}</span>}
              <ReviewIcon reviewed={data.isReviewed} t={t} />
            </span>
          </InfoRow>
        </ul>
      </div>
      <div className="min-w-0 flex-1">
        <Block title={t("Ответственный")}>{data.responsible || "—"}</Block>
        {data.comment && <Block title={t("Комментарий")}>{data.comment}</Block>}
      </div>
      {data.hasPhoto && (
        <div className="px-4 py-4 md:w-[250px] md:shrink-0 md:px-[30px]">
          <button type="button" onClick={() => setDialog("photo")} className="relative block h-[190px] w-[190px] overflow-hidden rounded-md">
            <Image src={photoUrl(data)} alt="" fill unoptimized className="object-cover" />
          </button>
        </div>
      )}

      {dialog === "edit" && <ItemFormDialog item={data} options={options} onClose={() => setDialog(null)} onSaved={() => saved("Успешно сохранено")} />}
      {dialog === "change" && <ChangeDialog item={data} options={options} onClose={() => setDialog(null)} onSaved={() => saved("Успешно сохранено")} />}
      {dialog === "photo" && <PhotoViewer src={photoUrl(data)} onClose={() => setDialog(null)} />}
      {dialog === "delete" && (
        <ConfirmDialog
          title={t("Подтверждение удаления")}
          text={`${t("Вы уверены что хотите удалить эти данные?")} (№ ${data.id})`}
          busy={busy}
          error={error}
          onConfirm={() => void remove()}
          onClose={() => setDialog(null)}
        />
      )}
    </PanelShell>
  )
}

export function RequestDetailPanel({
  id,
  canEdit,
  options,
  onClose,
  onChanged,
  notify,
}: {
  id: number
  canEdit: boolean
  options: InventoryOptions | null
  onClose: () => void
  onChanged: () => void
  notify: Notify
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<InventoryRequest>(`/api/inventory-items/requests/${id}`)
  const [dialog, setDialog] = useState<"confirm" | "cancel" | null>(null)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = detail.data

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const done = (text: string) => {
    setDialog(null)
    notify(t(text))
    detail.reload()
    onChanged()
  }
  const reject = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate("POST", `/api/inventory-items/requests/${id}/cancel`, { reason })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    done("Успешно отклонено")
  }

  return (
    <PanelShell
      title={`№ ${data.id}`}
      onClose={onClose}
      actions={
        canEdit && data.status === "pending" ? (
          <>
            <button type="button" onClick={() => setDialog("confirm")} className={`${actionButton} bg-[rgb(79,113,220)]`}>
              {t("Подтвердить")}
            </button>
            <button
              type="button"
              onClick={() => {
                setReason("")
                setError("")
                setDialog("cancel")
              }}
              className={`${actionButton} bg-[#fa8072]`}
            >
              {t("Отклонить")}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="border-b border-[#efefef] px-4 py-4 md:w-[400px] md:shrink-0 md:border-b-0 md:border-r md:px-[30px]">
        <ul>
          <InfoRow label={t("Тип")}>
            <RequestTypeBadge type={data.type} />
          </InfoRow>
          <InfoRow label={t("Клиент")}>{data.client?.name}</InfoRow>
          <InfoRow label={t("Инвентарь")}>
            {data.item ? (
              <a href={`?status=all&gear=${data.item.id}&showDeleted=1&id=${data.item.id}`} target="_blank" rel="noreferrer" className="text-[rgb(79,113,220)] hover:underline">
                №{data.item.id} ({data.item.serialNumber || "—"})
              </a>
            ) : null}
          </InfoRow>
          <InfoRow label={t("Запросил")}>{data.requestedBy}</InfoRow>
          <InfoRow label={t("Дата запроса")}>{timeText(data.createdAt, language)}</InfoRow>
          <InfoRow label={t("Обработал")}>{data.updatedBy}</InfoRow>
          <InfoRow label={t("Дата обработки")}>{data.updatedAt ? timeText(data.updatedAt, language) : t("Не указано")}</InfoRow>
          <InfoRow label={t("Статус")}>
            <span className={STATUS_COLOR[data.status]}>{t(INVENTORY_REQUEST_STATUS_LABELS[data.status])}</span>
          </InfoRow>
          {data.reason && <InfoRow label={t("Причина")}>{data.reason}</InfoRow>}
        </ul>
      </div>
      <div className="min-w-0 flex-1">
        <Block title={t("Тип инвентаря")}>{data.product?.name || "—"}</Block>
        <Block title={t("Комментарий")}>{data.comment || "—"}</Block>
      </div>

      {dialog === "confirm" && <ConfirmRequestDialog request={data} options={options} onClose={() => setDialog(null)} onSaved={() => done("Успешно сохранено")} />}
      {dialog === "cancel" && (
        <ConfirmDialog
          title={t("Отклонить")}
          text={`${t("Вы уверены что хотите отклонить запрос?")} (№ ${data.id})`}
          confirmLabel="Отклонить"
          busy={busy}
          error={error}
          onConfirm={() => void reject()}
          onClose={() => setDialog(null)}
        >
          <label className="mt-3 flex flex-col gap-1 text-[13px] text-[#586174]">
            {t("Причина")}
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={2000} className={`${inputClass} h-auto py-2`} />
          </label>
        </ConfirmDialog>
      )}
    </PanelShell>
  )
}
