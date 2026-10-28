"use client"

import { Check as StaffCheck } from "@/components/staff/staff-kit"
import { Loader2, Search, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useRef, useState } from "react"

import type { CategoryOptionKey } from "@/lib/cash/types"
import type { CategoryErrorBody } from "@/lib/categories-schema"
import { primaryCategoryOption, type CategoryKind } from "@/lib/category-options"
import { useLanguage } from "@/lib/i18n/language-context"
import { CategoryOptionsPicker } from "./category-options-picker"
import { Field, dictionaryInputClass } from "./dictionaries-shared"
import { EXPENSE_CATEGORIES_API, type ExpenseCategory } from "./expense-categories-data"
import { INCOME_CATEGORIES_API, type IncomeCategory } from "./income-categories-data"

// "Добавить / Изменить категорию приходов" (demo module 4357, IncomeCategoryCreateForm):
//   Наименование ★, [ ] Дополнительные параметры, [ ] Прочий приход;
// "Добавить / Изменить категорию расходов" (demo module 4356, ExpensiveCategoryCreateForm):
//   Наименование ★, Родительская категория (search), [ ] Дополнительные параметры,
//   [ ] "Это прямой расход на товар …", [ ] "Не учитывать в отчёте P&L" (hidden while
//   the direct expense box is checked).
// "Дополнительные параметры" opens the single-choice option list; the request sends the
// chosen option key (or none) and the server stores options + parameter.

export type SavedCategory = IncomeCategory | ExpenseCategory

type Draft = {
  name: string
  showOptions: boolean
  option: CategoryOptionKey | ""
  otherIncome: boolean
  parentId: number | null
  parentName: string
  direct: boolean
  excludeFromPnl: boolean
}

type Errors = { name: string; options: string; parentId: string; general: string }

const NO_ERRORS: Errors = { name: "", options: "", parentId: "", general: "" }

export function categoriesApi(kind: CategoryKind): string {
  return kind === "income" ? INCOME_CATEGORIES_API : EXPENSE_CATEGORIES_API
}

function emptyDraft(): Draft {
  return { name: "", showOptions: false, option: "", otherIncome: false, parentId: null, parentName: "", direct: false, excludeFromPnl: false }
}

/** Demo edit prefill: showOptions = options not empty, the radio = the first option. */
function draftFrom(kind: CategoryKind, category: SavedCategory): Draft {
  const expense = "direct" in category ? category : null
  return {
    name: category.name,
    showOptions: category.options.length > 0,
    option: primaryCategoryOption(kind, category.options),
    otherIncome: "otherIncome" in category ? category.otherIncome : false,
    parentId: expense?.parentId ?? null,
    parentName: expense?.parentName ?? "",
    direct: expense?.direct ?? false,
    excludeFromPnl: expense ? expense.excludeFromPnl && !expense.direct : false,
  }
}

/** Inline field errors and the general error of a failed request. */
export function categoryRequestErrors(body: CategoryErrorBody, fallback: string): Errors {
  const fieldErrors = body.details?.fieldErrors ?? {}
  const errors = {
    name: body.fields?.name ?? fieldErrors.name?.[0] ?? "",
    options: body.fields?.options ?? fieldErrors.options?.[0] ?? fieldErrors.option?.[0] ?? "",
    parentId: body.fields?.parentId ?? fieldErrors.parentId?.[0] ?? fieldErrors.parent?.[0] ?? "",
  }
  const anyField = Boolean(errors.name || errors.options || errors.parentId)
  return { ...errors, general: anyField ? "" : body.error || fallback }
}

/** Ids a category may not take as its parent: itself and its descendants. */
function blockedParents(list: ExpenseCategory[], id: number | null): Set<number> {
  const blocked = new Set<number>()
  if (id === null) return blocked
  const children = new Map<number, number[]>()
  for (const item of list) if (item.parentId !== null) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item.id])
  const queue = [id]
  while (queue.length) {
    const current = queue.pop()!
    if (blocked.has(current)) continue
    blocked.add(current)
    queue.push(...(children.get(current) ?? []))
  }
  return blocked
}

