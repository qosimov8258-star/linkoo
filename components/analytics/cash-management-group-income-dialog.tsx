"use client"

import { useMemo, useRef, useState } from "react"
import { Download, Pencil, Plus, Trash2, Upload, Users } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { RateBlock } from "@/components/analytics/cash-management-operation-dialog"
import {
  CashModal,
  FormField,
  PrimaryButton,
  SearchSelect,
  formatCash,
  inputClass,
  mutationError,
  parseAmount,
  useCashRates,
  useClientSearch,
  useJsonList,
  type CashCategory,
  type Named,
  type PickOption,
} from "@/components/analytics/cash-management-shared"
import type { CashboxWithBalance } from "@/lib/cash/types"
import type { ContractOption } from "@/lib/contracts-types"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// "Груповой приход" (demo modules 3860 + 3861, POST /finance/group_client_payment/):
// payment details on the left (date, branch, cashbox, income category, debt
// currency, responsible, verified, "Разные даты для каждой оплаты", rates),
// client rows on the right (Клиент | Контракт | Сумма | Организация | Дата |
// Комментарий), "Показать клиентов по агенту" and "Импортировать c Excel"
// (parsed in the browser, matched by POST /api/cash/group-payment/match).
// Saves one client payment per row: POST /api/cash/group-payment.

type Row = { key: number; clientId: number; clientName: string; contractId: string; contractLabel: string; amount: string; organization: string; date: string; comment: string }
type NotFound = { key: number; client: string; amount: string; organization: string; date: string; comment: string; clientId: string; clientName: string }
type ClientLite = { id: number; name: string; agent?: string }

const TEMPLATE_HEADERS = ["Клиент", "ИНН", "Код", "Сумма", "Организация", "Дата", "Комментарий"]
const HEADER_ALIASES: Record<string, string[]> = {
  client: ["клиент", "mijoz", "client", "клиенты", "наименование", "название", "nomi"],
  inn: ["инн", "inn", "stir"],
  code: ["код", "code", "kod", "код клиента"],
  amount: ["сумма", "summa", "miqdori", "amount", "sum"],
  organization: ["организация", "tashkilot", "organization"],
  date: ["дата", "sana", "date"],
  comment: ["комментарий", "izoh", "comment", "примечание"],
}

let rowSeq = 1

/** "DD.MM.YYYY" / "YYYY-MM-DD" / Excel text → ISO day or "". */
function importDay(value: unknown): string {
  const text = String(value ?? "").trim()
  if (!text) return ""
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(text)
  if (dotted) return `${dotted[3]}-${dotted[2].padStart(2, "0")}-${dotted[1].padStart(2, "0")}`
  return ""
}

