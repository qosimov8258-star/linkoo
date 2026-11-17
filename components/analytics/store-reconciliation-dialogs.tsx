"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { X } from "lucide-react"

import { ConfirmDialog as RequestConfirm } from "@/components/analytics/cash-management-shared"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { LINE_INPUT, LineDate, LineField, LineSelect } from "@/components/ref/line-fields"
import { RefNothingFound } from "@/components/ref/list-kit"
import { currencyLabel } from "@/lib/finance/currency"
import { formatStatementDate, nowLocalIso } from "@/lib/finance/dates"
import type { BalanceDateMode } from "@/lib/finance/types"
import {
  reconciliationStatusColor,
  type ReconciliationMessage,
  type ReconciliationMessagesResult,
  type ReconciliationVariant,
  type StoreReconciliationOptions,
  type StoreReconciliationRow,
} from "@/lib/finance-store-reconciliation-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Row dialogs of "Сверка магазина через бот" / "Сверка счетов": Telegram
// history + "Отправить сверку" (demo 2311 + confirm), "Изменить срок долга"
// (2314) and Списать / Добавить (2309). Requests and debt terms belong to the
// row entity (a shop, or an account = clients of one INN); a correction always
// belongs to one client, so an account with several clients picks one.

/** The row a reconciliation request / debt term belongs to. */
export type ReconciliationEntityRef = { variant: ReconciliationVariant; key: string; name: string }

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !data) throw new Error(data?.error || `HTTP ${response.status}`)
  return data
}

