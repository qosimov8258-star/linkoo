"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ChevronDown, X } from "lucide-react"

import { CheckBox, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import type { Client } from "@/components/clients/clients-data"
import type { Order } from "@/components/orders/orders-data"
import { formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { LAST_LOCATION_ID, type StartLocation } from "@/lib/tracking-types"

import { STATUS_OPTIONS, type DetailStatus } from "./agents-tracking-data"

// Dialogs of the agent detail: the status filter, ОПТИМИЗАЦИЯ МАРШРУТА, ИЗМЕНЕНИЕ ВЫБРАННЫХ
// КЛИЕНТОВ (location lock), the photo report / refusal viewer, the order summary and the
// client card. Every dialog closes on Escape and on its X.

type Option = { id: number; label: string }

/** API error body → translated text. */
async function errorText(response: Response, t: (text: string) => string, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return t(body?.error || fallback)
}

function useEscape(onClose: () => void) {
  const ref = useRef(onClose)
  useEffect(() => {
    ref.current = onClose
  }, [onClose])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") ref.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
}

/** Underlined select of id options (no first-item preselect), clearable. */
function IdSelect({ label, value, options, onChange, error }: { label: string; value: number | null; options: Option[]; onChange: (value: number | null) => void; error?: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const selected = options.find((option) => option.id === value)
  return (
    <div ref={rootRef} className="relative mb-[14px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className={`relative block h-[44px] w-full border-b text-left ${error ? "border-[#e53935]" : "border-[#d5dae1]"}`}>
        <span className={`absolute left-0 ${selected ? "top-0 text-[10px] font-semibold leading-3" : "top-[20px] text-[13px] font-bold leading-4"}`}>{t(label)}</span>
        {selected && <span className="absolute inset-x-0 bottom-[6px] truncate pr-12 text-[13px]">{selected.label}</span>}
        <span className="absolute bottom-[8px] right-0 flex items-center gap-[10px] text-slate-500">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("Очистить")}
              onClick={(event) => {
                event.stopPropagation()
                onChange(null)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.stopPropagation()
                  onChange(null)
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4" />
        </span>
      </button>
      {error && <p className="mt-1 text-[11px] text-[#e53935]">{error}</p>}
      {open && (
        <ul className="absolute left-0 right-0 z-30 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-slate-400">{t("Нет данных")}</li>
          ) : (
            options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.id)
                    setOpen(false)
                  }}
                  className={`block w-full px-3 py-2 text-left font-semibold ${option.id === value ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

/** "Фильтр" panel of the agent detail: one select, Статус. */
export function StatusFilterPanel({ value, onApply, onClose }: { value: DetailStatus; onApply: (value: DetailStatus) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<DetailStatus>(value)
  useEscape(onClose)
  const options = STATUS_OPTIONS.map((option, index) => ({ id: index, label: t(option.label) }))
  const current = STATUS_OPTIONS.findIndex((option) => option.id === draft)
  return (
    <div role="dialog" aria-label={t("Фильтр")} className="absolute right-[10px] top-[52px] z-[700] w-[300px] bg-white p-[18px] text-[13px] text-[#333] shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
      <div className="mb-[14px] flex items-center justify-between">
        <b className="text-[15px]">{t("Фильтр")}</b>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
          <X className="h-5 w-5" />
        </button>
      </div>
      <IdSelect label="Статус" value={current < 0 ? null : current} options={options} onChange={(index) => setDraft(index === null ? "all" : STATUS_OPTIONS[index].id)} />
      <div className="flex justify-end">
        <SaveButton
          onClick={() => {
            onApply(draft)
            onClose()
          }}
        >
          {t("Применить")}
        </SaveButton>
      </div>
    </div>
  )
}

type OptimizeField = "startClientId" | "finishClientId" | "startLocationId" | "finishLocationId"

/** ОПТИМИЗАЦИЯ МАРШРУТА: start / finish client and location → POST …/optimize. */
export function OptimizeDialog({
  employeeId,
  date,
  clients,
  onClose,
  onSaved,
}: {
  employeeId: number
  date: string
  clients: Option[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [values, setValues] = useState<Record<OptimizeField, number | null>>({ startClientId: null, finishClientId: null, startLocationId: null, finishLocationId: null })
  const [locations, setLocations] = useState<StartLocation[]>([])
  const [loadError, setLoadError] = useState("")
  const [error, setError] = useState<{ field?: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tracking/agents/${employeeId}/start-locations?date=${date}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorText(response, t, "Не удалось загрузить данные"))
        return (await response.json()) as { rows: StartLocation[] }
      })
      .then((body) => {
        if (!cancelled) setLocations(body.rows)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : t("Не удалось загрузить данные"))
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, date, t])

  const locationOptions = locations.map((location) => ({ id: location.id, label: location.id === LAST_LOCATION_ID ? t(location.name) : location.name }))
  const set = (field: OptimizeField) => (value: number | null) => {
    setValues((current) => ({ ...current, [field]: value }))
    setError((current) => (current?.field === field ? null : current))
  }

  async function save() {
    if (saving) return
    if (values.startClientId !== null && values.startClientId === values.finishClientId && clients.length > 1) {
      setError({ field: "finishClientId", text: t("Стартовый и финишный магазин совпадают") })
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/tracking/agents/${employeeId}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, ...values }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; field?: string } | null
        setError({ field: body?.field, text: t(body?.error || "Не удалось сохранить") })
        return
      }
      onSaved()
    } catch {
      setError({ text: t("Не удалось сохранить") })
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: OptimizeField) => (error?.field === field ? error.text : undefined)
  return (
    <Modal
      title="Оптимизация маршрута"
      onClose={onClose}
      footer={
        <SaveButton disabled={saving} onClick={() => void save()}>
          {saving ? t("Сохранение...") : t("Сохранить")}
        </SaveButton>
      }
    >
      <IdSelect label="Начать с магазина" value={values.startClientId} options={clients} onChange={set("startClientId")} error={fieldError("startClientId")} />
      <IdSelect label="Финишный магазин" value={values.finishClientId} options={clients} onChange={set("finishClientId")} error={fieldError("finishClientId")} />
      <IdSelect label="Стартовая локация" value={values.startLocationId} options={locationOptions} onChange={set("startLocationId")} error={fieldError("startLocationId")} />
      <IdSelect label="Финишная локация" value={values.finishLocationId} options={locationOptions} onChange={set("finishLocationId")} error={fieldError("finishLocationId")} />
      {loadError && <p className="text-[12px] text-[#e53935]">{loadError}</p>}
      {error && !error.field && <p className="text-[12px] text-[#e53935]">{error.text}</p>}
    </Modal>
  )
}

/** ИЗМЕНЕНИЕ ВЫБРАННЫХ КЛИЕНТОВ: lock or unlock the location of the ticked clients. */
export function LocationLockDialog({ clientIds, onClose, onSaved }: { clientIds: number[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [change, setChange] = useState(false)
  const [locked, setLocked] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving || !change) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/tracking/location-locks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientIds, locked }),
      })
      if (!response.ok) {
        setError(await errorText(response, t, "Не удалось сохранить"))
        return
      }
      onSaved()
    } catch {
      setError(t("Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Изменение выбранных клиентов"
      onClose={onClose}
      footer={
        <button type="button" disabled={!change || saving} onClick={() => void save()} className="h-9 px-[16px] text-[12px] font-bold uppercase text-[#1ea1f2] hover:opacity-80 disabled:opacity-40">
          {saving ? t("Сохранение...") : t("Изменить клиента")}
        </button>
      }
    >
      <p className="mb-[14px] text-[12px] text-[#777]">{t("Выбрано клиентов")}: {clientIds.length}</p>
      <CheckBox checked={change} onChange={(value) => { setChange(value); setError("") }} label="Изменить блокировку локации" />
      {change && (
        <div className="mt-[14px] flex flex-col gap-[10px] pl-[26px]">
          <label className="flex cursor-pointer items-center gap-[8px]">
            <input type="radio" name="location-lock" checked={locked} onChange={() => setLocked(true)} />
            {t("Заблокировать локацию")}
          </label>
          <label className="flex cursor-pointer items-center gap-[8px]">
            <input type="radio" name="location-lock" checked={!locked} onChange={() => setLocked(false)} />
            {t("Разблокировать локацию")}
          </label>
        </div>
      )}
      {error && <p className="mt-[12px] text-[12px] text-[#e53935]">{error}</p>}
    </Modal>
  )
}

type FieldRecord = {
  id: number
  kind: "refusal" | "photo_report"
  employeeName: string
  clientId: number
  clientName: string
  at: string
  syncedAt: string
  comment: string
  reason: string
  photos: Array<{ id: number; url: string; slot: "refusal" | "before" | "after" }>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-[10px] border-b border-dotted border-[#d9e0e5] py-[8px]">
      <span className="font-semibold text-[#777]">{t(label)}</span>
      <span className="break-words">{children}</span>
    </div>
  )
}

/** Wide dialog shell (portal, Escape, X). */
function WideDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  useEscape(onClose)
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="flex max-h-[90vh] w-[720px] max-w-full flex-col bg-white text-[13px] text-[#333] shadow-xl">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[22px]">
          <h3 className="text-[13px] font-bold uppercase">{title}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
            <X className="h-6 w-6" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[30px] py-[20px]">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

function useJson<T>(url: string | null, fallback: string): { data: T | null; error: string; loading: boolean } {
  const { t } = useLanguage()
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: "", loading: Boolean(url) })
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setState({ data: null, error: "", loading: true })
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorText(response, t, fallback))
        return (await response.json()) as T
      })
      .then((data) => {
        if (!cancelled) setState({ data, error: "", loading: false })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setState({ data: null, error: reason instanceof Error ? reason.message : t(fallback), loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [url, fallback, t])
  return state
}

/** "ОТЧЕТ № N" (photo report) or the refusal with its photos. */
export function FieldRecordDialog({ kind, id, onClose, onOpenClient }: { kind: "refusal" | "photo_report"; id: number; onClose: () => void; onOpenClient: (clientId: number) => void }) {
  const { t, language } = useLanguage()
  const [tab, setTab] = useState<"photos" | "shelf">("photos")
  const { data, error, loading } = useJson<FieldRecord>(`/api/field-activity/${kind === "refusal" ? "refusals" : "photo-reports"}/${id}`, "Не удалось загрузить данные")
  const title = kind === "refusal" ? `${t("Отказ")} № ${id}` : `${t("Отчет")} № ${id}`
  const groups: Array<{ label: string; slot: "refusal" | "before" | "after" }> =
    kind === "refusal" ? [{ label: "Фото", slot: "refusal" }] : [{ label: "До", slot: "before" }, { label: "После", slot: "after" }]
  return (
    <WideDialog title={title} onClose={onClose}>
      {loading && <p className="text-[#777]">{t("Загрузка...")}</p>}
      {error && <p className="text-[#e53935]">{error}</p>}
      {data && (
        <>
          <Row label="Клиент">
            <button type="button" onClick={() => onOpenClient(data.clientId)} className="font-semibold text-[#4f71dc] hover:underline">
              {data.clientName}
            </button>
          </Row>
          <Row label="Инициатор">{data.employeeName || "—"}</Row>
          <Row label="Время синхронизации">{formatDateText(data.syncedAt, language, { withTime: true })}</Row>
          <Row label={kind === "refusal" ? "Время отказа" : "Время фото"}>{formatDateText(data.at, language, { withTime: true })}</Row>
          {kind === "refusal" && <Row label="Причина">{data.reason || "—"}</Row>}
          <Row label="Комментарий">{data.comment || "—"}</Row>
          {kind === "photo_report" && (
            <div className="mt-[16px] flex gap-[20px] border-b border-[#e8ebf0]">
              {(["photos", "shelf"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setTab(value)} className={`pb-[8px] font-semibold ${tab === value ? "border-b-2 border-[#4f71dc] text-[#4f71dc]" : "text-[#777]"}`}>
                  {t(value === "photos" ? "Фото" : "Товары на полке")}
                </button>
              ))}
            </div>
          )}
          {tab === "shelf" && kind === "photo_report" ? (
            <p className="py-[24px] text-center text-[#777]">{t("Товары отсутствуют")}</p>
          ) : (
            <div className="mt-[16px] grid gap-[16px] sm:grid-cols-2">
              {groups.map((group) => {
                const photos = data.photos.filter((photo) => photo.slot === group.slot)
                return (
                  <div key={group.slot}>
                    <b className="mb-[8px] block">{t(group.label)}</b>
                    {photos.length === 0 ? (
                      <p className="text-[#999]">{t("Нет фото")}</p>
                    ) : (
                      <div className="flex flex-wrap gap-[8px]">
                        {photos.map((photo) => (
                          <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={photo.url} alt={t(group.label)} className="h-[140px] w-[140px] rounded border border-[#e8ebf0] object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </WideDialog>
  )
}

type OrderItem = { id: number; productName: string; unit: string; quantity: number; unitPrice: number; discountPercent: number; currency: string; lineTotal: number }

/** Order summary ("Заказ N"): head, lines and a link to the order in Продажи. */
export function OrderSummaryDialog({ orderId, onClose, onNavigate }: { orderId: number; onClose: () => void; onNavigate: (href: string) => void }) {
  const { t, language } = useLanguage()
  const order = useJson<Order>(`/api/orders/${orderId}`, "Заказ не найден")
  const items = useJson<OrderItem[]>(`/api/orders/${orderId}/items`, "Не удалось загрузить данные")
  return (
    <WideDialog title={`${t("Заказ")} № ${orderId}`} onClose={onClose}>
      {order.loading && <p className="text-[#777]">{t("Загрузка...")}</p>}
      {order.error && <p className="text-[#e53935]">{order.error}</p>}
      {order.data && (
        <>
          <Row label="Клиент">{order.data.client}</Row>
          <Row label="Статус">{t(order.data.status)}</Row>
          <Row label="Дата создания">{formatDateText(order.data.createdAt || order.data.created, language, { withTime: true, utc: Boolean(order.data.createdAt) })}</Row>
          <Row label="Агент">{order.data.agent || "—"}</Row>
          <Row label="Склад">{order.data.warehouse || "—"}</Row>
          <Row label="Сумма">{order.data.amount}</Row>
          <div className="mt-[16px]">
            <b className="mb-[8px] block">{t("Список товаров")}</b>
            {items.loading ? (
              <p className="text-[#777]">{t("Загрузка...")}</p>
            ) : items.error ? (
              <p className="text-[#e53935]">{items.error}</p>
            ) : !items.data?.length ? (
              <p className="text-[#999]">{t("Товары отсутствуют")}</p>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#e8ebf0] text-[#777]">
                    <th className="py-[6px] font-semibold">{t("Товар")}</th>
                    <th className="py-[6px] text-right font-semibold">{t("Количество")}</th>
                    <th className="py-[6px] text-right font-semibold">{t("Цена")}</th>
                    <th className="py-[6px] text-right font-semibold">{t("Сумма")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((item) => (
                    <tr key={item.id} className="border-b border-dotted border-[#d9e0e5]">
                      <td className="py-[6px]">{item.productName}</td>
                      <td className="py-[6px] text-right">
                        {formatMoney(item.quantity, 3)} {item.unit}
                      </td>
                      <td className="py-[6px] text-right">
                        {formatMoney(item.unitPrice)} {item.currency}
                      </td>
                      <td className="py-[6px] text-right">
                        {formatMoney(item.lineTotal)} {item.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-[18px] flex justify-end">
            <button type="button" onClick={() => onNavigate(`/analytics/sales?order=${orderId}`)} className="text-[12px] font-bold uppercase text-[#1ea1f2] hover:opacity-80">
              {t("Открыть заказ")}
            </button>
          </div>
        </>
      )}
    </WideDialog>
  )
}

/** Client card drawer ("Показать клиента"). */
export function ClientDrawer({ clientId, onClose, onNavigate }: { clientId: number; onClose: () => void; onNavigate: (href: string) => void }) {
  const { t, language } = useLanguage()
  useEscape(onClose)
  const { data, error, loading } = useJson<Client>(`/api/clients/${clientId}`, "Клиент не найден")
  const located = typeof data?.locationLat === "number" && typeof data?.locationLng === "number"
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/30" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" className="absolute bottom-0 right-0 top-0 flex w-[420px] max-w-full flex-col bg-white text-[13px] text-[#333] shadow-xl">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[24px] pr-[18px]">
          <h3 className="truncate text-[15px] font-bold">{data?.name ?? t("Клиент")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
            <X className="h-6 w-6" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[16px]">
          {loading && <p className="text-[#777]">{t("Загрузка...")}</p>}
          {error && <p className="text-[#e53935]">{error}</p>}
          {data && (
            <>
              <Row label="Телефон">{data.phone || "—"}</Row>
              <Row label="Адрес">{data.address || "—"}</Row>
              <Row label="Ориентир">{data.landmark || "—"}</Row>
              <Row label="Тип клиента">{data.type || "—"}</Row>
              <Row label="Зона">{data.zone || "—"}</Row>
              <Row label="Ответственный агент">{data.agent || "—"}</Row>
              <Row label="Ответственный доставщик">{data.deliverer || "—"}</Row>
              <Row label="Локация">
                {located ? (
                  <a href={`https://www.google.com/maps?q=${data.locationLat},${data.locationLng}`} target="_blank" rel="noopener noreferrer" className="text-[#4f71dc] hover:underline">
                    {`${data.locationLat}, ${data.locationLng}`}
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Баланс">{data.balanceLines?.length ? data.balanceLines.join(", ") : "—"}</Row>
              <Row label="Последний заказ">{data.lastOrder ? formatDateText(data.lastOrder, language) : "—"}</Row>
              <Row label="Последняя оплата">{data.lastPayment ? formatDateText(data.lastPayment, language) : "—"}</Row>
              <div className="mt-[18px] flex justify-end">
                <button type="button" onClick={() => onNavigate(`/clients?openClient=${encodeURIComponent(data.name)}`)} className="text-[12px] font-bold uppercase text-[#1ea1f2] hover:opacity-80">
                  {t("Открыть карточку клиента")}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
