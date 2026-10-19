"use client"

import { useState } from "react"
import { Download, Trash2 } from "lucide-react"

import { cashMutate, useAcceptance } from "@/components/analytics/cash/use-cash"
import { clientHref } from "@/components/analytics/cash-management-details"
import {
  CashModal,
  ConfirmDialog,
  ErrorBlock,
  FormField,
  LoadingBlock,
  PrimaryButton,
  SearchSelect,
  formatCash,
  formatCashDate,
  inputClass,
  mutationError,
  parseAmount,
  useJsonList,
  type Named,
} from "@/components/analytics/cash-management-shared"
import type { AcceptanceDetail, CashboxWithBalance } from "@/lib/cash/types"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Type-8 rows ("Принято денег с <agent>"):
// - info (demo 3853): "Транзакция № …" + "Скачать Excel", the accepted
//   payments; 🗑 detaches one payment (POST /api/cash/acceptances/[id]/detach);
// - edit (demo 3864, "Изменить транзакцию №…"): Филиал, Организация, Касса,
//   Дата принятия, Ответственный персонал + editable amounts
//   (PUT /api/cash/acceptances/[id]).

export function CashAcceptanceInfoDialog({ id, canWrite, onClose, onChanged }: { id: number; canWrite: boolean; onClose: () => void; onChanged: (message: string) => void }) {
  const { t, language } = useLanguage()
  const { data, loading, error, reload } = useAcceptance(id)
  const [detaching, setDetaching] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [detachError, setDetachError] = useState("")

  const download = (detail: AcceptanceDetail) =>
    downloadExcelTable(`acceptance-${detail.docNo}`, [
      ["№", t("Клиент"), t("Агент"), t("Дата создания"), t("Принял"), t("Дата принятия"), t("Организация"), t("№ заказа"), t("Сумма"), t("Валюта")],
      ...detail.payments.map((payment) => [
        payment.docNo,
        payment.client.name,
        payment.agent,
        payment.date.replace("T", " ").slice(0, 16),
        payment.acceptedBy,
        payment.acceptedAt.replace("T", " ").slice(0, 16),
        payment.organization,
        payment.orderId ?? "",
        payment.amount,
        currencyLabel(payment.currency),
      ]),
    ])

  const detach = async () => {
    if (!detaching) return
    setBusy(true)
    const result = await cashMutate<AcceptanceDetail>("POST", `/api/cash/acceptances/${id}/detach`, { paymentId: detaching })
    setBusy(false)
    if (!result.ok) return setDetachError(mutationError(result, t))
    setDetaching(null)
    onChanged("Успешно сохранено")
    if (result.data.isDeleted || !result.data.payments.length) onClose()
    else reload()
  }

  return (
    <CashModal
      title={`${t("Транзакция")} № ${data?.docNo ?? ""}`}
      onClose={onClose}
      size="xl"
      headerExtra={
        data ? (
          <button type="button" onClick={() => download(data)} className="inline-flex items-center gap-1 text-[13px] font-semibold normal-case text-[#4caf72] hover:underline">
            <Download className="h-4 w-4" /> {t("Скачать Excel")}
          </button>
        ) : null
      }
    >
      {loading && !data && <LoadingBlock />}
      {error && <ErrorBlock error={error} onRetry={reload} />}
      {data && (
        <>
          <p className="mb-3 text-[13px] text-[#586174]">
            {t("Касса")}: <b className="text-[#17233b]">{data.cashbox.name}</b> · {t("Агент")}: <b className="text-[#17233b]">{data.agent || t("Не указано")}</b> · {t("Дата принятия")}:{" "}
            <b className="text-[#17233b]">{formatCashDate(data.date, language)}</b> · {t("Сумма")}: <b className="text-[#17233b]">{formatCash(data.amount, data.currency)}</b>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="bg-[#626b7e] text-left text-white">
                  <th className="px-2 py-2.5 font-semibold">№</th>
                  <th className="px-2 py-2.5 font-semibold">{t("Клиент")}</th>
                  <th className="px-2 py-2.5 font-semibold">{t("Агент")}</th>
                  <th className="px-2 py-2.5 font-semibold">{t("Дата создания")}</th>
                  <th className="px-2 py-2.5 font-semibold">{t("Принял")}</th>
                  <th className="px-2 py-2.5 font-semibold">{t("Дата принятия")}</th>
                  <th className="px-2 py-2.5 font-semibold">{t("Организация")}</th>
                  <th className="px-2 py-2.5 font-semibold">{t("№ заказа")}</th>
                  <th className="px-2 py-2.5 text-right font-semibold">{t("Сумма")}</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.payments.map((payment) => (
                  <tr key={payment.id} className="border-b border-dashed border-[#d8dee7]">
                    <td className="px-2 py-2">{payment.docNo}</td>
                    <td className="px-2 py-2">
                      <a href={clientHref(payment.client.id, payment.client.name)} target="_blank" rel="noreferrer" className="text-[#4f70e7] hover:underline">
                        {payment.client.name}
                      </a>
                    </td>
                    <td className="px-2 py-2">{payment.agent}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatCashDate(payment.date, language)}</td>
                    <td className="px-2 py-2">{payment.acceptedBy || "—"}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatCashDate(payment.acceptedAt, language)}</td>
                    <td className="px-2 py-2">{payment.organization || "—"}</td>
                    <td className="px-2 py-2">{payment.orderId ?? "—"}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <b>{formatCash(payment.amount, payment.currency)}</b>
                      {payment.cashboxAmount !== null && payment.currency !== data.currency && <span className="block text-[11px] text-[#586174]">{formatCash(payment.cashboxAmount, data.currency)}</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {canWrite && !data.isDeleted && (
                        <button
                          type="button"
                          onClick={() => {
                            setDetachError("")
                            setDetaching(payment.id)
                          }}
                          aria-label={t("Удалить")}
                          className="text-[#e57373]"
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
        </>
      )}
      {detaching && (
        <ConfirmDialog title={t("Подтверждаете?")} confirmLabel="Да" busy={busy} error={detachError} onConfirm={detach} onClose={() => setDetaching(null)}>
          <p className="text-[14px] text-[#586174]">{t("Оплата будет возвращена в «Принять деньги»")}</p>
        </ConfirmDialog>
      )}
    </CashModal>
  )
}

export function CashAcceptanceEditDialog({ id, cashboxes, onClose, onSaved }: { id: number; cashboxes: CashboxWithBalance[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { data, loading, error, reload } = useAcceptance(id)
  if (!data)
    return (
      <CashModal title={t("Изменить транзакцию")} onClose={onClose} size="lg">
        {loading && <LoadingBlock />}
        {error && <ErrorBlock error={error} onRetry={reload} />}
      </CashModal>
    )
  return <AcceptanceEditForm detail={data} cashboxes={cashboxes} onClose={onClose} onSaved={onSaved} />
}

function AcceptanceEditForm({ detail, cashboxes, onClose, onSaved }: { detail: AcceptanceDetail; cashboxes: CashboxWithBalance[]; onClose: () => void; onSaved: () => void }) {
  const { t, language } = useLanguage()
  const branches = useJsonList<Named>("/api/branches").items
  const organizations = useJsonList<Named>("/api/organizations").items
  const employees = useJsonList<Named>("/api/employees").items
  const [branch, setBranch] = useState(detail.branch)
  const [organization, setOrganization] = useState(detail.organization)
  const [cashboxId, setCashboxId] = useState(String(detail.cashbox.id ?? ""))
  const [date, setDate] = useState(detail.date.slice(0, 16))
  const [deliveryManId, setDeliveryManId] = useState("")
  const [amounts, setAmounts] = useState<Record<number, string>>(() => Object.fromEntries(detail.payments.map((payment) => [payment.id, String(payment.cashboxAmount ?? payment.amount)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const deliveryManLabel = employees.find((item) => String(item.id) === deliveryManId)?.name ?? detail.deliveryMan

  const submit = async () => {
    const payments = detail.payments.map((payment) => ({ id: payment.id, amount: parseAmount(amounts[payment.id] ?? "") }))
    if (payments.some((payment) => !(payment.amount > 0))) return setError(t("Укажите сумму"))
    if (!cashboxId) return setError(t("Выберите кассу"))
    setBusy(true)
    const result = await cashMutate<AcceptanceDetail>("PUT", `/api/cash/acceptances/${detail.id}`, {
      payments,
      branch,
      organization,
      cashboxId: Number(cashboxId),
      deliveryManId: deliveryManId ? Number(deliveryManId) : undefined,
      date,
    })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved()
  }

  return (
    <CashModal
      title={`${t("Изменить транзакцию")} №${detail.docNo}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={submit}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label={t("Филиал")}>
          <SearchSelect value={branch} onChange={setBranch} options={branches.map((item) => ({ value: item.name, label: item.name }))} placeholder={t("Филиал")} />
        </FormField>
        <FormField label={t("Организация")}>
          <SearchSelect value={organization} onChange={setOrganization} options={organizations.map((item) => ({ value: item.name, label: item.name }))} placeholder={t("Организация")} />
        </FormField>
        <FormField label={t("Касса")} required>
          <SearchSelect value={cashboxId} onChange={setCashboxId} options={cashboxes.map((item) => ({ value: String(item.id), label: `${item.name} (${currencyLabel(item.currency)})` }))} placeholder={t("Касса")} allowClear={false} />
        </FormField>
        <FormField label={t("Дата принятия")}>
          <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </FormField>
        <FormField label={t("Ответственный персонал")}>
          <SearchSelect value={deliveryManId} selectedLabel={deliveryManLabel} onChange={setDeliveryManId} options={employees.map((item) => ({ value: String(item.id), label: item.name }))} placeholder={deliveryManLabel || t("Ответственный персонал")} />
        </FormField>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="bg-[#edf2f7] text-left text-[#253653]">
              <th className="px-2 py-2">№</th>
              <th className="px-2 py-2">{t("Клиент")}</th>
              <th className="px-2 py-2">{t("Дата создания")}</th>
              <th className="px-2 py-2">{t("№ заказа")}</th>
              <th className="px-2 py-2">
                {t("Сумма")} ({currencyLabel(detail.cashbox.currency)})
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.payments.map((payment) => (
              <tr key={payment.id} className="border-b border-[#e1e5eb]">
                <td className="px-2 py-1.5">{payment.docNo}</td>
                <td className="px-2 py-1.5">{payment.client.name}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{formatCashDate(payment.date, language)}</td>
                <td className="px-2 py-1.5">{payment.orderId ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amounts[payment.id] ?? ""}
                    onChange={(event) => setAmounts((current) => ({ ...current, [payment.id]: event.target.value }))}
                    className="h-8 w-36 rounded-md border border-[#dbe0e8] px-2"
                    aria-label={t("Сумма")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CashModal>
  )
}