export function CashGroupIncomeDialog({ cashboxes, onClose, onSaved }: { cashboxes: CashboxWithBalance[]; onClose: () => void; onSaved: (count: number) => void }) {
  const { t } = useLanguage()
  const { base, rates, codes } = useCashRates()
  const branches = useJsonList<Named>("/api/branches").items
  const organizations = useJsonList<Named>("/api/organizations").items
  const employees = useJsonList<Named>("/api/employees").items
  const categoriesState = useCashJson<{ categories: CashCategory[] }>("/api/cash/categories?kind=income")
  const categories = useMemo(() => (categoriesState.data?.categories ?? []).filter((item) => item.options.includes("client")), [categoriesState.data])

  const [date, setDate] = useState(() => nowLocalIso().slice(0, 16))
  const [branch, setBranch] = useState("")
  const [cashboxId, setCashboxId] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [debtCurrency, setDebtCurrency] = useState("")
  const [responsibleId, setResponsibleId] = useState("")
  const [isVerified, setIsVerified] = useState(true)
  const [isDate, setIsDate] = useState(false)
  const [rate, setRate] = useState({ individualRate: false, customRate: "", debtRate: "" })
  const [rows, setRows] = useState<Row[]>([])
  const [notFounds, setNotFounds] = useState<NotFound[]>([])
  const [entry, setEntry] = useState({ clientId: "", clientName: "", contractId: "", amount: "", organization: "", date: "", comment: "" })
  const [entryError, setEntryError] = useState("")
  const [agentOpen, setAgentOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const clients = useClientSearch(true)
  // Active contracts of the entry's client (GET /api/contracts/options).
  const contracts = useJsonList<ContractOption>(entry.clientId ? `/api/contracts/options?clientId=${entry.clientId}` : null).items
  const allClients = useJsonList<ClientLite>(agentOpen ? "/api/clients" : null)

  const cashbox = cashboxes.find((item) => String(item.id) === cashboxId)
  const cashCurrency = cashbox ? normCurrency(cashbox.currency, base) : ""
  const debt = debtCurrency && debtCurrency !== cashCurrency ? debtCurrency : ""
  const total = rows.reduce((sum, row) => sum + Math.max(0, parseAmount(row.amount)), 0)
  const categoryValue = categoryId || (categories[0] ? String(categories[0].id) : "")

  const contractOptions = (clientName: string): PickOption[] =>
    clientName ? contracts.map((contract) => ({ value: String(contract.id), label: `${t("Договор №")}: ${contract.fullNumber}`, hint: contract.hint })) : []
  const organizationOptions = organizations.map((item) => ({ value: item.name, label: item.name }))
  const agents = useMemo(() => [...new Set(allClients.items.map((client) => (client.agent ?? "").trim()).filter((agent) => agent && agent !== "Не указано"))].sort((a, b) => a.localeCompare(b, "ru")), [allClients.items])

  const applyEntry = () => {
    if (!entry.clientId) return setEntryError(t("Укажите клиента"))
    if (!(parseAmount(entry.amount) > 0)) return setEntryError(t("Укажите сумму"))
    const contract = contracts.find((item) => String(item.id) === entry.contractId)
    setRows((current) => [
      ...current,
      {
        key: rowSeq++,
        clientId: Number(entry.clientId),
        clientName: entry.clientName,
        contractId: entry.contractId,
        contractLabel: contract ? `№ ${contract.fullNumber}` : "",
        amount: entry.amount,
        organization: entry.organization,
        date: entry.date,
        comment: entry.comment,
      },
    ])
    // Keep the organization / date for the next row (demo keeps the form values).
    setEntry((current) => ({ ...current, clientId: "", clientName: "", contractId: "", amount: "", comment: "" }))
    setEntryError("")
  }

  const editRow = (row: Row) => {
    setEntry({ clientId: String(row.clientId), clientName: row.clientName, contractId: row.contractId, amount: row.amount, organization: row.organization, date: row.date, comment: row.comment })
    setRows((current) => current.filter((item) => item.key !== row.key))
  }

  const addAgentClients = (agent: string) => {
    const existing = new Set(rows.map((row) => row.clientId))
    const added = allClients.items
      .filter((client) => (client.agent ?? "").trim() === agent && !existing.has(client.id))
      .map((client) => ({ key: rowSeq++, clientId: client.id, clientName: client.name, contractId: "", contractLabel: "", amount: "", organization: entry.organization, date: entry.date, comment: "" }))
    setRows((current) => [...current, ...added])
    setAgentOpen(false)
  }

  const importFile = async (file: File) => {
    setImporting(true)
    setError("")
    try {
      const XLSX = await import("xlsx")
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd", defval: "" })
      const header = (table[0] ?? []).map((cell) => String(cell ?? "").trim().toLowerCase())
      const columns: Record<string, number> = {}
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        const names = [...aliases, t(TEMPLATE_HEADERS[Object.keys(HEADER_ALIASES).indexOf(field)] ?? "").toLowerCase()]
        const index = header.findIndex((cell) => names.includes(cell))
        if (index >= 0) columns[field] = index
      }
      const hasHeader = columns.client !== undefined || columns.amount !== undefined || columns.inn !== undefined
      if (!hasHeader) Object.assign(columns, { client: 0, amount: 1, organization: 2, date: 3, comment: 4 })
      const cell = (line: unknown[], field: string) => (columns[field] === undefined ? "" : String(line[columns[field]] ?? "").trim())
      const parsed = table
        .slice(hasHeader ? 1 : 0)
        .map((line) => ({
          client: cell(line, "client"),
          inn: cell(line, "inn"),
          code: cell(line, "code"),
          amount: cell(line, "amount"),
          organization: cell(line, "organization"),
          date: importDay(cell(line, "date")),
          comment: cell(line, "comment"),
        }))
        .filter((line) => line.client || line.inn || line.code || line.amount)
      if (!parsed.length) {
        setError(t("Файл пуст"))
        return
      }
      const result = await cashMutate<{
        founds: Array<{ clientId: number; clientName: string; amount: number; organization?: string; date?: string; comment?: string }>
        notFounds: Array<{ client?: string; inn?: string; code?: string; amount?: number | string; organization?: string; date?: string; comment?: string }>
      }>("POST", "/api/cash/group-payment/match", { rows: parsed.map((line) => ({ ...line, date: line.date || undefined })) })
      if (!result.ok) {
        setError(mutationError(result, t))
        return
      }
      const organizationsByName = new Set(organizations.map((item) => item.name))
      setRows((current) => [
        ...current,
        ...result.data.founds.map((found) => ({
          key: rowSeq++,
          clientId: found.clientId,
          clientName: found.clientName,
          contractId: "",
          contractLabel: "",
          amount: String(found.amount),
          organization: found.organization && (organizationsByName.has(found.organization) || !organizations.length) ? found.organization : entry.organization,
          date: found.date ?? "",
          comment: found.comment ?? "",
        })),
      ])
      setNotFounds((current) => [
        ...current,
        ...result.data.notFounds.map((row) => ({
          key: rowSeq++,
          client: row.client || row.inn || row.code || "",
          amount: String(row.amount ?? ""),
          organization: row.organization ?? "",
          date: row.date ?? "",
          comment: row.comment ?? "",
          clientId: "",
          clientName: "",
        })),
      ])
      // Demo: an import switches to "Разные даты для каждой оплаты" when the file has dates.
      if (result.data.founds.some((found) => found.date)) setIsDate(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const resolveNotFound = (item: NotFound) => {
    if (!item.clientId || !(parseAmount(item.amount) > 0)) return
    setRows((current) => [
      ...current,
      { key: rowSeq++, clientId: Number(item.clientId), clientName: item.clientName, contractId: "", contractLabel: "", amount: item.amount, organization: item.organization, date: item.date, comment: item.comment },
    ])
    setNotFounds((current) => current.filter((row) => row.key !== item.key))
  }

  const submit = async () => {
    setError("")
    if (!cashboxId) return setError(t("Выберите кассу"))
    const payload = rows.filter((row) => parseAmount(row.amount) > 0)
    if (!payload.length) return setError(t("Укажите сумму оплаты"))
    if (rate.individualRate && ((cashCurrency !== base && !(parseAmount(rate.customRate) > 0)) || (debt && debt !== base && !(parseAmount(rate.debtRate) > 0)))) return setError(t("Курс валюты не задан"))
    setBusy(true)
    const result = await cashMutate<{ count: number; total: number }>("POST", "/api/cash/group-payment", {
      date: isDate ? undefined : date,
      cashboxId: Number(cashboxId),
      branch: branch || undefined,
      categoryId: categoryValue ? Number(categoryValue) : undefined,
      isVerified,
      responsibleId: responsibleId ? Number(responsibleId) : undefined,
      debtCurrency: debt || undefined,
      rateType: rate.individualRate ? "custom" : "current",
      customRate: rate.individualRate && cashCurrency !== base && parseAmount(rate.customRate) > 0 ? parseAmount(rate.customRate) : undefined,
      debtRate: rate.individualRate && debt && debt !== base && parseAmount(rate.debtRate) > 0 ? parseAmount(rate.debtRate) : undefined,
      rows: payload.map((row) => ({
        clientId: row.clientId,
        amount: parseAmount(row.amount),
        contractId: row.contractId ? Number(row.contractId) : undefined,
        organization: row.organization || undefined,
        date: isDate && row.date ? row.date : undefined,
        comment: row.comment.trim() || undefined,
      })),
    })
    setBusy(false)
    if (!result.ok) return setError(mutationError(result, t))
    onSaved(result.data.count)
  }

  return (
    <CashModal
      title={t("Групповой приход")}
      onClose={onClose}
      size="full"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={submit}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {!isDate && (
            <FormField label={t("Дата создания")}>
              <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
            </FormField>
          )}
          <FormField label={t("Филиал")}>
            <SearchSelect value={branch} onChange={setBranch} options={branches.map((item) => ({ value: item.name, label: item.name }))} placeholder={t("Филиал")} />
          </FormField>
          <FormField label={t("Касса")} required>
            <SearchSelect
              value={cashboxId}
              onChange={(value) => {
                setCashboxId(value)
                setRate({ individualRate: false, customRate: "", debtRate: "" })
              }}
              options={cashboxes.map((item) => ({ value: String(item.id), label: `${item.name} (${currencyLabel(item.currency)})`, hint: item.branch }))}
              placeholder={t("Касса")}
            />
          </FormField>
          <FormField label={t("Категория прихода")}>
            <SearchSelect value={categoryValue} onChange={setCategoryId} options={categories.map((item) => ({ value: String(item.id), label: item.name }))} placeholder={t("Категория прихода")} allowClear={false} />
          </FormField>
          <FormField label={t("Индивидуальная покрытия долга")}>
            <select value={debtCurrency} onChange={(event) => setDebtCurrency(event.target.value)} className={inputClass}>
              <option value="">{t("Не указано")}</option>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {currencyLabel(code)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={t("Ответственный персонал")}>
            <SearchSelect value={responsibleId} onChange={setResponsibleId} options={employees.map((item) => ({ value: String(item.id), label: item.name }))} placeholder={t("Ответственный персонал")} />
          </FormField>
          <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
            <input type="checkbox" checked={isVerified} onChange={(event) => setIsVerified(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Подтвержденный приход (Я получил деньги)")}
          </label>
          <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
            <input type="checkbox" checked={isDate} onChange={(event) => setIsDate(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Разные даты для каждой оплаты")}
          </label>
          {cashCurrency && (
            <RateBlock
              base={base}
              rates={rates}
              cashCurrency={cashCurrency}
              debtCurrency={debt}
              amount={total}
              individual={rate.individualRate}
              customRate={rate.customRate}
              debtRate={rate.debtRate}
              onChange={(next) => setRate((current) => ({ ...current, ...next }))}
            />
          )}
          <p className="text-[15px] font-semibold text-[#17233b]">
            {t("Общая сумма")}: {formatCash(total, cashCurrency || base)}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="mr-auto text-[16px] font-semibold text-[#17233b]">{t("Список")}</h3>
            <div className="relative">
              <button type="button" onClick={() => setAgentOpen((current) => !current)} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#4f70e7] px-3 text-[13px] font-semibold text-[#4f70e7]">
                <Users className="h-4 w-4" /> {t("Показать клиентов по агенту")}
              </button>
              {agentOpen && (
                <div className="absolute right-0 top-full z-[20] mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-[#e1e5eb] bg-white py-1 shadow-lg">
                  {allClients.loading && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{t("Загрузка...")}</p>}
                  {!allClients.loading && !agents.length && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
                  {agents.map((agent) => (
                    <button key={agent} type="button" onClick={() => addAgentClients(agent)} className="block w-full px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8]">
                      {agent}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#4caf72] px-3 text-[13px] font-semibold text-white disabled:opacity-50">
              <Upload className="h-4 w-4" /> {importing ? t("Загрузка...") : t("Импортировать c Excel")}
            </button>
            <button type="button" onClick={() => downloadExcelTable("group-payment-template", [TEMPLATE_HEADERS.map((label) => t(label))])} className="inline-flex h-9 items-center gap-1 text-[13px] font-semibold text-[#4caf72] hover:underline">
              <Download className="h-4 w-4" /> {t("Шаблон")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importFile(file)
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-md bg-[#f7f9fc] p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
            <FormField label={t("Клиент")} required>
              <SearchSelect
                value={entry.clientId}
                selectedLabel={entry.clientName}
                onChange={(value, option) => {
                  setEntry((current) => ({ ...current, clientId: value, clientName: option?.label ?? "", contractId: "" }))
                  setEntryError("")
                }}
                options={clients.options}
                onSearch={clients.search}
                loading={clients.loading}
                placeholder={t("Клиент")}
              />
            </FormField>
            <FormField label={t("Контракт")}>
              <SearchSelect value={entry.contractId} onChange={(value) => setEntry((current) => ({ ...current, contractId: value }))} options={contractOptions(entry.clientName)} placeholder={t("Контракт")} disabled={!entry.clientId} />
            </FormField>
            <FormField label={t("Сумма")} required>
              <input
                type="number"
                min="0"
                step="any"
                value={entry.amount}
                onChange={(event) => setEntry((current) => ({ ...current, amount: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyEntry()
                }}
                className={inputClass}
              />
            </FormField>
            <FormField label={t("Организация")}>
              <SearchSelect value={entry.organization} onChange={(value) => setEntry((current) => ({ ...current, organization: value }))} options={organizationOptions} placeholder={t("Организация")} />
            </FormField>
            {isDate && (
              <FormField label={t("Дата создания")}>
                <input type="date" value={entry.date} onChange={(event) => setEntry((current) => ({ ...current, date: event.target.value }))} className={inputClass} />
              </FormField>
            )}
            <FormField label={t("Комментарий")} className={isDate ? "" : "sm:col-span-2 xl:col-span-4"}>
              <input
                value={entry.comment}
                onChange={(event) => setEntry((current) => ({ ...current, comment: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyEntry()
                }}
                className={inputClass}
              />
            </FormField>
            <div className="flex items-end">
              <button type="button" onClick={applyEntry} className="inline-flex h-10 items-center gap-1 rounded-md bg-[#4f71dc] px-4 font-semibold text-white hover:brightness-95">
                <Plus className="h-4 w-4" /> {t("Применить")}
              </button>
            </div>
            {entryError && <span className="text-[12px] text-[#e57373] sm:col-span-2">{entryError}</span>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="bg-[#edf2f7] text-left text-[#253653]">
                  <th className="px-2 py-2">№</th>
                  <th className="px-2 py-2">{t("Клиент")}</th>
                  <th className="px-2 py-2">{t("Контракт")}</th>
                  <th className="px-2 py-2">{t("Сумма")}</th>
                  <th className="px-2 py-2">{t("Организация")}</th>
                  {isDate && <th className="px-2 py-2">{t("Дата создания")}</th>}
                  <th className="px-2 py-2">{t("Комментарий")}</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key} className="border-b border-[#e1e5eb]">
                    <td className="px-2 py-1.5">{index + 1}</td>
                    <td className="px-2 py-1.5">{row.clientName}</td>
                    <td className="px-2 py-1.5">{row.contractLabel || "—"}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={row.amount}
                        onChange={(event) => setRows((current) => current.map((item) => (item.key === row.key ? { ...item, amount: event.target.value } : item)))}
                        className="h-8 w-32 rounded-md border border-[#dbe0e8] px-2"
                        aria-label={t("Сумма")}
                      />
                    </td>
                    <td className="px-2 py-1.5">{row.organization || "—"}</td>
                    {isDate && (
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={row.date}
                          onChange={(event) => setRows((current) => current.map((item) => (item.key === row.key ? { ...item, date: event.target.value } : item)))}
                          className="h-8 rounded-md border border-[#dbe0e8] px-2"
                          aria-label={t("Дата создания")}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5">{row.comment || "—"}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button type="button" onClick={() => editRow(row)} aria-label={t("Изменить")} className="mr-2 text-[#4f70e7]">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} aria-label={t("Удалить")} className="text-[#e57373]">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={isDate ? 8 : 7} className="px-2 py-8 text-center text-[#9aa3b6]">
                      {t("Список пуст")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {notFounds.length > 0 && (
            <div className="rounded-md border border-[#f3c4c4] bg-[#fff8f8] p-3">
              <p className="mb-2 font-semibold text-[#c94b4b]">
                {t("Не найдено")}: {notFounds.length}
              </p>
              <div className="flex flex-col gap-2">
                {notFounds.map((item) => (
                  <NotFoundRow
                    key={item.key}
                    item={item}
                    onChange={(next) => setNotFounds((current) => current.map((row) => (row.key === item.key ? next : row)))}
                    onAdd={() => resolveNotFound(item)}
                    onRemove={() => setNotFounds((current) => current.filter((row) => row.key !== item.key))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </CashModal>
  )
}

function NotFoundRow({ item, onChange, onAdd, onRemove }: { item: NotFound; onChange: (item: NotFound) => void; onAdd: () => void; onRemove: () => void }) {
  const { t } = useLanguage()
  const clients = useClientSearch(true)
  return (
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_120px_auto]">
      <span className="truncate text-[13px] text-[#17233b]" title={item.client}>
        {item.client || "—"}
      </span>
      <SearchSelect
        value={item.clientId}
        selectedLabel={item.clientName}
        onChange={(value, option) => onChange({ ...item, clientId: value, clientName: option?.label ?? "" })}
        options={clients.options}
        onSearch={clients.search}
        loading={clients.loading}
        placeholder={t("Клиент")}
      />
      <input type="number" min="0" step="any" value={item.amount} onChange={(event) => onChange({ ...item, amount: event.target.value })} className={inputClass} aria-label={t("Сумма")} />
      <span className="flex items-center gap-2">
        <button type="button" disabled={!item.clientId || !(parseAmount(item.amount) > 0)} onClick={onAdd} className="rounded-md bg-[#4f71dc] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
          {t("Добавить")}
        </button>
        <button type="button" onClick={onRemove} aria-label={t("Удалить")} className="text-[#e57373]">
          <Trash2 className="h-4 w-4" />
        </button>
      </span>
    </div>
  )
}
