"use client"

import { useRef, useState, type ReactNode } from "react"
import { FileSpreadsheet } from "lucide-react"

import { CashModal, FormField, PrimaryButton, SearchSelect, inputClass, parseAmount } from "@/components/analytics/cash-management-shared"
import { netCostMutate } from "@/components/analytics/cost-of-goods-shared"
import { downloadExcelTable } from "@/lib/excel-export"
import { readExcelRows } from "@/lib/excel-import"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { NET_COST_API, type NetCostActionKind, type NetCostActionResult, type NetCostImportResult, type NetCostOptions, type NetCostRecord, type NetCostScopeType } from "@/lib/net-cost-types"

// Dialogs of "Себестоимость" (demo c46): "Добавить себестоимость" / "Изменить себестоимость"
// (4347), "Перерасчет" (4667), "Перезаписать" (4668), "Сгенерировать заново" (4669),
// "Пересчитать" → "Изменение" (4277) and "Импорт с Excel" (2131).

function Radio({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-[14px] text-[#17233b]">
      <input type="radio" checked={checked} onChange={onChange} className="h-4 w-4 accent-[#4f71dc]" />
      {children}
    </label>
  )
}

function DateInput({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <FormField label={label} error={error}>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} ${error ? "border-[#e57373]" : ""}`} />
    </FormField>
  )
}

// --- "Добавить себестоимость" / "Изменить себестоимость" ---------------------------------------

export function NetCostEntryDialog({ options, record, onClose, onSaved }: { options: NetCostOptions | null; record: NetCostRecord | null; onClose: () => void; onSaved: (saved: NetCostRecord) => void }) {
  const { t } = useLanguage()
  const [item, setItem] = useState(record?.itemKey ?? "")
  const [cost, setCost] = useState(record ? String(record.realCost) : "")
  const [date, setDate] = useState(record ? record.date.slice(0, 10) : todayIso())
  const [warehouse, setWarehouse] = useState(record?.stock ?? "")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!item) next.item = t("Обязательное поле")
    if (!cost.trim()) next.cost = t("Обязательное поле")
    else if (!(parseAmount(cost) >= 0) || !/^[\d\s.,]+$/.test(cost.trim())) next.cost = t("Введите число")
    if (!date) next.date = t("Обязательное поле")
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setError("")
    const body = { item, cost: parseAmount(cost), date, warehouse }
    const result = record ? await netCostMutate<NetCostRecord>("PUT", `${NET_COST_API}/${record.id}`, body) : await netCostMutate<NetCostRecord>("POST", NET_COST_API, body)
    setBusy(false)
    if (!result.ok) return setError(t(result.error))
    onSaved(result.data)
  }

  return (
    <CashModal
      title={t(record ? "Изменить себестоимость" : "Добавить себестоимость")}
      onClose={onClose}
      size="md"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label={t("Продукт")} required error={errors.item}>
          <SearchSelect
            value={item}
            disabled={Boolean(record)}
            invalid={Boolean(errors.item)}
            selectedLabel={record?.itemName}
            options={(options?.items ?? []).map((option) => ({ value: option.key, label: option.name, hint: option.kind === "raw_material" ? t("Сырье") : undefined }))}
            onChange={(value) => setItem(value)}
          />
        </FormField>
        <FormField label={t("Себестоимость")} required error={errors.cost}>
          <input value={cost} inputMode="decimal" onChange={(event) => setCost(event.target.value)} className={`${inputClass} ${errors.cost ? "border-[#e57373]" : ""}`} />
        </FormField>
        <DateInput label={t("Дата")} value={date} onChange={setDate} error={errors.date} />
        <FormField label={t("Склад (пусто — общие склады)")}>
          <SearchSelect value={warehouse} options={(options?.warehouses ?? []).map((name) => ({ value: name, label: name }))} placeholder={t("Общий")} onChange={(value) => setWarehouse(value)} />
        </FormField>
        <p className="rounded bg-[#fff8e1] px-3 py-2.5 text-[12px] leading-snug text-[#666]">{t("Себестоимость действует с начала выбранного дня. Документы с этой даты пересчитываются автоматически.")}</p>
      </div>
    </CashModal>
  )
}

// --- "Перерасчет" / "Перезаписать" / "Сгенерировать заново" / "Изменение" -----------------------

type ActionDialogKind = Exclude<NetCostActionKind, "recheck">

const ACTION_TEXT: Record<ActionDialogKind, { title: string; submit: string; success: string }> = {
  recalc: { title: "Перерасчет", submit: "Сохранить", success: "Успешно пересчитано" },
  "reset-period": { title: "Перезаписать", submit: "Сохранить", success: "Успешно перезаписано" },
  regenerate: { title: "Сгенерировать заново", submit: "Сгенерировать", success: "Успешно перезаписано" },
  "recalc-period": { title: "Изменение", submit: "Изменить", success: "Успешно пересчитано" },
}

export function NetCostActionDialog({
  kind,
  options,
  onClose,
  onDone,
}: {
  kind: ActionDialogKind
  options: NetCostOptions | null
  onClose: () => void
  onDone: (result: NetCostActionResult, message: string) => void
}) {
  const { t } = useLanguage()
  const text = ACTION_TEXT[kind]
  const [onlyWrong, setOnlyWrong] = useState(kind === "recalc")
  const [beginDate, setBeginDate] = useState(kind === "regenerate" ? monthStartIso() : "")
  const [endDate, setEndDate] = useState(kind === "regenerate" ? monthEndIso() : "")
  const [product, setProduct] = useState("")
  const [stockType, setStockType] = useState<NetCostScopeType>("all")
  const [stock, setStock] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const needsDates = kind !== "recalc"
  const showFilters = kind !== "recalc" || !onlyWrong

  const submit = async () => {
    const next: Record<string, string> = {}
    if (needsDates && !beginDate) next.beginDate = t("Обязательное поле")
    if (needsDates && !endDate) next.endDate = t("Обязательное поле")
    if (showFilters && kind !== "recalc-period" && stockType === "own" && !stock) next.stock = t("Обязательное поле")
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    setError("")
    const body = kind === "recalc-period" ? { beginDate, endDate } : { onlyWrong: kind === "recalc" && onlyWrong, beginDate, endDate, product, stockType, stock: stockType === "own" ? stock : "" }
    const result = await netCostMutate<NetCostActionResult>("POST", `${NET_COST_API}/actions/${kind}`, body)
    setBusy(false)
    if (!result.ok) return setError(t(result.error))
    onDone(result.data, text.success)
  }

  return (
    <CashModal
      title={t(text.title)}
      onClose={onClose}
      size="md"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void submit()}>
            {t(text.submit)}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {kind === "regenerate" && (
          <p className="text-[14px] text-[#17233b]">
            {t("Себестоимости продуктов будут сгенерированы заново за указанный период. При этом старые данные будут удалены, а текущие значения себестоимостей могут измениться.")}
          </p>
        )}
        {kind === "recalc" && (
          <div className="flex flex-col gap-2">
            <Radio checked={onlyWrong} onChange={() => setOnlyWrong(true)}>
              {t("Пересчитать только ошибки")}
            </Radio>
            <Radio checked={!onlyWrong} onChange={() => setOnlyWrong(false)}>
              {t("Пересчитать выбранные")}
            </Radio>
          </div>
        )}
        {showFilters && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DateInput label={t(kind === "recalc-period" ? "Дата начала" : "Дата от")} value={beginDate} onChange={setBeginDate} error={errors.beginDate} />
              <DateInput label={t(kind === "recalc-period" ? "Дата завершения" : "Дата до")} value={endDate} onChange={setEndDate} error={errors.endDate} />
            </div>
            {kind === "recalc" && (
              <FormField label={t("Продукт")}>
                <SearchSelect value={product} options={(options?.items ?? []).map((option) => ({ value: option.key, label: option.name }))} placeholder={t("Все")} onChange={(value) => setProduct(value)} />
              </FormField>
            )}
            {kind !== "recalc-period" && (
              <div className="flex flex-col gap-2">
                <Radio checked={stockType === "all"} onChange={() => setStockType("all")}>
                  {t("Все")}
                </Radio>
                <Radio checked={stockType === "common"} onChange={() => setStockType("common")}>
                  {t("Общие склады")}
                </Radio>
                <Radio checked={stockType === "own"} onChange={() => setStockType("own")}>
                  {t("Выбранный склад")}
                </Radio>
              </div>
            )}
            {kind !== "recalc-period" && stockType === "own" && (
              <FormField label={t("Склад")} required error={errors.stock}>
                <SearchSelect value={stock} invalid={Boolean(errors.stock)} options={(options?.warehouses ?? []).map((name) => ({ value: name, label: name }))} onChange={(value) => setStock(value)} />
              </FormField>
            )}
          </>
        )}
      </div>
    </CashModal>
  )
}

// --- "Импорт с Excel" ----------------------------------------------------------------------------

export function NetCostImportDialog({ options, onClose, onDone }: { options: NetCostOptions | null; onClose: () => void; onDone: (result: NetCostImportResult) => void }) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [rowErrors, setRowErrors] = useState<Array<{ row: number; error: string }>>([])

  const template = () =>
    downloadExcelTable(`${t("Себестоимость")} - ${t("шаблон")}`, [
      [t("Наименование"), t("Себестоимость"), `${t("Дата")} (YYYY-MM-DD)`, t("Склад")],
      ...(options?.items ?? []).map((item) => [item.name, "", todayIso(), ""]),
    ])

  const submit = async () => {
    if (!file) return setError(t("Выберите файл"))
    setBusy(true)
    setError("")
    setRowErrors([])
    const rows = await readExcelRows(file)
    if (rows.length < 2) {
      setBusy(false)
      return setError(t("Не удалось найти товары для импорта в выбранном файле"))
    }
    const result = await netCostMutate<NetCostImportResult>("POST", `${NET_COST_API}/import`, { rows })
    setBusy(false)
    if (!result.ok) {
      setError(t(result.error))
      setRowErrors(result.rows)
      return
    }
    onDone(result.data)
  }

  return (
    <CashModal
      title={t("Импорт с Excel")}
      onClose={onClose}
      size="md"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void submit()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <button type="button" onClick={template} className="mb-3 text-[13px] font-semibold uppercase text-[#4f71dc] hover:underline">
        {t("1. Скачать шаблон")}
      </button>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") input.current?.click()
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDrag(false)
          const dropped = event.dataTransfer.files?.[0]
          if (dropped) setFile(dropped)
        }}
        className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 text-center text-[14px] ${drag ? "border-[#4f71dc] bg-[#eef2ff]" : "border-[#dbe0e8]"}`}
      >
        <FileSpreadsheet className="h-8 w-8 text-[#71ce87]" />
        {file ? <span className="font-semibold text-[#17233b]">{file.name}</span> : <span className="text-[#586174]">{t("2. Добавьте файл Excel или нажмите для выбора")}</span>}
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0]
          if (picked) setFile(picked)
          event.target.value = ""
        }}
      />
      <p className="mt-3 text-[12px] text-[#9aa3b6]">{t("Колонки: Наименование, Себестоимость, Дата, Склад (пусто — общие склады). Строки без себестоимости пропускаются.")}</p>
      {rowErrors.length > 0 && (
        <ul className="mt-3 max-h-48 overflow-y-auto rounded-md bg-[#fdecea] px-3 py-2 text-[13px] text-[#b71c1c]">
          {rowErrors.map((entry) => (
            <li key={`${entry.row}-${entry.error}`}>
              {t("Строка")} {entry.row}: {t(entry.error)}
            </li>
          ))}
        </ul>
      )}
    </CashModal>
  )
}
