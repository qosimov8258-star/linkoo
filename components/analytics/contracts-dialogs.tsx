"use client"

import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { FileSpreadsheet, Loader2, SearchCheck } from "lucide-react"

import { cashMutate } from "@/components/analytics/cash/use-cash"
import {
  CashModal,
  FormField,
  PrimaryButton,
  SearchSelect,
  SecondaryButton,
  inputClass,
  mutationError,
  type PickOption,
} from "@/components/analytics/cash-management-shared"
import { ClientMultiSelect, type ClientPick } from "@/components/analytics/contracts-fields"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, normalizeHeader, readExcelRows } from "@/lib/excel-import"
import {
  CONTRACT_STATUSES,
  CONTRACT_STATUS_LABELS,
  type ContractDetail,
  type ContractFormOptions,
  type ContractImportResult,
  type ContractImportRow,
  type ContractInnInfo,
  type ContractNextNumber,
  type ContractStatus,
} from "@/lib/contracts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Demo ContractsCreateDialog (module 4420, form ContractsCreateForm): title
// "Добавить договор" / "Изменить договор"; fields in the demo order — prefix |
// "Номер контракта" | suffix, "Дата создания", "Официальное название", "ИНН"
// (+ "Проверить данные по ИНН"), "Клиенты", "Агент", "Статус", "Комментарий",
// "Организация"; "Сохранить". A new contract gets the next free number of the
// year (GET /api/contracts/next-number, refreshed when the year / prefix / suffix
// change until the number is edited by hand).

type FormValues = {
  contractPrefix: string
  contractNumber: string
  contractSuffix: string
  createdDate: string
  officialName: string
  inn: string
  clients: ClientPick[]
  agentId: string
  status: ContractStatus | ""
  comment: string
  organizationId: string
}

type Errors = Partial<Record<keyof FormValues | "form", string>>

const FIELD_OF: Record<string, keyof FormValues> = {
  contractNumber: "contractNumber",
  createdDate: "createdDate",
  officialName: "officialName",
  inn: "inn",
  clientIds: "clients",
  agentId: "agentId",
  status: "status",
  organizationId: "organizationId",
}

