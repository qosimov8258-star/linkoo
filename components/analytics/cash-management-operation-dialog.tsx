"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Search, Trash2 } from "lucide-react"

import { cashMutate, useCashJson, useCashOperation } from "@/components/analytics/cash/use-cash"
import {
  CashModal,
  ErrorBlock,
  FormField,
  LoadingBlock,
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
import { rateOf, type RateMap } from "@/lib/cash/rates"
import type { ContractOption } from "@/lib/contracts-types"
import { CATEGORY_OPTIONS, type CashboxWithBalance, type CashOperation, type CashOperationInput, type CashWriteResult, type CategoryOptionKey, type MoneyRequest } from "@/lib/cash/types"
import { currencyLabel, formatMoney, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// "Приход" / "Расход" dialog of the cash page (demo module 1658,
// TransactionCreateForm) in its four modes: create, edit (PUT), duplicate
// (prefilled, POST as new) and paying an approved money request
// ("Оплатить" in "Запрос средств" → POST /api/cash/money-requests/[id]/pay).
// The category's FIRST applicable option decides which counterparty the
// form collects (client / order / provider / supply / supply expense /
// staff / detalization / amortization), exactly as the core validates it.
// "Касса" lists the cashboxes of the chosen "Филиал" (and those without a
// branch); a new operation starts on the cashbox selected on the page.

export type OperationDialogState = {
  kind: "income" | "expense"
  mode: "create" | "edit" | "duplicate" | "pay"
  /** edit / duplicate: operation key (cash-12, customer-5, supplier-3). */
  operationKey?: string
  /** pay: the approved money request. */
  request?: MoneyRequest
  /** create: the cashbox selected on the page — preselected, with its branch. */
  cashboxId?: number
}

const NO_BRANCH = new Set(["", "-", "—", "не указано", "не указан", "все", "все филиалы"])

/** Comparable branch name ("" = no branch). */
function branchKey(value: string | null | undefined): string {
  const key = String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
  return NO_BRANCH.has(key) ? "" : key
}

/** A cashbox belongs to `branch` when either has no branch or both name the same one. */
function inBranch(cashbox: Pick<CashboxWithBalance, "branch">, branch: string): boolean {
  const wanted = branchKey(branch)
  const own = branchKey(cashbox.branch)
  return !wanted || !own || own === wanted
}

/** The cashbox's own branch as the form stores it ("" when it has none). */
function branchOf(cashbox: Pick<CashboxWithBalance, "branch">): string {
  return branchKey(cashbox.branch) ? cashbox.branch.trim() : ""
}

type Values = {
  date: string
  branch: string
  cashboxId: string
  organization: string
  categoryId: string
  amount: string
  comment: string
  isVerified: boolean
  clientId: string
  clientLabel: string
  contractId: string
  orderId: string
  orderLabel: string
  supplierId: string
  supplyId: string
  supplyExpenseId: string
  responsibleId: string
  staff: Record<string, string>
  children: Array<{ name: string; amount: string }>
  amortizationFrom: string
  amortizationTo: string
  debtCurrency: string
  individualRate: boolean
  customRate: string
  debtRate: string
  moneyRequestId: number | null
}

type Errors = Partial<Record<keyof Values | "staff" | "children" | "rate" | "form", string>>

/** Server error field (demo form names) → our field. */
const SERVER_FIELDS: Record<string, keyof Errors> = {
  cashbox: "cashboxId",
  division: "organization",
  date: "date",
  expenseCategory: "categoryId",
  incomeCategory: "categoryId",
  supply: "supplyId",
  supplyExpense: "supplyExpenseId",
  clientContract: "contractId",
  contract: "contractId",
  client: "clientId",
  provider: "supplierId",
  amount: "amount",
  order: "orderId",
  comment: "comment",
  currencyRate: "rate",
  responsibleDeliveryMan: "responsibleId",
  staffs: "staff",
  transactionChild: "children",
}

const str = (value: number | null | undefined) => (value ? String(value) : "")
const localInput = (iso: string | undefined) => (iso ? iso.slice(0, 16) : nowLocalIso().slice(0, 16))

function emptyValues(): Values {
  return {
    date: nowLocalIso().slice(0, 16),
    branch: "",
    cashboxId: "",
    organization: "",
    categoryId: "",
    amount: "",
    comment: "",
    isVerified: true,
    clientId: "",
    clientLabel: "",
    contractId: "",
    orderId: "",
    orderLabel: "",
    supplierId: "",
    supplyId: "",
    supplyExpenseId: "",
    responsibleId: "",
    staff: {},
    children: [{ name: "", amount: "" }],
    amortizationFrom: "",
    amortizationTo: "",
    debtCurrency: "",
    individualRate: false,
    customRate: "",
    debtRate: "",
    moneyRequestId: null,
  }
}

function valuesFromInput(input: CashOperationInput, operation: CashOperation, duplicate: boolean): Values {
  const staff: Record<string, string> = {}
  for (const row of input.staff ?? []) staff[String(row.employeeId)] = String(row.amount)
  const children = (input.children ?? []).map((row) => ({ name: row.name, amount: String(row.amount) }))
  return {
    ...emptyValues(),
    date: duplicate ? nowLocalIso().slice(0, 16) : localInput(input.date),
    branch: input.branch ?? "",
    cashboxId: str(input.cashboxId),
    organization: input.organization ?? "",
    categoryId: str(input.categoryId),
    amount: input.amount ? String(input.amount) : "",
    comment: input.comment ?? "",
    isVerified: duplicate ? true : input.isVerified !== false,
    clientId: str(input.clientId),
    clientLabel: operation.client?.name ?? "",
    contractId: str(input.contractId),
    orderId: str(input.orderId),
    orderLabel: input.orderId ? `№ ${input.orderId}${operation.client ? ` · ${operation.client.name}` : ""}` : "",
    supplierId: str(input.supplierId),
    supplyId: str(input.supplyId),
    supplyExpenseId: str(input.supplyExpenseId),
    responsibleId: str(input.responsibleId),
    staff,
    children: children.length ? children : [{ name: "", amount: "" }],
    amortizationFrom: input.amortizationFrom ?? "",
    amortizationTo: input.amortizationTo ?? "",
    debtCurrency: input.debtCurrency ?? "",
    individualRate: input.rateType === "custom",
    customRate: input.customRate ? String(input.customRate) : "",
    debtRate: input.debtRate ? String(input.debtRate) : "",
    moneyRequestId: duplicate ? null : (input.moneyRequestId ?? null),
  }
}

/** Options of the category that apply to this dialog (the core's applicableOptions). */
export function applicableOptions(category: CashCategory | undefined, kind: "income" | "expense"): CategoryOptionKey[] {
  return (category?.options ?? []).filter((key) => CATEGORY_OPTIONS[key]?.[kind])
}

export function CashOperationDialog({
  state,
  cashboxes,
  onClose,
  onSaved,
}: {
  state: OperationDialogState
  cashboxes: CashboxWithBalance[]
  onClose: () => void
  onSaved: (result: CashWriteResult) => void
}) {
  const { t } = useLanguage()
  const needsData = state.mode === "edit" || state.mode === "duplicate"
  const { data, loading, error, reload } = useCashOperation(needsData ? (state.operationKey ?? null) : null)
  if (needsData) {
    if (!data) {
      return (
        <CashModal title={t(state.kind === "income" ? "Приход" : "Расход")} onClose={onClose} size="md">
          {loading && <LoadingBlock className="py-10" />}
          {error && <ErrorBlock error={error} onRetry={reload} />}
        </CashModal>
      )
    }
    if (!data.input) {
      return (
        <CashModal title={t(state.kind === "income" ? "Приход" : "Расход")} onClose={onClose} size="md">
          <ErrorBlock error="Операция не найдена" />
        </CashModal>
      )
    }
    return (
      <OperationForm
        state={{ ...state, kind: data.input.kind }}
        operation={data.operation}
        initial={valuesFromInput(data.input, data.operation, state.mode === "duplicate")}
        cashboxes={cashboxes}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  }
  return <OperationForm state={state} operation={null} initial={initialFor(state, cashboxes)} cashboxes={cashboxes} onClose={onClose} onSaved={onSaved} />
}

function initialFor(state: OperationDialogState, cashboxes: CashboxWithBalance[]): Values {
  const values = emptyValues()
  const selected = state.mode === "create" && state.cashboxId ? cashboxes.find((item) => item.id === state.cashboxId) : undefined
  if (selected) {
    values.cashboxId = String(selected.id)
    values.branch = branchOf(selected)
  }
  if (state.mode === "pay" && state.request) {
    values.supplierId = str(state.request.supplier.id)
    values.amount = String(state.request.amount)
    values.comment = state.request.comment
    values.moneyRequestId = state.request.id
    values.debtCurrency = normCurrency(state.request.currency)
  }
  return values
}

function OperationForm({
  state,
  operation,
  initial,
  cashboxes,
  onClose,
  onSaved,
}: {
  state: OperationDialogState
  operation: CashOperation | null
  initial: Values
  cashboxes: CashboxWithBalance[]
  onClose: () => void
  onSaved: (result: CashWriteResult) => void
}) {
  const { t } = useLanguage()
  const kind = state.kind
  const payMode = state.mode === "pay"
  const requestLocked = payMode || Boolean(initial.moneyRequestId)
  const [values, setValues] = useState<Values>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Values>(name: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined, form: undefined }))
  }

  // --- lookups --------------------------------------------------------------------
  const branches = useJsonList<Named>("/api/branches").items
  const organizations = useJsonList<Named>("/api/organizations").items
  const categoriesState = useCashJson<{ categories: CashCategory[] }>(`/api/cash/categories?kind=${kind}`)
  const categories = useMemo(() => categoriesState.data?.categories ?? [], [categoriesState.data])
  const { base, rates, codes } = useCashRates()

  // Demo: the branch defaults to the user's only branch.
  useEffect(() => {
    if (state.mode === "create" && branches.length === 1) setValues((current) => (current.branch ? current : { ...current, branch: branches[0].name }))
  }, [branches, state.mode])

  // The page's selected cashbox when the dialog opened before the cashbox list had loaded (once).
  const preselected = useRef(Boolean(initial.cashboxId))
  useEffect(() => {
    if (preselected.current || state.mode !== "create" || !state.cashboxId) return
    const selected = cashboxes.find((item) => item.id === state.cashboxId)
    if (!selected) return
    preselected.current = true
    setValues((current) => (current.cashboxId ? current : { ...current, cashboxId: String(selected.id), branch: current.branch || branchOf(selected) }))
  }, [cashboxes, state.mode, state.cashboxId])

  const category = categories.find((item) => String(item.id) === values.categoryId)
  const options = applicableOptions(category, kind)
  const first = options[0]
  const has = (key: CategoryOptionKey) => options.includes(key)
  const cashbox = cashboxes.find((item) => String(item.id) === values.cashboxId)
  const cashCurrency = cashbox ? normCurrency(cashbox.currency, base) : ""

  // An order payment may have no category (Ожидаемые оплаты); keep its order field when edited.
  const orderWithoutCategory = kind === "income" && !values.categoryId && Boolean(initial.orderId)
  const orderMode = !requestLocked && kind === "income" && (has("order") || orderWithoutCategory)
  const showClient = !requestLocked && (has("client") || has("client_card_out") || has("client_contract"))
  const showOrder = orderMode
  const showSupplier = requestLocked || has("provider")
  const showSupply = !requestLocked && kind === "expense" && (has("supply") || has("supply_expense"))
  const showSupplyExpense = !requestLocked && kind === "expense" && has("supply_expense")
  const staffMode = !requestLocked && ((kind === "expense" && has("staff_expense")) || (kind === "income" && has("staff_income")))
  const childrenMode = !requestLocked && !staffMode && has("transaction_child")
  const showAmortization = !requestLocked && has("amortization")
  const clientMoney = kind === "income" && (has("client") || orderMode)
  const showDebt = !requestLocked && (clientMoney || has("provider"))
  const showResponsible = kind === "income" && (has("client") || has("client_card_out") || orderMode)
  const showContract = !requestLocked && kind === "income" && cashbox?.type === "bank" && (has("client") || orderMode)

  const clients = useClientSearch(showClient)
  const orders = useOrderSearch(showOrder)
  const suppliers = useJsonList<Named>(showSupplier || showSupply ? "/api/suppliers" : null).items
  const supplies = useJsonList<{ id: number; supplier: string; date: string; amount: number; currency: string; status: string }>(showSupply ? "/api/supplier-incomings" : null).items
  const supplyExpenses = useJsonList<{ id: number; description: string; amount: number; currency: string }>(
    showSupplyExpense && values.supplyId ? `/api/supplier-incomings/${values.supplyId}/expenses` : null,
  ).items
  const employees = useJsonList<Named & { active?: boolean }>(staffMode || showResponsible ? "/api/employees" : null).items
  // Active contracts of the chosen client / the order's client (GET /api/contracts/options; the saved one stays listed).
  const contractClient = (values.clientLabel || (values.orderLabel.split(" · ")[1] ?? "")).trim()
  const contractQuery = values.clientId ? `clientId=${values.clientId}` : contractClient ? `client=${encodeURIComponent(contractClient)}` : ""
  const contracts = useJsonList<ContractOption>(
    showContract && contractQuery ? `/api/contracts/options?${contractQuery}${initial.contractId ? `&includeId=${initial.contractId}` : ""}` : null,
  ).items

  const staffTotal = Object.values(values.staff).reduce((sum, value) => sum + Math.max(0, parseAmount(value)), 0)
  const childrenTotal = values.children.reduce((sum, row) => sum + Math.max(0, parseAmount(row.amount)), 0)
  const amount = staffMode ? staffTotal : childrenMode ? childrenTotal : parseAmount(values.amount)

  const debtCurrency = payMode || values.moneyRequestId ? values.debtCurrency : showDebt && values.debtCurrency && values.debtCurrency !== cashCurrency ? values.debtCurrency : ""

  // --- options ---------------------------------------------------------------------
  // Only the chosen branch's cashboxes (the one already on the form stays listed, e.g. an older entry).
  const cashboxOptions: PickOption[] = cashboxes
    .filter((item) => inBranch(item, values.branch) || String(item.id) === values.cashboxId)
    .map((item) => ({ value: String(item.id), label: `${item.name} (${currencyLabel(item.currency)})`, hint: item.branch }))
  const supplierName = suppliers.find((item) => String(item.id) === values.supplierId)?.name ?? (payMode ? (state.request?.supplier.name ?? "") : (operation?.supplier?.name ?? ""))
  const supplyOptions: PickOption[] = supplies
    .filter((supply) => supply.status !== "отменен" || String(supply.id) === values.supplyId)
    .filter((supply) => !values.supplierId || !has("provider") || supply.supplier.trim().toLowerCase() === supplierName.trim().toLowerCase())
    .map((supply) => ({ value: String(supply.id), label: `№ ${supply.id} · ${supply.supplier}`, hint: `${supply.date} · ${formatCash(supply.amount, supply.currency)}` }))
  const contractOptions: PickOption[] = contracts.map((contract) => ({ value: String(contract.id), label: `${t("Договор №")}: ${contract.fullNumber}`, hint: contract.hint }))

  // --- submit ----------------------------------------------------------------------
  const validate = (): Errors => {
    const next: Errors = {}
    if (!values.date) next.date = t("Неверная дата")
    if (!values.cashboxId) next.cashboxId = t("Выберите кассу")
    if (!requestLocked && !values.categoryId && !orderWithoutCategory) next.categoryId = t("Укажите категорию")
    if (!requestLocked && !staffMode && !childrenMode && !(amount > 0)) next.amount = t("Укажите сумму")
    if (!requestLocked && first) {
      const requires = CATEGORY_OPTIONS[first].requires
      if (requires === "client" && !values.clientId && !values.orderId) next.clientId = t("Укажите клиента")
      if (requires === "provider" && !values.supplierId && !values.supplyId) next.supplierId = t("Укажите поставщика")
      if (requires === "supply" && !values.supplyId) next.supplyId = t("Укажите поставку")
      if (requires === "order" && !values.orderId) next.orderId = t("Укажите заказ")
      if (requires === "supply_expense" && !values.supplyExpenseId) next.supplyExpenseId = t("Укажите доп. расход")
      if (requires === "staff" && !(staffTotal > 0)) next.staff = t("Укажите сумму хотя бы одному сотруднику")
      if (requires === "children" && !values.children.some((row) => row.name.trim() && parseAmount(row.amount) > 0)) next.children = t("Добавьте детализацию")
    }
    if (values.individualRate) {
      if (cashCurrency && cashCurrency !== base && !(parseAmount(values.customRate) > 0)) next.rate = t("Курс валюты не задан")
      if (debtCurrency && debtCurrency !== base && !(parseAmount(values.debtRate) > 0)) next.rate = t("Курс валюты не задан")
    }
    return next
  }

  const buildBody = (): CashOperationInput => {
    const body: CashOperationInput = {
      kind,
      date: values.date,
      cashboxId: Number(values.cashboxId),
      branch: values.branch || undefined,
      organization: values.organization || undefined,
      categoryId: values.categoryId ? Number(values.categoryId) : undefined,
      comment: values.comment.trim() || undefined,
      isVerified: requestLocked ? true : values.isVerified,
      rateType: values.individualRate ? "custom" : "current",
    }
    // A paid money request edited later: no amount — the server pays the request amount
    // converted into the (possibly changed) cashbox currency; another amount is refused.
    if (!requestLocked && !staffMode && !childrenMode) body.amount = amount
    if (values.individualRate) {
      if (cashCurrency !== base && parseAmount(values.customRate) > 0) body.customRate = parseAmount(values.customRate)
      if (debtCurrency && debtCurrency !== base && parseAmount(values.debtRate) > 0) body.debtRate = parseAmount(values.debtRate)
    }
    if (values.moneyRequestId && !payMode) body.moneyRequestId = values.moneyRequestId
    if (showClient && values.clientId) body.clientId = Number(values.clientId)
    if (showOrder && values.orderId) body.orderId = Number(values.orderId)
    if (showSupplier && !requestLocked && values.supplierId) body.supplierId = Number(values.supplierId)
    if (showSupply && values.supplyId && has("supply")) body.supplyId = Number(values.supplyId)
    if (showSupplyExpense && values.supplyExpenseId) body.supplyExpenseId = Number(values.supplyExpenseId)
    if (showResponsible && values.responsibleId) body.responsibleId = Number(values.responsibleId)
    if (showContract && values.contractId) body.contractId = Number(values.contractId)
    if (showDebt && debtCurrency) body.debtCurrency = debtCurrency
    if (staffMode)
      body.staff = Object.entries(values.staff)
        .map(([employeeId, value]) => ({ employeeId: Number(employeeId), amount: parseAmount(value) }))
        .filter((row) => row.amount > 0)
    if (childrenMode)
      body.children = values.children.map((row) => ({ name: row.name.trim(), amount: parseAmount(row.amount) })).filter((row) => row.name && row.amount > 0)
    if (showAmortization) {
      body.amortizationFrom = values.amortizationFrom || undefined
      body.amortizationTo = values.amortizationTo || undefined
    }
    return body
  }

  const submit = async () => {
    const found = validate()
    if (Object.keys(found).length) return setErrors(found)
    setBusy(true)
    const body = buildBody()
    let result
    if (payMode && state.request) {
      // The supplier, amount and currency come from the request (server side).
      const payBody = {
        date: body.date,
        cashboxId: body.cashboxId,
        branch: body.branch,
        organization: body.organization,
        categoryId: body.categoryId,
        comment: body.comment,
        isVerified: true,
        rateType: body.rateType,
        customRate: body.customRate,
        debtRate: body.debtRate,
      }
      result = await cashMutate<CashWriteResult>("POST", `/api/cash/money-requests/${state.request.id}/pay`, payBody)
    } else if (state.mode === "edit" && state.operationKey) {
      result = await cashMutate<CashWriteResult>("PUT", `/api/cash/operations/${encodeURIComponent(state.operationKey)}`, body)
    } else {
      result = await cashMutate<CashWriteResult>("POST", "/api/cash/operations", body)
    }
    setBusy(false)
    if (!result.ok) {
      const field = (result.field && SERVER_FIELDS[result.field]) || "form"
      setErrors({ [field]: mutationError(result, t), ...(field !== "form" ? { form: mutationError(result, t) } : {}) })
      return
    }
    onSaved(result.data)
  }

  // --- render ----------------------------------------------------------------------
  const titleBase = t(kind === "income" ? "Приход" : "Расход")
  const title =
    state.mode === "edit"
      ? `${t("Изменить")} · ${titleBase} № ${operation?.docNo ?? ""}`
      : state.mode === "duplicate"
        ? `${t("Дублировать")} · ${titleBase} № ${operation?.docNo ?? ""}`
        : titleBase
  const wide = staffMode || childrenMode

  // Sub-categories follow their parent, indented (Elektr energiya under Kommunal xizmatlar).
  const categoryOptions: PickOption[] = (() => {
    const ids = new Set(categories.map((item) => item.id))
    const children = new Map<number, CashCategory[]>()
    for (const item of categories) {
      if (item.parentId != null && item.parentId !== item.id && ids.has(item.parentId)) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item])
    }
    const out: PickOption[] = []
    const seen = new Set<number>()
    const add = (item: CashCategory, depth: number) => {
      if (seen.has(item.id)) return
      seen.add(item.id)
      out.push({
        value: String(item.id),
        label: item.name,
        depth,
        hint: applicableOptions(item, kind)
          .map((key) => t(CATEGORY_OPTIONS[key].title))
          .join(", "),
      })
      for (const child of children.get(item.id) ?? []) add(child, depth + 1)
    }
    for (const item of categories) if (item.parentId == null || item.parentId === item.id || !ids.has(item.parentId)) add(item, 0)
    for (const item of categories) add(item, 0)
    return out
  })()

  return (
    <CashModal
      title={title}
      onClose={onClose}
      size={wide ? "lg" : "md"}
      footer={
        <>
          {errors.form && <span className="mr-auto text-[13px] text-[#e57373]">{errors.form}</span>}
          {staffMode && (
            <span className="mr-auto font-semibold text-[#17233b]">
              {t(kind === "income" ? "Сумма прихода" : "Сумма расхода")}: {formatCash(staffTotal, cashCurrency || base)}
            </span>
          )}
          <PrimaryButton tone={kind === "income" ? "green" : "red"} busy={busy} onClick={submit}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <div className={wide ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : ""}>
        <div className="flex flex-col gap-3">
          <FormField label={t("Дата создания")} required error={errors.date}>
            <input type="datetime-local" value={values.date} onChange={(event) => set("date", event.target.value)} className={inputClass} />
          </FormField>
          <FormField label={t("Филиал")}>
            <SearchSelect
              value={values.branch}
              onChange={(value) => {
                // A cashbox of another branch does not stay chosen.
                setValues((current) => {
                  const chosen = cashboxes.find((item) => String(item.id) === current.cashboxId)
                  const keep = !chosen || inBranch(chosen, value)
                  return { ...current, branch: value, ...(keep ? {} : { cashboxId: "", individualRate: false, customRate: "", debtRate: "" }) }
                })
                setErrors((current) => ({ ...current, branch: undefined, form: undefined }))
              }}
              options={branches.map((item) => ({ value: item.name, label: item.name }))}
              placeholder={t("Филиал")}
            />
          </FormField>
          <FormField label={t("Касса")} required error={errors.cashboxId}>
            <SearchSelect
              value={values.cashboxId}
              invalid={Boolean(errors.cashboxId)}
              onChange={(value) => {
                // Demo: changing the cashbox resets the rate to "current". With no branch chosen
                // yet, the cashbox's own branch fills it.
                const chosen = cashboxes.find((item) => String(item.id) === value)
                setValues((current) => ({
                  ...current,
                  cashboxId: value,
                  branch: current.branch || (chosen ? branchOf(chosen) : ""),
                  individualRate: false,
                  customRate: "",
                  debtRate: "",
                }))
                setErrors((current) => ({ ...current, cashboxId: undefined, rate: undefined }))
              }}
              options={cashboxOptions}
              placeholder={t("Касса")}
            />
          </FormField>
          <FormField label={t("Организация")} error={errors.organization}>
            <SearchSelect value={values.organization} onChange={(value) => set("organization", value)} options={organizations.map((item) => ({ value: item.name, label: item.name }))} placeholder={t("Организация")} />
          </FormField>

          <FormField
            label={
              <span className="flex items-center justify-between gap-2">
                {/* The required "*" stays on the label's line (FormField would put it under the flex row). */}
                <span>
                  {t(kind === "income" ? "Категория прихода" : "Категория расхода")}
                  {!requestLocked && <span className="text-[#e57373]"> *</span>}
                </span>
                <Link href={kind === "income" ? "/analytics/income-categories" : "/analytics/expense-categories"} target="_blank" className="text-[12px] text-[#4f70e7] hover:underline">
                  + {t("добавить")}
                </Link>
              </span>
            }
            error={errors.categoryId}
          >
            <SearchSelect
              value={values.categoryId}
              invalid={Boolean(errors.categoryId)}
              onChange={(value) => {
                // Demo: a new category clears the counterparty fields of the old one.
                setValues((current) => ({
                  ...current,
                  categoryId: value,
                  ...(requestLocked ? {} : { clientId: "", clientLabel: "", orderId: "", orderLabel: "", supplierId: "", supplyId: "", supplyExpenseId: "", contractId: "", staff: {}, children: [{ name: "", amount: "" }] }),
                }))
                setErrors({})
              }}
              options={categoryOptions}
              placeholder={t(kind === "income" ? "Категория прихода" : "Категория расхода")}
              loading={categoriesState.loading}
            />
          </FormField>

          {showClient && (
            <FormField label={t(has("client_contract") && !has("client") ? "Название клиента" : "Клиент")} required={CATEGORY_OPTIONS[first ?? "client"]?.requires === "client"} error={errors.clientId}>
              <SearchSelect
                value={values.clientId}
                selectedLabel={values.clientLabel}
                invalid={Boolean(errors.clientId)}
                onChange={(value, option) => {
                  setValues((current) => ({ ...current, clientId: value, clientLabel: option?.label ?? "", contractId: "" }))
                  setErrors((current) => ({ ...current, clientId: undefined, form: undefined }))
                }}
                options={clients.options}
                onSearch={clients.search}
                loading={clients.loading}
                placeholder={t("Клиент")}
              />
            </FormField>
          )}

          {showOrder && (
            <FormField label={t("Заказ")} required={first === "order"} error={errors.orderId}>
              <SearchSelect
                value={values.orderId}
                selectedLabel={values.orderLabel}
                invalid={Boolean(errors.orderId)}
                onChange={(value, option) => {
                  setValues((current) => ({ ...current, orderId: value, orderLabel: option?.label ?? "", contractId: "" }))
                  setErrors((current) => ({ ...current, orderId: undefined, form: undefined }))
                }}
                options={orders.options}
                onSearch={orders.search}
                loading={orders.loading}
                placeholder={t("Заказ")}
              />
            </FormField>
          )}

          {showSupplier && (
            <FormField label={t("Поставщик")} required={!requestLocked && first === "provider"} error={errors.supplierId}>
              <SearchSelect
                value={values.supplierId}
                selectedLabel={supplierName}
                disabled={requestLocked}
                invalid={Boolean(errors.supplierId)}
                onChange={(value) => {
                  setValues((current) => ({ ...current, supplierId: value, supplyId: "" }))
                  setErrors((current) => ({ ...current, supplierId: undefined, form: undefined }))
                }}
                options={suppliers.map((item) => ({ value: String(item.id), label: item.name }))}
                placeholder={t("Поставщик")}
              />
            </FormField>
          )}

          {showSupply && (
            <FormField label={t("Поставки")} required={first === "supply" || first === "supply_expense"} error={errors.supplyId}>
              <SearchSelect
                value={values.supplyId}
                selectedLabel={values.supplyId ? `№ ${values.supplyId}` : ""}
                invalid={Boolean(errors.supplyId)}
                onChange={(value) => {
                  setValues((current) => ({ ...current, supplyId: value, supplyExpenseId: "" }))
                  setErrors((current) => ({ ...current, supplyId: undefined, form: undefined }))
                }}
                options={supplyOptions}
                placeholder={t("Поставки")}
              />
            </FormField>
          )}

          {showSupplyExpense && (
            <FormField label={t("Доп. расход")} required error={errors.supplyExpenseId}>
              <SearchSelect
                value={values.supplyExpenseId}
                selectedLabel={values.supplyExpenseId ? `№ ${values.supplyExpenseId}` : ""}
                disabled={!values.supplyId}
                invalid={Boolean(errors.supplyExpenseId)}
                onChange={(value) => {
                  const expense = supplyExpenses.find((item) => String(item.id) === value)
                  setValues((current) => ({ ...current, supplyExpenseId: value, amount: expense && !current.amount ? String(expense.amount) : current.amount }))
                  setErrors((current) => ({ ...current, supplyExpenseId: undefined, form: undefined }))
                }}
                options={supplyExpenses.map((item) => ({ value: String(item.id), label: `№ ${item.id} · ${item.description}`, hint: formatCash(item.amount, item.currency) }))}
                placeholder={t("Доп. расход")}
              />
            </FormField>
          )}

          {!staffMode && (
            <FormField label={`${t("Сумма")}${cashCurrency ? ` (${currencyLabel(cashCurrency)})` : ""}`} required={!requestLocked} error={errors.amount}>
              {requestLocked && payMode && state.request ? (
                <input value={formatCash(state.request.amount, state.request.currency)} disabled className={inputClass} />
              ) : (
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={childrenMode ? String(childrenTotal || "") : values.amount}
                  disabled={childrenMode}
                  onChange={(event) => set("amount", event.target.value)}
                  className={`${inputClass} ${errors.amount ? "border-[#e57373]" : ""}`}
                />
              )}
            </FormField>
          )}

          {showDebt && (
            <FormField label={t("Индивидуальная покрытия долга")}>
              <select value={values.debtCurrency} onChange={(event) => set("debtCurrency", event.target.value)} className={inputClass}>
                <option value="">{t("Не указано")}</option>
                {codes.map((code) => (
                  <option key={code} value={code}>
                    {currencyLabel(code)}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {showResponsible && (
            <FormField label={t("Ответственный персонал")} error={errors.responsibleId}>
              <SearchSelect value={values.responsibleId} onChange={(value) => set("responsibleId", value)} options={employees.map((item) => ({ value: String(item.id), label: item.name }))} placeholder={t("Ответственный персонал")} />
            </FormField>
          )}

          {showContract && (
            <FormField label={t("Контракт")} error={errors.contractId}>
              <SearchSelect value={values.contractId} onChange={(value) => set("contractId", value)} options={contractOptions} placeholder={t("Контракт")} />
            </FormField>
          )}

          {showAmortization && (
            <FormField label={t("Выберите период")}>
              <span className="flex flex-wrap items-center gap-2">
                <input type="date" value={values.amortizationFrom} onChange={(event) => set("amortizationFrom", event.target.value)} className={`${inputClass} flex-1`} />
                <span className="text-[#586174]">—</span>
                <input type="date" value={values.amortizationTo} onChange={(event) => set("amortizationTo", event.target.value)} className={`${inputClass} flex-1`} />
              </span>
            </FormField>
          )}

          <FormField label={t("Комментарий...")} error={errors.comment}>
            <textarea rows={2} value={values.comment} onChange={(event) => set("comment", event.target.value)} className={`${inputClass} h-auto py-2`} />
          </FormField>

          <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
            <input type="checkbox" checked={values.isVerified} disabled={requestLocked} onChange={(event) => set("isVerified", event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t(kind === "income" ? "Подтвержденный приход (Я получил деньги)" : "Подтвержденный расход (Снял деньги с кассы)")}
          </label>

          {cashCurrency && (
            <RateBlock
              base={base}
              rates={rates}
              cashCurrency={cashCurrency}
              debtCurrency={debtCurrency}
              amount={payMode && state.request ? null : amount}
              individual={values.individualRate}
              customRate={values.customRate}
              debtRate={values.debtRate}
              error={errors.rate}
              onChange={(next) => {
                setValues((current) => ({ ...current, ...next }))
                setErrors((current) => ({ ...current, rate: undefined }))
              }}
            />
          )}
          {payMode && state.request && cashCurrency && normCurrency(state.request.currency) !== cashCurrency && (
            <PayPreview request={state.request} cashCurrency={cashCurrency} base={base} rates={rates} customRate={values.individualRate ? parseAmount(values.customRate) : 0} debtRate={values.individualRate ? parseAmount(values.debtRate) : 0} />
          )}
        </div>

        {staffMode && (
          <StaffPanel
            employees={employees}
            staff={values.staff}
            currency={cashCurrency || base}
            error={errors.staff}
            onChange={(staff) => {
              setValues((current) => ({ ...current, staff }))
              setErrors((current) => ({ ...current, staff: undefined, form: undefined }))
            }}
          />
        )}
        {childrenMode && (
          <ChildrenPanel
            rows={values.children}
            currency={cashCurrency || base}
            error={errors.children}
            onChange={(children) => {
              setValues((current) => ({ ...current, children }))
              setErrors((current) => ({ ...current, children: undefined, form: undefined }))
            }}
          />
        )}
      </div>
    </CashModal>
  )
}

/** Open orders for the "Заказ" select (GET /api/cash/expected-payments?search=…). */
function useOrderSearch(enabled: boolean): { options: PickOption[]; loading: boolean; search: (text: string) => void } {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const { data, loading } = useCashJson<{ rows: Array<{ orderId: number; client: { name: string }; currency: string; remaining: number; total: number }> }>(
    enabled ? `/api/cash/expected-payments?pageSize=100${debounced ? `&search=${encodeURIComponent(debounced)}` : ""}` : null,
  )
  const options = useMemo(() => {
    const byOrder = new Map<number, PickOption>()
    for (const row of data?.rows ?? []) {
      const existing = byOrder.get(row.orderId)
      const due = formatCash(row.remaining, row.currency)
      if (existing) existing.hint = `${existing.hint}, ${due}`
      else byOrder.set(row.orderId, { value: String(row.orderId), label: `№ ${row.orderId} · ${row.client.name}`, hint: due })
    }
    return [...byOrder.values()]
  }, [data])
  return { options, loading, search: setQuery }
}

/** "Индивидуальный курс": Курс кассы / Курс долга + "В основной валюте" / "Сумма индивидуального покрытия". */
export function RateBlock({
  base,
  rates,
  cashCurrency,
  debtCurrency,
  amount,
  individual,
  customRate,
  debtRate,
  error,
  onChange,
}: {
  base: string
  rates: RateMap
  cashCurrency: string
  /** "" = same as the cashbox. */
  debtCurrency: string
  /** null hides the previews. */
  amount: number | null
  individual: boolean
  customRate: string
  debtRate: string
  error?: string
  onChange: (next: { individualRate?: boolean; customRate?: string; debtRate?: string }) => void
}) {
  const { t } = useLanguage()
  const cashForeign = cashCurrency !== base
  const debt = debtCurrency && debtCurrency !== cashCurrency ? debtCurrency : ""
  const debtForeign = Boolean(debt) && debt !== base
  if (!cashForeign && !debtForeign) return null
  const currentCash = rateOf(cashCurrency, rates, base)
  const currentDebt = debt ? rateOf(debt, rates, base) : 1
  const cashRate = individual && parseAmount(customRate) > 0 ? parseAmount(customRate) : currentCash
  const debtRateValue = individual && parseAmount(debtRate) > 0 ? parseAmount(debtRate) : currentDebt
  const baseAmount = amount !== null && cashRate ? amount * cashRate : null
  const debtAmount = amount !== null && debt && cashRate && debtRateValue ? (amount * cashRate) / debtRateValue : null
  const rateLine = (code: string, rate: number | null) => (rate ? `1 ${currencyLabel(code)} = ${formatMoney(rate, 5)} ${currencyLabel(base)}` : null)
  return (
    <div className="flex flex-col gap-2 rounded-md bg-[#f7f9fc] p-3 text-[13px] text-[#586174]">
      <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
        <input
          type="checkbox"
          checked={individual}
          onChange={(event) =>
            onChange({
              individualRate: event.target.checked,
              customRate: event.target.checked && !customRate && currentCash && cashForeign ? String(currentCash) : customRate,
              debtRate: event.target.checked && !debtRate && currentDebt && debtForeign ? String(currentDebt) : debtRate,
            })
          }
          className="h-4 w-4 accent-[#4f70e7]"
        />
        {t("Индивидуальный курс")}
      </label>
      {cashForeign &&
        (individual ? (
          <FormField label={`${t("Курс кассы")}: 1 ${currencyLabel(cashCurrency)} =`}>
            <span className="flex items-center gap-2">
              <input type="number" min="0" step="any" value={customRate} onChange={(event) => onChange({ customRate: event.target.value })} className={inputClass} />
              <span>{currencyLabel(base)}</span>
            </span>
          </FormField>
        ) : (
          <span>
            {t("Курс кассы")}: {rateLine(cashCurrency, currentCash) ?? t("Курс кассы не задан")}
          </span>
        ))}
      {debtForeign &&
        (individual ? (
          <FormField label={`${t("Курс долга")}: 1 ${currencyLabel(debt)} =`}>
            <span className="flex items-center gap-2">
              <input type="number" min="0" step="any" value={debtRate} onChange={(event) => onChange({ debtRate: event.target.value })} className={inputClass} />
              <span>{currencyLabel(base)}</span>
            </span>
          </FormField>
        ) : (
          <span>
            {t("Курс долга")}: {rateLine(debt, currentDebt) ?? t("Курс валюты не задан")}
          </span>
        ))}
      {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
      {amount !== null && cashForeign && (
        <span>
          {t("В основной валюте")}: <b className="text-[#17233b]">{baseAmount !== null ? formatCash(baseAmount, base) : "—"}</b>
        </span>
      )}
      {amount !== null && debt && (
        <span>
          {t("Сумма индивидуального покрытия")}: <b className="text-[#17233b]">{debtAmount !== null ? formatCash(debtAmount, debt) : "—"}</b>
        </span>
      )}
    </div>
  )
}

/** Pay-request mode with another cashbox currency: cash taken = request converted. */
function PayPreview({ request, cashCurrency, base, rates, customRate, debtRate }: { request: MoneyRequest; cashCurrency: string; base: string; rates: RateMap; customRate: number; debtRate: number }) {
  const { t } = useLanguage()
  const requestCurrency = normCurrency(request.currency, base)
  const reqRate = debtRate > 0 && requestCurrency !== base ? debtRate : rateOf(requestCurrency, rates, base)
  const cashRate = customRate > 0 ? customRate : rateOf(cashCurrency, rates, base)
  const cash = reqRate && cashRate ? (request.amount * reqRate) / cashRate : null
  return (
    <p className="text-[13px] text-[#586174]">
      {t("Сумма с кассы")}: <b className="text-[#17233b]">{cash !== null ? formatCash(cash, cashCurrency) : t("Курс валюты не задан")}</b>
    </p>
  )
}

/** "Список сотрудников": amount per employee (staff_expense / staff_income). */
function StaffPanel({ employees, staff, currency, error, onChange }: { employees: Array<Named & { active?: boolean }>; staff: Record<string, string>; currency: string; error?: string; onChange: (staff: Record<string, string>) => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const list = employees.filter((item) => item.active !== false || staff[String(item.id)]).filter((item) => !needle || item.name.toLowerCase().includes(needle))
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-semibold text-[#17233b]">{t("Список сотрудников")}</h3>
      <label className="flex items-center gap-2 border-b border-[#dbe0e8] pb-1">
        <Search className="h-4 w-4 text-[#9aa3b6]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск сотрудников...")} className="h-9 w-full min-w-0 text-[14px] outline-none" />
      </label>
      {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
      <div className="max-h-[420px] overflow-y-auto">
        {!list.length && <p className="py-4 text-center text-[13px] text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
        {list.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-dashed border-[#e1e5eb] py-2">
            <span className="min-w-0 flex-1 truncate text-[14px]">{item.name}</span>
            <input
              type="number"
              min="0"
              step="any"
              value={staff[String(item.id)] ?? ""}
              onChange={(event) => onChange({ ...staff, [String(item.id)]: event.target.value })}
              className="h-9 w-32 rounded-md border border-[#dbe0e8] px-2 text-right text-[14px]"
              aria-label={item.name}
            />
            <span className="w-10 text-[12px] text-[#9aa3b6]">{currencyLabel(currency)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** "Детализация": name + amount lines; the operation amount = Σ. */
function ChildrenPanel({ rows, currency, error, onChange }: { rows: Array<{ name: string; amount: string }>; currency: string; error?: string; onChange: (rows: Array<{ name: string; amount: string }>) => void }) {
  const { t } = useLanguage()
  const total = rows.reduce((sum, row) => sum + Math.max(0, parseAmount(row.amount)), 0)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-semibold text-[#17233b]">{t("Детализация")}</h3>
      {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
      {rows.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <FormField label={t("Название")} className="flex-1">
            <input value={row.name} onChange={(event) => onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, name: event.target.value } : item)))} className={inputClass} />
          </FormField>
          <FormField label={t("Сумма")} className="w-32">
            <input type="number" min="0" step="any" value={row.amount} onChange={(event) => onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, amount: event.target.value } : item)))} className={inputClass} />
          </FormField>
          <button type="button" disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))} aria-label={t("Удалить")} className="mb-2 text-[#e57373] disabled:opacity-30">
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { name: "", amount: "" }])} className="inline-flex items-center gap-1 self-start text-[14px] font-semibold text-[#4f70e7] hover:underline">
        <Plus className="h-4 w-4" /> {t("Добавить")}
      </button>
      <p className="text-right font-semibold text-[#17233b]">
        {t("Итого")}: {formatCash(total, currency)}
      </p>
    </div>
  )
}