export function CategoryFormModal({
  kind,
  categoryId,
  onClose,
  onSaved,
}: {
  kind: CategoryKind
  /** null = create; otherwise GET /api/{kind}-categories/[id] prefills the form. */
  categoryId: number | null
  onClose: () => void
  onSaved: (category: SavedCategory) => void
}) {
  const { t } = useLanguage()
  const api = categoriesApi(kind)
  const isEdit = categoryId !== null
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [detailLoading, setDetailLoading] = useState(isEdit)
  const [parents, setParents] = useState<ExpenseCategory[]>([])
  const [parentsLoading, setParentsLoading] = useState(kind === "expense")
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Errors>(NO_ERRORS)

  useEffect(() => {
    if (categoryId === null) return
    const controller = new AbortController()
    fetch(`${api}/${categoryId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as SavedCategory & CategoryErrorBody
        if (!response.ok) throw new Error(data.error || "Категория не найдена")
        setDraft(draftFrom(kind, data))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setErrors({ ...NO_ERRORS, general: reason instanceof Error ? reason.message : String(reason) })
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })
    return () => controller.abort()
  }, [api, categoryId, kind])

  // "Родительская категория" (demo UniversalSearchField over finance/expense_category).
  useEffect(() => {
    if (kind !== "expense") return
    const controller = new AbortController()
    fetch(`${EXPENSE_CATEGORIES_API}?ordering=name`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as ExpenseCategory[]) : []))
      .then((list) => setParents(Array.isArray(list) ? list : []))
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setParentsLoading(false)
      })
    return () => controller.abort()
  }, [kind])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const blocked = useMemo(() => blockedParents(parents, categoryId), [parents, categoryId])
  const parentChoices = useMemo(() => parents.filter((item) => !blocked.has(item.id)), [parents, blocked])

  function patch(next: Partial<Draft>, clear?: keyof Errors) {
    setDraft((value) => ({ ...value, ...next }))
    if (clear) setErrors((value) => ({ ...value, [clear]: "", general: "" }))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    const name = draft.name.trim()
    const missingOption = draft.showOptions && !draft.option
    if (!name || missingOption || saving || detailLoading) return
    const option = draft.showOptions ? draft.option : ""
    const body =
      kind === "income"
        ? { name, option, otherIncome: draft.otherIncome }
        : { name, option, parentId: draft.parentId, direct: draft.direct, excludeFromPnl: draft.direct ? false : draft.excludeFromPnl }
    setSaving(true)
    setErrors(NO_ERRORS)
    try {
      const response = await fetch(isEdit ? `${api}/${categoryId}` : api, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json().catch(() => ({}))) as SavedCategory & CategoryErrorBody
      if (!response.ok) {
        setErrors(categoryRequestErrors(data, response.status === 403 ? "Недостаточно прав" : "Не удалось сохранить категорию"))
        return
      }
      onSaved(data)
    } catch {
      setErrors({ ...NO_ERRORS, general: "Сервер недоступен, попробуйте ещё раз" })
    } finally {
      setSaving(false)
    }
  }

  const nameError = (touched && !draft.name.trim() ? "Обязательное поле" : "") || errors.name
  const optionsError = (touched && draft.showOptions && !draft.option ? "Обязательное поле" : "") || errors.options
  const busy = saving || detailLoading
  const title =
    kind === "income"
      ? isEdit ? "Изменить категорию приходов" : "Добавить категорию приходов"
      : isEdit ? "Изменить категорию расходов" : "Добавить категорию расходов"

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 px-4 pb-4 pt-[64px]" onMouseDown={onClose}>
      <form
        onSubmit={save}
        onMouseDown={(event) => event.stopPropagation()}
        className={`relative w-full rounded bg-white shadow-2xl ${kind === "income" ? "max-w-[550px]" : "max-w-[500px]"}`}
        aria-busy={busy}
      >
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
          <b className="text-[13px] uppercase text-[#333]">{t(title)}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333] hover:opacity-70">
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </header>
        <div className={`relative min-h-[300px] space-y-3 pl-[30px] pt-[10px] ${kind === "income" ? "pb-[19px] pr-[54px]" : "pb-[20px] pr-[52px]"}`}>
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          <Field label={t("Наименование")} required filled={Boolean(draft.name)} error={nameError ? t(nameError) : ""}>
            <input
              value={draft.name}
              maxLength={255}
              onChange={(event) => patch({ name: event.target.value }, "name")}
              className={`${dictionaryInputClass} ${nameError ? "border-rose-500" : ""}`}
            />
          </Field>

          {kind === "expense" && (
            <ParentSelect
              value={draft.parentId}
              valueName={draft.parentName}
              options={parentChoices}
              loading={parentsLoading}
              error={errors.parentId ? t(errors.parentId) : ""}
              onChange={(parent) => patch({ parentId: parent?.id ?? null, parentName: parent?.name ?? "" }, "parentId")}
            />
          )}

          <div className={`space-y-[6px] ${kind === "income" ? "pt-[7px]" : "-mt-[2px]"}`}>
            <Checkbox checked={draft.showOptions} onChange={(checked) => patch({ showOptions: checked }, "options")} label={t("Дополнительные параметры")} />
            {kind === "income" ? (
              <Checkbox checked={draft.otherIncome} onChange={(checked) => patch({ otherIncome: checked })} label={t("Прочий приход")} />
            ) : (
              <>
                <Checkbox
                  checked={draft.direct}
                  onChange={(checked) => patch({ direct: checked })}
                  label={t(
                    "Это прямой расход на товар который связан с себестоимостью товара (Это тип расхода не будет показываться в генеральном отчете как косвенный расход)",
                  )}
                />
                {!draft.direct && (
                  <Checkbox checked={draft.excludeFromPnl} onChange={(checked) => patch({ excludeFromPnl: checked })} label={t("Не учитывать в отчёте P&L")} />
                )}
              </>
            )}
          </div>

          {draft.showOptions && (
            <CategoryOptionsPicker kind={kind} value={draft.option} onChange={(option) => patch({ option }, "options")} error={optionsError ? t(optionsError) : ""} />
          )}

          {errors.general && <p className="text-sm font-medium text-rose-600">{t(errors.general)}</p>}
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] px-[10px]">
          <button type="submit" disabled={busy} className="h-9 rounded bg-[#6ccd8b] px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <StaffCheck checked={checked} onChange={onChange} className="!items-start !gap-[2px] leading-5" label={<span className="block pr-[34px] pt-[2px] text-black">{label}</span>} />
}

/** Searchable select of the parent expense category (underlined like the other fields). */
function ParentSelect({
  value,
  valueName,
  options,
  loading,
  error,
  onChange,
}: {
  value: number | null
  /** Name of the current parent (from the detail) while the list loads. */
  valueName: string
  options: ExpenseCategory[]
  loading: boolean
  error: string
  onChange: (parent: ExpenseCategory | null) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const selectedName = value === null ? "" : (options.find((item) => item.id === value)?.name ?? valueName)
  const needle = query.replace(/\s+/g, " ").trim().toLowerCase()
  const visible = (needle ? options.filter((item) => item.name.toLowerCase().includes(needle)) : options).slice(0, 200)

  return (
    <div ref={ref} className="relative mt-[4px] pt-4">
      <span className={`pointer-events-none absolute left-0 font-semibold text-[#333] transition-all ${selectedName ? "top-0 text-[10px]" : "top-[28px] text-[13px]"}`}>{t("Родительская категория")}</span>
      <div className={`flex h-9 items-center border-b ${error ? "border-rose-500" : open ? "border-[#4f70e7]" : "border-[#e0e0e0]"}`}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="min-w-0 flex-1 truncate py-1.5 text-left text-[15px] text-[#333]"
        >
          {selectedName}
        </button>
        {value !== null && (
          <button type="button" onClick={() => onChange(null)} aria-label={t("Очистить")} className="p-1 text-[#999] hover:text-[#333]">
            <X className="h-4 w-4" />
          </button>
        )}
        <span className="mr-1 block h-0 w-0 shrink-0 border-x-[5px] border-t-[5px] border-x-transparent border-t-[#9e9e9e]" />
      </div>
      {error && <p className="mt-1 text-[12px] text-rose-500">{error}</p>}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded border border-[#e1e5eb] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#eef1f5] px-3">
            <Search className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Поиск")}
              className="h-9 w-full min-w-0 text-[14px] outline-none"
            />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#9aa3b6]" />}
          </div>
          <div role="listbox" className="max-h-60 overflow-y-auto py-1">
            {!visible.length && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{loading ? t("Загрузка...") : t("Ничего не найдено")}</p>}
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={item.id === value}
                onClick={() => {
                  onChange(item)
                  setOpen(false)
                  setQuery("")
                }}
                className={`block w-full truncate px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8] ${item.id === value ? "bg-[#f2f5f8] font-semibold" : ""}`}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
