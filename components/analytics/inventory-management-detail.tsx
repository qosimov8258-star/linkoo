"use client"

import { useState, type ReactNode } from "react"
import Image from "next/image"
import { CheckCircle2, Clock3, ImageOff, Loader2, X, XCircle } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { ConfirmDialog, ErrorBlock, LoadingBlock, inputClass, mutationError } from "@/components/analytics/cash-management-shared"
import { ChangeDialog, ConfirmRequestDialog, ItemFormDialog } from "@/components/analytics/inventory-management-dialogs"
import { dayText, photoUrl, readAddressParam, timeText, writeAddressParams } from "@/components/analytics/inventory-management-shared"
import { RI, RefButton } from "@/components/ref/list-kit"
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
    <div className="px-4 py-[15px] md:px-[30px]">
      <p className="mb-[10px] font-semibold uppercase leading-[18px]">{title}:</p>
      <div className="whitespace-pre-line">{children}</div>
    </div>
  )
}

/** Full-size photo over the page (Linko's image viewer: a dark screen, the picture at the top, only its X closes it). */
export function PhotoViewer({ src, onClose }: { src: string | null; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[250] bg-black/70">
      <div className="relative mx-auto mt-[60px] h-[calc(100vh-120px)] w-[min(92vw,1000px)]">
        {src ? <Image src={src} alt="" fill unoptimized className="object-contain object-top" /> : <ImageOff className="mx-auto h-5 w-5 text-white/70" aria-hidden />}
      </div>
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-[18px] top-[18px] flex h-8 w-8 items-center justify-center text-white hover:opacity-80">
        <X className="h-7 w-7" />
      </button>
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

const actionButton = "inline-flex h-[30px] items-center gap-1.5 rounded-sm px-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"

function PanelShell({ title, onClose, actions, children }: { title: ReactNode; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="bg-white text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="relative flex min-h-[65px] flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-4 py-2 md:px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 cursor-pointer" aria-label={t("Закрыть")} />
        <h3 className="relative z-[1] truncate text-[18px] font-semibold text-[#333]">{title}</h3>
        {actions && <div className="relative z-[3] flex flex-wrap items-center justify-end gap-2.5">{actions}</div>}
      </div>
      <div className="flex flex-col md:flex-row">{children}</div>
    </div>
  )
}

// Material icons of the item card (Linko: reply, swap_horiz, check_circle, close).
const MD_REPLY = "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"
const MD_SWAP = "M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"
const MD_CHECK_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** A label / value line of the item card: no colon, no rule, the value bold on the right and blank when empty (Linko). */
function CardRow({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <li className="flex justify-between gap-x-3 leading-[25px]">
      <span>{label}</span>
      <span className="min-w-0 break-words text-right font-semibold">{children}</span>
    </li>
  )
}

/** The photo of the card (250 × 250 with Linko's 15 / 30 px padding); a file that is gone (`src` null) or does not load
 * keeps its frame, like Linko's broken image. */
function CardPhoto({ src, onOpen }: { src: string | null; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)
  const broken = failed || !src
  return (
    <div className="box-border h-[250px] w-[250px] shrink-0 px-[30px] py-[15px]">
      <button type="button" onClick={onOpen} className={`relative block h-full w-full cursor-pointer overflow-hidden ${broken ? "border border-[#c0c0c0]" : ""}`}>
        {broken ? (
          <ImageOff className="absolute left-1 top-1 h-4 w-4 text-[#9e9e9e]" aria-hidden />
        ) : (
          <Image src={src} alt="" fill unoptimized className="object-cover" onError={() => setFailed(true)} />
        )}
      </button>
    </div>
  )
}

type CardDialog = "edit" | "change" | "delete" | "photo"
/** The address parameter of each dialog of the card (written true / the photo id on open, false / 0 on close, like Linko). */
const DIALOG_PARAM: Record<CardDialog, string> = { edit: "openUpdateDialog", change: "openChangeDialog", delete: "openConfirmDialog", photo: "openImageDialog" }

/** The dialog a deep link opens (?openUpdateDialog=true, ?openChangeDialog=true, ?openConfirmDialog=true, ?openImageDialog=<id>). */
function dialogInAddress(): CardDialog | null {
  if (readAddressParam("openUpdateDialog") === "true") return "edit"
  if (readAddressParam("openChangeDialog") === "true") return "change"
  if (readAddressParam("openConfirmDialog") === "true") return "delete"
  return Number(readAddressParam("openImageDialog")) > 0 ? "photo" : null
}

/** The item card shown in place of its row (Linko #/inventory-management/<id>, module 4872). */
export function ItemDetailPanel({
  id,
  canEdit,
  options,
  onClose,
  onChanged,
  onDeleted,
  onHistory,
  onOpenClient,
  notify,
}: {
  id: number
  canEdit: boolean
  options: InventoryOptions | null
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
  onHistory: (id: number) => void
  /** «Клиент»: the shop drawer of the client (Linko ?openShop=<client id>). */
  onOpenClient: (id: number) => void
  notify: Notify
}) {
  const { t, language } = useLanguage()
  const detail = useCashJson<InventoryItemDetail>(`/api/inventory-items/${id}`)
  const [dialog, setDialogState] = useState<CardDialog | null>(dialogInAddress)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const data = detail.data

  if (detail.loading && !data) return <LoadingBlock className="py-10" />
  if (detail.error && !data) return <ErrorBlock error={detail.error} onRetry={detail.reload} />
  if (!data) return null

  const openDialog = (next: CardDialog) => {
    setError("")
    setDialogState(next)
    // Linko's viewer keeps the photo's file id (openImageDialog=10323); a photo uploaded here has none, its item id stands in.
    writeAddressParams({ [DIALOG_PARAM[next]]: next === "photo" ? String(data.photoId ?? data.id) : "true" })
  }
  const closeDialog = () => {
    if (dialog) writeAddressParams({ [DIALOG_PARAM[dialog]]: dialog === "photo" ? "0" : "false" })
    setDialogState(null)
  }
  const saved = (text: string) => {
    closeDialog()
    notify(t(text))
    detail.reload()
    onChanged()
  }
  const review = async () => {
    setBusy(true)
    const result = await cashMutate("POST", `/api/inventory-items/${id}/review`, { isReviewed: !data.isReviewed })
    setBusy(false)
    if (!result.ok) return notify(mutationError(result, t), true)
    notify(t("Успешно сохранено"))
    detail.reload()
    onChanged()
  }
  const remove = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate("DELETE", `/api/inventory-items/${id}`)
    setBusy(false)
    if (!result.ok) return setError(result.status === 409 ? t("Удаление невозможно из-за связи с другими данными") : mutationError(result, t))
    closeDialog()
    notify(t("Успешно Удалено"))
    onDeleted()
  }
  const live = canEdit && !data.deleted
  const reviewLabel = data.isReviewed ? t("Не одобрить") : t("Одобрить")
  const clientId = data.client?.id ?? null

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
          {/* Linko's flat buttons keep 8 px on their right on top of the 10 px gap. */}
          <span className="mr-2 flex">
            <RefButton icon={MD_REPLY} label={t("Просмотреть")} onClick={() => onHistory(data.id)} />
          </span>
          {live && (
            <>
              <span className="mr-2 flex">
                <RefButton icon={MD_SWAP} label={t("Передача / Изъятие")} onClick={() => openDialog("change")} />
              </span>
              <span className="mr-2 flex">
                <RefButton icon={RI.edit} label={t("Изменить")} onClick={() => openDialog("edit")} />
              </span>
              <button type="button" disabled={busy} onClick={() => void review()} title={reviewLabel} aria-label={reviewLabel} className="flex h-12 w-12 items-center justify-center disabled:cursor-wait">
                {busy && dialog === null ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[#9e9e9e]" />
                ) : (
                  <svg viewBox="0 0 24 24" className={`h-5 w-5 ${data.isReviewed ? "fill-[#e66767]" : "fill-[#71ce87]"}`} aria-hidden>
                    <path d={data.isReviewed ? RI.close : MD_CHECK_CIRCLE} />
                  </svg>
                )}
              </button>
              <button type="button" onClick={() => openDialog("delete")} title={t("Удалить")} aria-label={t("Удалить")} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]" aria-hidden>
                  <path d={RI.trash} />
                </svg>
              </button>
            </>
          )}
        </>
      }
    >
      <div className="border-b border-[#efefef] px-4 pb-[29px] pt-[15px] md:w-[340px] md:shrink-0 md:border-b-0 md:border-r md:px-[30px]">
        <ul>
          <CardRow label={t("Склад")}>{data.warehouse}</CardRow>
          <CardRow label={t("Тип")}>{data.product.name}</CardRow>
          <CardRow label={t("Состояние")}>{data.condition ? t(data.condition) : ""}</CardRow>
          <CardRow label={t("Клиент")}>
            <span
              role="link"
              tabIndex={clientId ? 0 : -1}
              onClick={() => clientId && onOpenClient(clientId)}
              onKeyDown={(event) => event.key === "Enter" && clientId && onOpenClient(clientId)}
              className="cursor-pointer text-[13px] font-semibold text-[rgb(79,113,220)]"
            >
              {data.client?.name ?? ""}
            </span>
          </CardRow>
          <CardRow label={t("Серийный номер")}>{data.serialNumber}</CardRow>
          <CardRow label={t("Инвентарный номер")}>{data.stockNumber}</CardRow>
          <CardRow label={t("Дата прикрепления")}>{dayText(data.date, language)}</CardRow>
          <CardRow label={t("Дата создания")}>{dayText(data.createdAt, language)}</CardRow>
          {/* Linko: a 24 px inline icon on the 25 px line, so this row is 32 px high. */}
          <CardRow label={t("Одобрено")}>
            <span title={data.reviewedAt ? [data.reviewedBy, timeText(data.reviewedAt, language)].filter(Boolean).join(", ") : undefined}>
              <svg viewBox="0 0 24 24" role="img" aria-label={data.isReviewed ? t("Одобрено") : t("Не одобрено")} className={`inline-block h-6 w-6 align-baseline ${data.isReviewed ? "fill-[#71ce87]" : "fill-[#e66767]"}`}>
                <path d={data.isReviewed ? MD_CHECK_CIRCLE : RI.close} />
              </svg>
            </span>
          </CardRow>
        </ul>
      </div>
      <div className="min-w-0 flex-1">
        <Block title={t("Ответственный")}>{data.responsible}</Block>
        {data.comment && <Block title={t("Комментарий")}>{data.comment}</Block>}
      </div>
      {data.hasPhoto && <CardPhoto key={data.version} src={data.photoReady ? photoUrl(data) : null} onOpen={() => openDialog("photo")} />}

      {dialog === "edit" && <ItemFormDialog item={data} options={options} onClose={closeDialog} onSaved={() => saved("Успешно сохранено")} />}
      {dialog === "change" && <ChangeDialog item={data} options={options} onClose={closeDialog} onSaved={() => saved("Успешно сохранено")} />}
      {dialog === "photo" && data.hasPhoto && <PhotoViewer src={data.photoReady ? photoUrl(data) : null} onClose={closeDialog} />}
      {dialog === "delete" && <ConfirmDialog title={`№ ${data.id}`} dismissible={false} busy={busy} error={error} onConfirm={() => void remove()} onClose={closeDialog} />}
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