function todayLocal(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function initialValues(contract: ContractDetail | null): FormValues {
  if (!contract)
    return {
      contractPrefix: "",
      contractNumber: "",
      contractSuffix: "",
      createdDate: todayLocal(),
      officialName: "",
      inn: "",
      clients: [],
      agentId: "",
      status: "active",
      comment: "",
      organizationId: "",
    }
  return {
    contractPrefix: contract.contractPrefix,
    contractNumber: contract.contractNumber === null ? "" : String(contract.contractNumber),
    contractSuffix: contract.contractSuffix,
    createdDate: contract.createdDate.slice(0, 10),
    officialName: contract.officialName,
    inn: contract.inn,
    clients: contract.clients.filter((client) => client.id !== null).map((client) => ({ id: client.id as number, name: client.name, zone: client.zone })),
    agentId: contract.agent.id === null ? "" : String(contract.agent.id),
    status: contract.status,
    comment: contract.comment,
    organizationId: contract.organization.id === null ? "" : String(contract.organization.id),
  }
}

export function ContractFormDialog({
  contract,
  options,
  onClose,
  onSaved,
}: {
  /** null = create. */
  contract: ContractDetail | null
  options: ContractFormOptions | null
  onClose: () => void
  onSaved: (saved: ContractDetail) => void
}) {
  const { t } = useLanguage()
  const isUpdate = contract !== null
  const [values, setValues] = useState<FormValues>(() => initialValues(contract))
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  // Legacy contracts without a number get the next free one too.
  const [numberTouched, setNumberTouched] = useState(isUpdate && contract.contractNumber !== null)
  const [numberLoading, setNumberLoading] = useState(!numberTouched)
  const [innState, setInnState] = useState<{ loading: boolean; text: string }>({ loading: false, text: "" })
  const firstLoad = useRef(true)
  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
  }

  // Next free number: first with the defaults (latest prefix / suffix), then for the chosen year + prefix + suffix.
  const year = values.createdDate.slice(0, 4)
  useEffect(() => {
    if (numberTouched) return
    const controller = new AbortController()
    const first = firstLoad.current
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams()
        if (/^\d{4}$/.test(year)) params.set("year", year)
        if (!first) {
          params.set("prefix", values.contractPrefix)
          params.set("suffix", values.contractSuffix)
        }
        setNumberLoading(true)
        fetch(`/api/contracts/next-number?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
          .then((response) => (response.ok ? (response.json() as Promise<ContractNextNumber>) : null))
          .then((next) => {
            if (!next) return
            firstLoad.current = false
            setValues((current) => ({
              ...current,
              contractNumber: String(next.contractNumber),
              ...(first ? { contractPrefix: next.contractPrefix, contractSuffix: next.contractSuffix } : {}),
            }))
          })
          .catch(() => {})
          .finally(() => {
            if (!controller.signal.aborted) setNumberLoading(false)
          })
      },
      first ? 0 : 350,
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [numberTouched, year, values.contractPrefix, values.contractSuffix])

  const checkInn = async () => {
    const inn = values.inn.replace(/\s/g, "")
    if (!inn) return
    setInnState({ loading: true, text: "" })
    try {
      const response = await fetch(`/api/contracts/inn?inn=${encodeURIComponent(inn)}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (ContractInnInfo & { error?: string }) | null
      if (!response.ok || !body) {
        setInnState({ loading: false, text: "" })
        setErrors((current) => ({ ...current, inn: t(body?.error || "Не удалось выполнить запрос") }))
        return
      }
      if (body.name) {
        set("officialName", body.name)
        setInnState({ loading: false, text: `${t("Название")}: ${body.name}${body.address ? ` · ${t("Адрес")}: ${body.address}` : ""}` })
      } else setInnState({ loading: false, text: t("Данные по ИНН не найдены") })
    } catch {
      setInnState({ loading: false, text: t("Сервер недоступен, попробуйте ещё раз") })
    }
  }

  const validate = (): Errors => {
    const next: Errors = {}
    if (!/^\d+$/.test(values.contractNumber.trim()) || Number(values.contractNumber) <= 0) next.contractNumber = t("Обязательное поле")
    if (!values.createdDate) next.createdDate = t("Обязательное поле")
    if (!values.officialName.trim()) next.officialName = t("Обязательное поле")
    if (!values.inn.trim()) next.inn = t("Обязательное поле")
    else if (!/^\d+$/.test(values.inn.replace(/\s/g, ""))) next.inn = t("ИНН должен содержать только цифры")
    if (!values.clients.length) next.clients = t("Обязательное поле")
    if (!values.agentId) next.agentId = t("Обязательное поле")
    if (!values.status) next.status = t("Обязательное поле")
    return next
  }

  const submit = async () => {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    const body = {
      contractNumber: Number(values.contractNumber),
      contractPrefix: values.contractPrefix.trim(),
      contractSuffix: values.contractSuffix.trim(),
      createdDate: values.createdDate,
      officialName: values.officialName.trim(),
      inn: values.inn.replace(/\s/g, ""),
      clientIds: values.clients.map((client) => client.id),
      agentId: Number(values.agentId),
      status: values.status,
      comment: values.comment.trim(),
      organizationId: values.organizationId ? Number(values.organizationId) : null,
    }
    const result = isUpdate ? await cashMutate<ContractDetail>("PUT", `/api/contracts/${contract.id}`, body) : await cashMutate<ContractDetail>("POST", "/api/contracts", body)
    setBusy(false)
    if (result.ok) return onSaved(result.data)
    const field = result.field ? FIELD_OF[result.field] : undefined
    setErrors(field ? { [field]: mutationError(result, t) } : { form: mutationError(result, t) })
  }

  const agentOptions: PickOption[] = (options?.agents ?? []).map((agent) => ({ value: String(agent.id), label: agent.name }))
  if (contract?.agent.id && !agentOptions.some((option) => option.value === String(contract.agent.id))) agentOptions.push({ value: String(contract.agent.id), label: contract.agent.name })
  const organizationOptions: PickOption[] = (options?.organizations ?? []).map((organization) => ({ value: String(organization.id), label: organization.name }))
  const statusOptions: PickOption[] = CONTRACT_STATUSES.map((status) => ({ value: status, label: t(CONTRACT_STATUS_LABELS[status]) }))

  return (
    <CashModal
      title={isUpdate ? t("Изменить договор") : t("Добавить договор")}
      onClose={onClose}
      size="md"
      zIndex={120}
      footer={
        <>
          {errors.form && <span className="mr-auto text-[13px] text-[#e57373]">{errors.form}</span>}
          <PrimaryButton busy={busy} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex flex-col gap-1 text-[13px] text-[#586174]">
          <span>
            {t("Номер контракта")}
            <span className="text-[#e57373]"> *</span>
          </span>
          <div className="flex items-center gap-2">
            <div className="w-24 shrink-0">
              <input value={values.contractPrefix} onChange={(event) => set("contractPrefix", event.target.value)} maxLength={20} placeholder={t("Префикс")} aria-label={t("Префикс")} className={inputClass} />
            </div>
            <div className="relative min-w-0 flex-1">
              <input
                inputMode="numeric"
                value={values.contractNumber}
                onChange={(event) => {
                  setNumberTouched(true)
                  set("contractNumber", event.target.value.replace(/\D/g, ""))
                }}
                aria-label={t("Номер контракта")}
                className={`${inputClass} ${errors.contractNumber ? "border-[#e57373]" : ""}`}
              />
              {numberLoading && <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-[#9aa3b6]" />}
            </div>
            <div className="w-24 shrink-0">
              <input value={values.contractSuffix} onChange={(event) => set("contractSuffix", event.target.value)} maxLength={20} placeholder={t("Суффикс")} aria-label={t("Суффикс")} className={inputClass} />
            </div>
          </div>
          {errors.contractNumber && <span className="text-[12px] text-[#e57373]">{errors.contractNumber}</span>}
          {(values.contractPrefix || values.contractSuffix) && values.contractNumber && (
            <span className="text-[12px] text-[#7b8497]">
              {t("Номер")}: {values.contractPrefix.trim()}
              {values.contractNumber}
              {values.contractSuffix.trim()}
            </span>
          )}
        </div>
        <FormField label={t("Дата создания")} required error={errors.createdDate}>
          <input type="date" value={values.createdDate} onChange={(event) => set("createdDate", event.target.value)} className={`${inputClass} ${errors.createdDate ? "border-[#e57373]" : ""}`} />
        </FormField>
        <FormField label={t("Официальное название")} required error={errors.officialName}>
          <input value={values.officialName} onChange={(event) => set("officialName", event.target.value)} maxLength={300} className={`${inputClass} ${errors.officialName ? "border-[#e57373]" : ""}`} />
        </FormField>
        <FormField label={t("ИНН")} required error={errors.inn}>
          <span className="flex items-center gap-2">
            <input
              inputMode="numeric"
              value={values.inn}
              onChange={(event) => {
                setInnState({ loading: false, text: "" })
                set("inn", event.target.value.replace(/[^\d\s]/g, ""))
              }}
              maxLength={20}
              className={`${inputClass} ${errors.inn ? "border-[#e57373]" : ""}`}
            />
            {values.inn.trim() && (
              <button
                type="button"
                onClick={() => void checkInn()}
                disabled={innState.loading}
                title={t("Проверить данные по ИНН")}
                aria-label={t("Проверить данные по ИНН")}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#dbe0e8] text-[#666] hover:bg-[#f2f5f8] disabled:opacity-50"
              >
                {innState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
              </button>
            )}
          </span>
          {innState.text && <span className="text-[12px] text-[#7b8497]">{innState.text}</span>}
        </FormField>
        <div className="flex flex-col gap-1 text-[13px] text-[#586174]">
          <span>
            {t("Клиенты")}
            <span className="text-[#e57373]"> *</span>
          </span>
          <ClientMultiSelect value={values.clients} onChange={(clients) => set("clients", clients)} invalid={Boolean(errors.clients)} placeholder={t("Выберите клиентов")} />
          {errors.clients && <span className="text-[12px] text-[#e57373]">{errors.clients}</span>}
        </div>
        <FormField label={t("Агент")} required error={errors.agentId}>
          <SearchSelect value={values.agentId} onChange={(value) => set("agentId", value)} options={agentOptions} invalid={Boolean(errors.agentId)} placeholder={t("Агент")} selectedLabel={contract?.agent.name} />
        </FormField>
        <FormField label={t("Статус")} required error={errors.status}>
          <SearchSelect value={values.status} onChange={(value) => set("status", value as ContractStatus | "")} options={statusOptions} invalid={Boolean(errors.status)} placeholder={t("Статус")} />
        </FormField>
        <FormField label={t("Комментарий")}>
          <input value={values.comment} onChange={(event) => set("comment", event.target.value)} maxLength={2000} className={inputClass} />
        </FormField>
        <FormField label={t("Организация")} error={errors.organizationId}>
          <SearchSelect value={values.organizationId} onChange={(value) => set("organizationId", value)} options={organizationOptions} placeholder={t("Организация")} selectedLabel={contract?.organization.name} />
        </FormField>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </CashModal>
  )
}

// --- "Импортировать с excel" -----------------------------------------------------------------

const TEMPLATE: Array<[string, keyof ContractImportRow]> = [
  ["Номер контракта", "contractNumber"],
  ["Префикс", "contractPrefix"],
  ["Суффикс", "contractSuffix"],
  ["Дата создания", "createdDate"],
  ["Официальное название", "officialName"],
  ["ИНН", "inn"],
  ["Клиенты", "clients"],
  ["Агент", "agent"],
  ["Статус", "status"],
  ["Комментарий", "comment"],
  ["Организация", "organization"],
]

const IMPORT_ALIASES: Record<string, keyof ContractImportRow> = {
  "номер контракта": "contractNumber",
  "номер": "contractNumber",
  "shartnoma raqami": "contractNumber",
  "префикс": "contractPrefix",
  "prefix": "contractPrefix",
  "суффикс": "contractSuffix",
  "suffix": "contractSuffix",
  "дата создания": "createdDate",
  "дата": "createdDate",
  "kiritilgan sana": "createdDate",
  "официальное название": "officialName",
  "rasmiy nomi": "officialName",
  "инн": "inn",
  "inn": "inn",
  "клиенты": "clients",
  "клиент": "clients",
  "mijoz": "clients",
  "агент": "agent",
  "agent": "agent",
  "статус": "status",
  "holati": "status",
  "комментарий": "comment",
  "izoh": "comment",
  "организация": "organization",
  "tashkilot": "organization",
}

export function ContractImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (result: ContractImportResult) => void }) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ContractImportResult | null>(null)

  const downloadTemplate = () => downloadExcelTable(t("Шаблон договоров"), [TEMPLATE.map(([title]) => t(title))])
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null)
    setError("")
    setResult(null)
  }

  const save = async () => {
    if (!file) return
    setBusy(true)
    setError("")
    try {
      const rows = await readExcelRows(file)
      // Header: the template titles (Russian or in the UI language) in any order.
      const aliases: Record<string, string> = { ...IMPORT_ALIASES }
      for (const [title, field] of TEMPLATE) aliases[normalizeHeader(t(title))] = field
      const headerIndex = rows.findIndex((row) => mapHeaderColumns(row, aliases).size >= 3)
      if (headerIndex < 0) {
        setError(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fields = mapHeaderColumns(rows[headerIndex], aliases)
      const parsed: ContractImportRow[] = rows
        .slice(headerIndex + 1)
        .map((row) => {
          const record: ContractImportRow = {}
          row.forEach((cell, index) => {
            const field = fields.get(index) as keyof ContractImportRow | undefined
            if (field && cell) record[field] = cell
          })
          return record
        })
        .filter((record) => Object.keys(record).length > 0)
      if (!parsed.length) {
        setError(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const response = await cashMutate<ContractImportResult>("POST", "/api/contracts/import", { rows: parsed })
      if (!response.ok) {
        setError(mutationError(response, t))
        return
      }
      setResult(response.data)
      if (response.data.created) onDone(response.data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CashModal
      title={t("Импортировать с excel")}
      onClose={onClose}
      size="sm"
      zIndex={120}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <SecondaryButton onClick={onClose}>{t("Закрыть")}</SecondaryButton>
          <PrimaryButton tone="green" busy={busy} disabled={!file} onClick={() => void save()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <button type="button" onClick={downloadTemplate} className="self-start font-semibold text-[#4f70e7] hover:underline">
          {t("1. Скачать шаблон")}
        </button>
        <p className="text-[13px] text-[#7b8497]">{t("Клиенты, агент и организация ищутся по названию; несколько клиентов разделяйте «;».")}</p>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={pick} className="hidden" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
        >
          <FileSpreadsheet className="h-8 w-8" />
          {file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}
        </button>
        {result && (
          <div className="rounded-md bg-[#f2f5f8] px-4 py-3 text-[13px] text-[#17233b]">
            <p className="font-semibold">
              {t("Импортировано")}: {result.created}
              {result.errors.length > 0 && (
                <>
                  {" · "}
                  {t("Ошибка")}: {result.errors.length}
                </>
              )}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-[#e57373]">
                {result.errors.map((item) => (
                  <li key={item.row}>
                    {t("Строка")} {item.row}: {t(item.error)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </CashModal>
  )
}
