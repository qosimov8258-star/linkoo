"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Send, X } from "lucide-react"

import { balanceColor } from "@/components/analytics/balance/amount"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { Field, fieldClass } from "@/components/analytics/store-reconciliation-filters"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
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

function DialogFrame({ title, width = 520, onClose, children, footer }: { title: ReactNode; width?: number; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={onClose}>
      <div className="w-full rounded-lg bg-white shadow-xl" style={{ maxWidth: width }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b border-[#efefef] px-6 py-4">
          <h2 className="text-[15px] font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        {footer && <div className="flex justify-end gap-3 border-t border-[#efefef] px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

/** Small "are you sure" dialog (demo ConfirmDialog type submit). */
export function ConfirmDialog({ message, loading, onClose, onConfirm }: { message: ReactNode; loading?: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useLanguage()
  return (
    <DialogFrame
      title={t("Подтверждение")}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-10 rounded-md px-5 font-semibold text-[#586174]">
            {t("Отмена")}
          </button>
          <button type="button" disabled={loading} onClick={onConfirm} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white disabled:opacity-60">
            {t("Подтвердить")}
          </button>
        </>
      }
    >
      <div className="px-6 py-5 text-[14px] text-[#333]">{message}</div>
    </DialogFrame>
  )
}

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
        <div className="px-6 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex flex-wrap items-center gap-3">
              {canSend && (
                <button type="button" onClick={() => setConfirm(true)} className="flex h-[34px] items-center gap-2 rounded-sm bg-[#71ce87] px-4 font-semibold text-white">
                  <Send className="h-4 w-4" /> {t("Отправить сверку")}
                </button>
              )}
              <span className="font-semibold text-[#333]">{entity.name}</span>
            </div>
            <BalancePagination page={paging.page} pageSize={paging.pageSize} count={data?.count ?? 0} onChange={setPaging} />
          </div>
          {data && !data.botConnected && (
            <p className="mb-3 rounded-md bg-[#fff7e6] px-4 py-2 text-[13px] text-[#8a6d3b]">
              {t("Телеграм-бот не подключен: сверки сохраняются со статусом «Не отправлено» и клиенту не доставляются.")}
            </p>
          )}
          {error && <p className="py-3 text-[#e57373]">{error}</p>}
          <div className={`text-[13px] text-[#333] ${loading ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-12 gap-2 border-b border-[#efefef] py-3 font-semibold">
              <span className="col-span-2">{t("Телеграм аккаунт")}</span>
              <span className="col-span-4">{t("Сообщения")}</span>
              <span className="col-span-2">{t("Дата создания")}</span>
              <span className="col-span-2">{t("Дата подтверждения")}</span>
              <span className="col-span-2 text-right">{t("Статус")}</span>
            </div>
            {!rows.length && !loading && <p className="py-14 text-center font-semibold text-[#666]">{t("Пока сообщения нет")}</p>}
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-12 items-start gap-2 border-b border-dotted border-[#dbe0e8] py-3">
                <span className="col-span-2 flex flex-col">
                  {row.telegramUser ? `${row.telegramUser.firstName} ${row.telegramUser.secondName}`.trim() : t("Не подключен")}
                  {row.telegramUser?.phoneNumber && <span className="mt-1 text-[#4f71dc]">{row.telegramUser.phoneNumber}</span>}
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
      {confirm && <ConfirmDialog message={t("Подтвердить отправку сверку с клиентом через телеграм бот")} loading={sending} onClose={() => setConfirm(false)} onConfirm={() => void send()} />}
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
  return (
    <DialogFrame
      title={`${t("Изменить срок долга")}: ${entity.name}`}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-10 rounded-md px-5 font-semibold text-[#586174]">
            {t("Отмена")}
          </button>
          <button type="button" disabled={saving} onClick={() => void save()} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white disabled:opacity-60">
            {t("Сохранить")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 px-6 py-5">
        <Field label="Срок долга">
          <span className="flex items-center gap-2">
            <input type="date" value={value} onChange={(event) => setValue(event.target.value)} className={fieldClass} />
            {value && (
              <button type="button" onClick={() => setValue("")} className="whitespace-nowrap text-[13px] font-semibold text-[#4f71dc]">
                {t("Очистить")}
              </button>
            )}
          </span>
        </Field>
        {error && <p className="text-[#e57373]">{error}</p>}
      </div>
    </DialogFrame>
  )
}

// --- Списать / Добавить ------------------------------------------------------------------------

export function CorrectionDialog({
  row,
  kind,
  options,
  userName,
  currencies,
  onClose,
  onSaved,
}: {
  row: StoreReconciliationRow
  /** expense = "Списать", income = "Добавить". */
  kind: "expense" | "income"
  options: StoreReconciliationOptions | null
  userName: string
  /** Currency codes of the grid (balance lines). */
  currencies: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    paymentType: "cash" as "cash" | "bank",
    currency: options?.baseCurrency ?? currencies[0] ?? "SUM",
    amount: "",
    organization: "",
    date: nowLocalIso().slice(0, 16),
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
      await postJson("/api/store-reconciliation/corrections", {
        clientId: form.clientId,
        kind: kind === "expense" ? "expense" : form.type === "1" ? "payment" : "income",
        amount,
        currency: form.currency,
        paymentType: form.paymentType,
        organization: form.organization,
        date: form.date,
        deliveryMan: form.deliveryMan,
        comment: form.comment,
      })
      onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const currencyOptions = options?.currencies.map((currency) => currency.code) ?? currencies
  return (
    <DialogFrame
      title={`${kind === "expense" ? t("Добавить расход клиенту") : t("Добавить приход клиенту")} ${row.name}`}
      onClose={onClose}
      footer={
        <button type="button" disabled={saving} onClick={() => void save()} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white disabled:opacity-60">
          {t("Сохранить")}
        </button>
      }
    >
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-[#efefef] px-6 py-3 text-[13px]">
        {currencies.flatMap((code) =>
          (["cash", "bank"] as const).map((field) => {
            const value = row.currencies[code]?.[field] ?? 0
            return (
              <span key={`${code}.${field}`} className="py-1">
                {currencyLabel(code)} {t(field === "cash" ? "нал." : "переч.")}{" "}
                <span className="px-1 font-semibold" style={{ color: balanceColor(value, "card") }}>
                  {formatMoney(value)}
                </span>
              </span>
            )
          }),
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 px-6 py-5">
        {row.members.length > 1 && (
          <Field label="Клиент">
            <select value={form.clientId} onChange={(event) => set("clientId", Number(event.target.value))} className={fieldClass}>
              {row.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || `#${member.id}`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Тип оплаты">
          <select value={form.paymentType} onChange={(event) => set("paymentType", event.target.value as "cash" | "bank")} className={fieldClass}>
            <option value="cash">{t("Наличные")}</option>
            <option value="bank">{t("Перечисление")}</option>
          </select>
        </Field>
        <Field label="Валюта">
          <select value={form.currency} onChange={(event) => set("currency", event.target.value)} className={fieldClass}>
            {currencyOptions.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Сумма">
          <input inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value.replace(/[^\d.,\s]/g, ""))} className={fieldClass} />
        </Field>
        <Field label="Организация">
          <select value={form.organization} onChange={(event) => set("organization", event.target.value)} className={fieldClass}>
            <option value="">{t("Не указано")}</option>
            {(options?.organizations ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Дата создания">
          <input type="datetime-local" value={form.date} onChange={(event) => set("date", event.target.value)} className={fieldClass} />
        </Field>
        <Field label="Создал">
          <input value={userName} readOnly className={`${fieldClass} bg-[#f2f5f8] text-[#586174]`} />
        </Field>
        <Field label="Доставщик">
          <select value={form.deliveryMan} onChange={(event) => set("deliveryMan", event.target.value)} className={fieldClass}>
            <option value="">{t("Не указано")}</option>
            {(options?.deliverers ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Комментарий">
          <textarea value={form.comment} onChange={(event) => set("comment", event.target.value)} rows={2} placeholder={`${t("Комментарий")}...`} className="w-full rounded-md border border-[#dbe0e8] px-3 py-2 text-[#17233b]" />
        </Field>
        {kind === "income" && (
          <div className="flex flex-col gap-2 text-[14px] text-[#17233b]">
            {(
              [
                ["9", "Прочие приходы"],
                ["1", "Оплата (Кассир не принял)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name="correction-type" checked={form.type === value} onChange={() => set("type", value)} className="h-4 w-4 accent-[#4f70e7]" />
                {t(label)}
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-[#e57373]">{error}</p>}
      </div>
    </DialogFrame>
  )
}