function DialogFrame({ title, width = 500, onClose, children, footer }: { title: ReactNode; width?: number; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useLanguage()
  return (
    // Modal as in Linko: only × closes it.
    <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <div role="dialog" aria-modal="true" className="max-h-full w-full overflow-y-auto rounded-[2px] bg-white shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]" style={{ maxWidth: width }}>
        <div className="flex h-[60px] items-center justify-between gap-4 border-b border-[#efefef] pl-[30px] pr-[20px]">
          <h2 className="text-[13px] font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666] hover:text-black">
            <X className="h-[22px] w-[22px]" />
          </button>
        </div>
        {children}
        {footer && <div className="flex h-[56px] items-center justify-end gap-3 border-t border-[#efefef] px-[26px]">{footer}</div>}
      </div>
    </div>
  )
}

/** Linko's footer action: the blue text button «СОХРАНИТЬ». */
function TextAction({ label, busy, onClick }: { label: string; busy?: boolean; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button type="button" disabled={busy} onClick={onClick} className="text-[13px] font-semibold uppercase text-[#1E4A9A] hover:brightness-125 disabled:opacity-50">
      {t(label)}
    </button>
  )
}

const BAR_ICON = "M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"

// --- Telegram ------------------------------------------------------------------------------

function messageStatusLabel(status: string | null): string {
  if (status === "pending") return "В ожидание"
  if (status === "confirmed") return "Подтвержден"
  if (status === "rejected") return "Отклонен"
  if (status === "not_send") return "Не отправлено"
  if (status === null) return "Не подключен"
  return "Не указано"
}

export function TelegramDialog({
  entity,
  canSend,
  asOf,
  mode,
  onClose,
  onSent,
}: {
  entity: ReconciliationEntityRef
  canSend: boolean
  asOf: string
  mode: BalanceDateMode
  onClose: () => void
  /** After a request was recorded (reload the list: the status changed). */
  onSent: (message: string, error: boolean) => void
}) {
  const { t, language } = useLanguage()
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 })
  const [data, setData] = useState<ReconciliationMessagesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const query = new URLSearchParams({ variant: entity.variant, key: entity.key, page: String(paging.page), pageSize: String(paging.pageSize) })
    fetch(`/api/store-reconciliation/messages?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (ReconciliationMessagesResult & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
        setData(body)
        setError("")
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [entity.variant, entity.key, paging, version])

  const send = async () => {
    setSending(true)
    try {
      const result = await postJson<{ message: ReconciliationMessage; botConnected: boolean }>("/api/store-reconciliation/messages", {
        variant: entity.variant,
        key: entity.key,
        debtDate: asOf,
        mode,
      })
      setConfirm(false)
      setVersion((value) => value + 1)
      onSent(result.botConnected ? t("Успешно отправлено") : t("Запрос на сверку сохранен, но не отправлен: Телеграм-бот не подключен"), !result.botConnected)
    } catch (reason) {
      setConfirm(false)
      onSent(reason instanceof Error ? reason.message : t("Отправлено невозможно из-за связи с другими данными"), true)
    } finally {
      setSending(false)
    }
  }

  const rows = data?.rows ?? []
  return (
    <>
      <DialogFrame title={t("Сверка с клиентом через бот")} width={1000} onClose={onClose}>
        <div className="px-[30px] pb-[10px]">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex flex-wrap items-center gap-3">
              {canSend && (
                <button type="button" onClick={() => setConfirm(true)} className="flex h-[34px] items-center gap-[8px] rounded-[2px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">
                  <svg viewBox="0 0 24 24" aria-hidden className="h-[16px] w-[16px] fill-white"><path d={BAR_ICON} /></svg> {t("Отправить сверку")}
                </button>
              )}
            </div>
            <BalancePagination page={paging.page} pageSize={paging.pageSize} count={data?.count ?? 0} onChange={setPaging} />
          </div>
          {error && <p className="py-3 text-[#e57373]">{error}</p>}
          <div className={`text-[13px] text-[#333] ${loading ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-12 gap-2 border-b border-[#efefef] py-3 font-semibold">
              <span className="col-span-2">{t("Телеграм аккаунт")}</span>
              <span className="col-span-4">{t("Сообщения")}</span>
              <span className="col-span-2">{t("Дата создания")}</span>
              <span className="col-span-2">{t("Дата подтверждения")}</span>
              <span className="col-span-2 text-right">{t("Статус")}</span>
            </div>
            {!rows.length && !loading && <RefNothingFound text={t("Пока сообщения нет")} />}
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-12 items-start gap-2 border-b border-dotted border-[#dbe0e8] py-3">
                <span className="col-span-2 flex flex-col">
                  {row.telegramUser ? `${row.telegramUser.firstName} ${row.telegramUser.secondName}`.trim() : t("Не подключен")}
                  {row.telegramUser?.phoneNumber && <span className="mt-1 text-[#1E4A9A]">{row.telegramUser.phoneNumber}</span>}
                </span>
                <span className="col-span-4 whitespace-pre-line">{row.text}</span>
                <span className="col-span-2">{formatStatementDate(row.createdAt, language)}</span>
                <span className="col-span-2">{row.confirmedAt ? formatStatementDate(row.confirmedAt, language) : t("Не указано")}</span>
                <span className="col-span-2 text-right font-semibold" style={{ color: reconciliationStatusColor(row.status) }}>
                  {t(messageStatusLabel(row.status))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </DialogFrame>
      {confirm && <RequestConfirm title={t("Выполнить")} kind="request" text={t("Подтвердить отправку сверку с клиентом через телеграм бот")} confirmLabel="Да" busy={sending} onClose={() => setConfirm(false)} onConfirm={() => void send()} />}
    </>
  )
}

// --- Изменить срок долга -----------------------------------------------------------------------

export function DeadlineDialog({
  entity,
  current,
  onClose,
  onSaved,
}: {
  entity: ReconciliationEntityRef
  current: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [value, setValue] = useState(current ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const save = async () => {
    setSaving(true)
    setError("")
    try {
      await postJson("/api/store-reconciliation/deadline", { variant: entity.variant, key: entity.key, paymentDeadline: value || null })
      onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }
  // Linko's «ВЫПОЛНИТЬ»: «Подтверждение запроса», then on the grey band «Изменить срок долга» and the «Срок долга» day, «ДА».
  return (
    <RequestConfirm title={t("Выполнить")} kind="request" confirmLabel="Да" busy={saving} error={error ? t(error) : undefined} onClose={onClose} onConfirm={() => void save()}>
      <div className="-mx-[30px] mt-[19px] bg-[#f2f5f8] px-[30px] pb-[72px] pt-[18px]">
        <p className="font-semibold">{t("Изменить срок долга")}</p>
        <div className="mt-[14px]">
          <LineDate label={t("Срок долга")} value={value} onChange={setValue} />
        </div>
      </div>
    </RequestConfirm>
  )
}

// --- Списать / Добавить ------------------------------------------------------------------------

/**
 * «ДОБАВИТЬ РАСХОД / ПРИХОД КЛИЕНТУ <name>» as Linko shows it: Тип оплаты, Валюта, Сумма, Дата создания, Создал,
 * Доставщик, Комментарий... and «Прочие приходы» / «Оплата (Кассир не принял)». Linko writes an expense always as
 * «Прочие расходы» (its form shows the choice and «Создал» but does not send them); an income keeps the choice and
 * «Создал». No day = now.
 */
export function CorrectionDialog({
  row,
  kind,
  options,
  currencies,
  onClose,
  onSaved,
}: {
  row: StoreReconciliationRow
  /** expense = ⊖ «Добавить расход», income = ⊕ «Добавить приход». */
  kind: "expense" | "income"
  options: StoreReconciliationOptions | null
  /** Currency codes of the grid (balance lines). */
  currencies: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    paymentType: "" as "" | "cash" | "bank",
    currency: "",
    amount: "",
    date: "",
    createdBy: "",
    deliveryMan: "",
    comment: "",
    type: "9" as "9" | "1",
    /** The client the correction is written to (an account row may have several). */
    clientId: row.members[0]?.id ?? row.id ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const set = useCallback(<K extends keyof typeof form>(field: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [field]: value })), [])

  const amount = Number(form.amount.replace(/\s/g, "").replace(",", "."))
  const save = async () => {
    if (!form.currency) {
      setError(t("Выберите валюту"))
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t("Укажите сумму"))
      return
    }
    if (!form.clientId) {
      setError(t("Выберите клиента"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const now = nowLocalIso()
      await postJson("/api/store-reconciliation/corrections", {
        clientId: form.clientId,
        kind: kind === "expense" ? "expense" : form.type === "1" ? "payment" : "income",
        amount,
        currency: form.currency,
        paymentType: form.paymentType,
        date: `${form.date || now.slice(0, 10)}T${now.slice(11, 16)}`,
        deliveryMan: form.deliveryMan,
        comment: form.comment,
        ...(kind === "income" && form.createdBy ? { createdBy: form.createdBy } : {}),
      })
      onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const currencyOptions = (options?.currencies.map((currency) => currency.code) ?? currencies).map((code) => ({ value: code, label: currencyLabel(code) }))
  const names = (list: string[] | undefined) => (list ?? []).map((name) => ({ value: name, label: name }))
  return (
    <DialogFrame
      title={`${kind === "expense" ? t("Добавить расход клиенту") : t("Добавить приход клиенту")} ${row.name}`}
      onClose={onClose}
      footer={<TextAction label="Сохранить" busy={saving} onClick={() => void save()} />}
    >
      <div className="flex flex-col gap-[12px] px-[30px] pb-[24px] pt-[30px]">
        {row.members.length > 1 && (
          <LineSelect label={t("Клиент")} value={String(form.clientId)} onChange={(value) => set("clientId", Number(value))} options={row.members.map((member) => ({ value: String(member.id), label: member.name || `#${member.id}` }))} />
        )}
        <LineSelect label={t("Тип оплаты")} value={form.paymentType} onChange={(value) => set("paymentType", value as "" | "cash" | "bank")} options={[{ value: "cash", label: t("Наличные") }, { value: "bank", label: t("Перечисление") }]} />
        <LineSelect label={t("Валюта")} value={form.currency} onChange={(value) => set("currency", value)} options={currencyOptions} />
        <LineField label={t("Сумма")} filled={!!form.amount}>
          <input inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value.replace(/[^\d.,\s]/g, ""))} className={LINE_INPUT} />
        </LineField>
        <div className="pt-[14px]">
          <LineDate label={t("Дата создания")} value={form.date} onChange={(value) => set("date", value)} />
        </div>
        <LineSelect label={t("Создал")} value={form.createdBy} onChange={(value) => set("createdBy", value)} options={names(options?.users)} />
        <LineSelect label={t("Доставщик")} value={form.deliveryMan} onChange={(value) => set("deliveryMan", value)} options={names(options?.deliverers)} />
        <input
          value={form.comment}
          onChange={(event) => set("comment", event.target.value)}
          maxLength={2000}
          placeholder={`${t("Комментарий")}...`}
          className="mt-[8px] h-[34px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none placeholder:font-semibold placeholder:text-black focus:border-[#1E4A9A]"
        />
        <div role="radiogroup" className="mt-[18px] flex flex-col gap-[14px] text-[13px] text-black">
          {(
            [
              ["9", "Прочие приходы"],
              ["1", "Оплата (Кассир не принял)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex cursor-pointer items-center gap-[16px]">
              <input type="radio" name="correction-type" checked={form.type === value} onChange={() => set("type", value)} className="h-[20px] w-[20px] accent-[#666]" />
              {t(label)}
            </label>
          ))}
        </div>
        {error && <p className="text-[13px] text-[#e57373]">{error}</p>}
      </div>
    </DialogFrame>
  )
}
