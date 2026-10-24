"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, PlusCircle, Trash2 } from "lucide-react"

import {
  BRANCH_KPI_API,
  fetchJson,
  KpiDialogAction,
  KpiDialogFrame,
  KpiMonthYearFilter,
  kpiNumber,
  sendJson,
  useMonthName,
} from "@/components/analytics/branch-kpi-shared"
import {
  BRANCH_KPI_CALC_TYPES,
  BRANCH_KPI_MONTHS,
  branchKpiCalcTypeName,
  type BranchKpiCalcType,
  type BranchKpiIndicator,
  type BranchKpiLevel,
  type BranchKpiListRow,
} from "@/lib/branch-kpi-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of "KPI план филиалов":
// - "Изменить план филиалов на <Месяц> <Год>" (demo 5083): step 1 "Все активные KPI" /
//   "Выбранные KPI" → "Далее"; step 2 full screen: Месяц/Год + grid branch × KPI ("Количество").
// - "Дублировать с месяца <Месяц> <Год>" (demo 5082): Месяц + Год → copy.
// - "Уровень вознаграждения" of a KPI (demo KPI card stages, module 5183).

function parsePlan(text: string): number | null {
  const normalized = text.replace(/\s/g, "").replace(",", ".")
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : NaN
}

function cleanNumberInput(text: string): string {
  return text.replace(/[^\d.,]/g, "")
}

export function useKpiIndicators(version = 0) {
  const [indicators, setIndicators] = useState<BranchKpiIndicator[] | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    fetchJson<BranchKpiIndicator[]>(`${BRANCH_KPI_API}/indicators`, { signal: controller.signal })
      .then((list) => {
        setIndicators(list)
        setError("")
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [version])
  return { indicators, error }
}

type Draft = Record<number, Record<number, string>>

function draftFromRows(rows: BranchKpiListRow[]): Draft {
  return Object.fromEntries(rows.map((row) => [row.id, Object.fromEntries(row.performanceIndicators.map((item) => [item.id, String(item.plan)]))]))
}

export function BranchKpiBulkDialog({
  month,
  year,
  branches,
  onPeriodChange,
  onClose,
  onSaved,
}: {
  month: number
  year: number
  /** Selected rows of the current list page (reloaded when the period changes). */
  branches: BranchKpiListRow[]
  onPeriodChange: (next: { month: number; year: number }) => void
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useLanguage()
  const monthName = useMonthName()
  const { indicators, error: loadError } = useKpiIndicators()
  const [next, setNext] = useState(false)
  const [kpiType, setKpiType] = useState<"allKpi" | "selectedKpi">("allKpi")
  const [chosen, setChosen] = useState<number[]>([])
  const [kpiSearch, setKpiSearch] = useState("")
  const [draft, setDraft] = useState<{ key: string; values: Draft } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const active = useMemo(() => (indicators ?? []).filter((item) => item.active), [indicators])
  const kpis = kpiType === "allKpi" ? active : active.filter((item) => chosen.includes(item.id))
  const title = `${t("Изменить план филиалов")} ${t("на")} ${monthName(month)}  ${year}`

  // Demo withPropsOnChange(next): (re)initialise the grid from the list plans of the shown month.
  const periodKey = `${year}-${month}`
  const rowsReady = branches.length > 0 && branches.every((row) => row.month === month && row.year === year)
  if (next && rowsReady && draft?.key !== periodKey) setDraft({ key: periodKey, values: draftFromRows(branches) })

  const setCell = (branchId: number, kpiId: number, text: string) =>
    setDraft((current) => {
      const values = current?.values ?? {}
      return { key: current?.key ?? periodKey, values: { ...values, [branchId]: { ...(values[branchId] ?? {}), [kpiId]: cleanNumberInput(text) } } }
    })

  const save = async () => {
    if (!draft || draft.key !== periodKey) return
    const payload = {
      month,
      year,
      indicators: kpis.map((item) => item.id),
      branches: branches.map((row) => ({
        branch: row.id,
        performanceIndicators: kpis.flatMap((item) => {
          const plan = parsePlan(draft.values[row.id]?.[item.id] ?? "")
          return plan === null ? [] : [{ performanceIndicator: item.id, plan }]
        }),
      })),
    }
    if (payload.branches.some((row) => row.performanceIndicators.some((item) => Number.isNaN(item.plan)))) {
      setError(t("Введите корректное число"))
      return
    }
    setSaving(true)
    setError("")
    try {
      await sendJson(`${BRANCH_KPI_API}/bulk`, "POST", payload)
      onSaved(t("Успешно обновлено"))
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const goNext = () => {
    if (!kpis.length) {
      setError(t("Выберите KPI"))
      return
    }
    setError("")
    setNext(true)
  }

  if (!next) {
    const filtered = active.filter((item) => item.name.toLowerCase().includes(kpiSearch.trim().toLowerCase()))
    return (
      <KpiDialogFrame title={title} width={600} onClose={onClose} footer={<KpiDialogAction label={t("Далее")} onClick={goNext} disabled={!indicators} />}>
        <div className="min-h-[214px] space-y-4 px-[32px] pt-[27px] text-[13px] text-[#333]">
          {loadError && <p className="text-[#e57373]">{t(loadError)}</p>}
          {!indicators && !loadError && <p className="text-[#999]">{t("Загрузка...")}</p>}
          {indicators && !active.length && (
            <p className="rounded bg-[#f2f5f8] px-4 py-3 text-[#666]">
              {t("Нет KPI")}.{" "}
              <Link href="/analytics/kpi-tasks" className="font-semibold text-[#4f71dc] hover:underline">
                {t("KPI задачи")}
              </Link>
            </p>
          )}
          {indicators && active.length > 0 && (
            <>
              <div className="flex items-center">
                {(["allKpi", "selectedKpi"] as const).map((value) => (
                  <label key={value} className="flex w-[270px] cursor-pointer items-center gap-[18px]">
                    <input type="radio" name="kpi-type" checked={kpiType === value} onChange={() => setKpiType(value)} className="h-5 w-5 accent-[#757575]" />
                    {t(value === "allKpi" ? "Все активные KPI" : "Выбранные KPI")}
                  </label>
                ))}
              </div>
              {kpiType === "selectedKpi" && (
                <div>
                  <input
                    value={kpiSearch}
                    onChange={(event) => setKpiSearch(event.target.value)}
                    placeholder="KPI"
                    aria-label="KPI"
                    className="h-9 w-full border-b border-[#e0e0e0] text-[13px] outline-none focus:border-[#4f71dc]"
                  />
                  <div className="mt-2 max-h-[260px] overflow-y-auto">
                    {filtered.map((item) => (
                      <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b border-[#f2f5f8] py-2">
                        <input
                          type="checkbox"
                          checked={chosen.includes(item.id)}
                          onChange={() => setChosen((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                          className="h-4 w-4 accent-[#4f71dc]"
                        />
                        <span className="font-semibold">{item.name}</span>
                        <span className="ml-auto truncate text-[12px] text-[#999]">{t(item.planType)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {error && <p className="text-[#e57373]">{error}</p>}
        </div>
      </KpiDialogFrame>
    )
  }

  const values = draft?.key === periodKey ? draft.values : null
  return (
    <KpiDialogFrame
      fullScreen
      onClose={() => setNext(false)}
      title={
        <>
          <button type="button" onClick={() => setNext(false)} aria-label={t("Назад")} className="ml-[4px] mr-[10px] flex h-[38px] w-[38px] items-center justify-center text-[#666]">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <span className="truncate">{title}</span>
        </>
      }
      titleActions={<KpiDialogAction label={saving ? t("Сохранение...") : t("Сохранить")} onClick={() => void save()} disabled={saving || !values} />}
    >
      <div className="flex shrink-0 flex-wrap items-end gap-6 px-[15px] py-3">
        <KpiMonthYearFilter month={month} year={year} onChange={onPeriodChange} />
        {error && <span className="pb-1 text-[13px] text-[#e57373]">{error}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-[10px] pb-10 text-[13px] text-[#333]">
        {!values ? (
          <div className="py-16 text-center text-[#999]">{branches.length ? t("Загрузка...") : t("Выберите хотя бы один сотрудник !")}</div>
        ) : (
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr className="h-[50px] border-b border-[#f2f5f8] text-left font-semibold">
                <th className="sticky left-0 w-[248px] min-w-[248px] bg-white pr-3 font-semibold">{t("Филиал")}</th>
                {kpis.map((item) => (
                  <th key={item.id} className="min-w-[250px] pr-[16px] font-semibold" title={t(item.planType)}>
                    <span className="line-clamp-2">{item.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branches.map((row) => (
                <tr key={row.id} className="h-[50px] border-b border-[#f2f5f8] hover:bg-[#f2f5f8]">
                  <td className="sticky left-0 bg-inherit pr-3 font-semibold">{row.name}</td>
                  {kpis.map((item) => (
                    <td key={item.id} className="pr-[16px]">
                      <input
                        value={values[row.id]?.[item.id] ?? ""}
                        onChange={(event) => setCell(row.id, item.id, event.target.value)}
                        placeholder={t("Количество")}
                        aria-label={`${row.name} · ${item.name}`}
                        inputMode="decimal"
                        className="h-9 w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-black focus:border-[#4f71dc]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </KpiDialogFrame>
  )
}

export function BranchKpiDuplicateDialog({
  month,
  year,
  selected,
  onClose,
  onSaved,
}: {
  month: number
  year: number
  /** Selected branch ids (empty = every branch, demo is_all). */
  selected: number[]
  onClose: () => void
  onSaved: (message: string, target: { month: number; year: number }) => void
}) {
  const { t } = useLanguage()
  const monthName = useMonthName()
  const now = new Date()
  const [toMonth, setToMonth] = useState(now.getMonth() + 1)
  const [toYear, setToYear] = useState(String(now.getFullYear()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    const yearValue = Number(toYear)
    if (!Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) {
      setError(t("Введите корректный год"))
      return
    }
    setSaving(true)
    setError("")
    try {
      const result = await sendJson<{ copied: number }>(`${BRANCH_KPI_API}/copy`, "POST", {
        branches: selected,
        isAll: !selected.length,
        fromMonth: month,
        fromYear: year,
        toMonth,
        toYear: yearValue,
      })
      onSaved(result.copied ? `${t("Скопировано филиалов")}: ${result.copied}` : t("Нет планов для копирования"), { month: toMonth, year: yearValue })
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <KpiDialogFrame
      title={`${t("Дублировать с месяца")} ${monthName(month)}  ${year}`}
      width={450}
      onClose={onClose}
      footer={<KpiDialogAction label={saving ? t("Сохранение...") : t("Сохранить")} onClick={() => void save()} disabled={saving} />}
    >
      <form
        className="min-h-[243px] px-[30px] pt-[4px] text-[13px]"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="relative block h-[50px] border-b border-[#e0e0e0] focus-within:border-[#4f71dc]">
          <span className="absolute left-0 top-[2px] text-[10px] font-bold leading-3 text-black">{t("Месяц")}</span>
          <span className="absolute left-0 top-[26px] text-[13px] font-semibold leading-4 text-[#333]">{t(BRANCH_KPI_MONTHS[toMonth - 1] ?? "")}</span>
          <select value={toMonth} onChange={(event) => setToMonth(Number(event.target.value))} aria-label={t("Месяц")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
            {BRANCH_KPI_MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>
                {t(name)}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 10 7" className="pointer-events-none absolute right-[8px] top-[33px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
        </label>
        <label className="relative mt-[27px] block h-[50px] border-b border-[#e0e0e0] focus-within:border-[#4f71dc]">
          <span className="absolute left-0 top-[2px] text-[10px] font-bold leading-3 text-black">{t("Год")}</span>
          <input
            value={toYear}
            inputMode="numeric"
            maxLength={4}
            onChange={(event) => setToYear(event.target.value.replace(/\D/g, ""))}
            className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] font-semibold text-[#333] outline-none"
          />
        </label>
        {selected.length > 0 && <p className="mt-3 text-[12px] text-[#999]">{`${t("Выбрано")}: ${selected.length}`}</p>}
        {error && <p className="mt-3 text-[#e57373]">{error}</p>}
      </form>
    </KpiDialogFrame>
  )
}

type LevelDraft = { toAmount: string; bonus: string; calculationType: BranchKpiCalcType | ""; excludeLowLevel: boolean }

const EMPTY_LEVEL: LevelDraft = { toAmount: "", bonus: "", calculationType: "", excludeLowLevel: false }

/** Reward levels + bonus fund of one KPI (stored by this page; demo: the KPI card stages). */
export function BranchKpiLevelsDialog({
  indicatorId,
  month,
  year,
  canEdit,
  onClose,
  onSaved,
}: {
  indicatorId: number
  month: number
  year: number
  canEdit: boolean
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useLanguage()
  const { indicators, error: loadError } = useKpiIndicators()
  const indicator = indicators?.find((item) => item.id === indicatorId) ?? null
  const [state, setState] = useState<{ id: number; bonusFund: string; levels: BranchKpiLevel[] } | null>(null)
  const [levelDraft, setLevelDraft] = useState<LevelDraft>(EMPTY_LEVEL)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  if (indicator && state?.id !== indicator.id) setState({ id: indicator.id, bonusFund: indicator.bonusFund ? String(indicator.bonusFund) : "", levels: indicator.levels })

  const levels = state?.levels ?? []
  const fromInitial = levels.length ? levels[levels.length - 1].toAmount : 0

  const addLevel = () => {
    const toAmount = parsePlan(levelDraft.toAmount)
    const bonus = parsePlan(levelDraft.bonus)
    if (toAmount === null || bonus === null || !levelDraft.calculationType || Number.isNaN(toAmount) || Number.isNaN(bonus)) {
      setError(t("Заполните «До», «Бонус» и «Тип расчета»"))
      return
    }
    if (toAmount <= fromInitial) {
      setError(t("«До» должно быть больше «От»"))
      return
    }
    setError("")
    setState((current) =>
      current
        ? {
            ...current,
            levels: [
              ...current.levels,
              { id: current.levels.length + 1, fromAmount: fromInitial, toAmount, bonus, calculationType: levelDraft.calculationType as BranchKpiCalcType, excludeLowLevel: levelDraft.excludeLowLevel },
            ],
          }
        : current,
    )
    setLevelDraft(EMPTY_LEVEL)
  }

  const removeLevel = (index: number) =>
    setState((current) => (current ? { ...current, levels: current.levels.filter((_, position) => position !== index).map((level, position) => ({ ...level, id: position + 1 })) } : current))

  const save = async () => {
    if (!state) return
    const bonusFund = parsePlan(state.bonusFund)
    if (Number.isNaN(bonusFund)) {
      setError(t("Введите корректное число"))
      return
    }
    setSaving(true)
    setError("")
    try {
      await sendJson(`${BRANCH_KPI_API}/indicators/${indicatorId}`, "PUT", {
        bonusFund: bonusFund ?? 0,
        levels: state.levels.map(({ fromAmount, toAmount, bonus, calculationType, excludeLowLevel }) => ({ fromAmount, toAmount, bonus, calculationType, excludeLowLevel })),
        month,
        year,
      })
      onSaved(t("Успешно обновлено"))
    } catch (reason) {
      setError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const field = "h-9 w-full border-b border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none focus:border-[#4f71dc] disabled:text-[#999]"
  return (
    <KpiDialogFrame
      title={indicator ? `KPI: ${indicator.name}` : "KPI"}
      width={820}
      onClose={onClose}
      footer={canEdit ? <KpiDialogAction label={saving ? t("Сохранение...") : t("Сохранить")} onClick={() => void save()} disabled={saving || !state} /> : undefined}
    >
      <div className="space-y-4 px-[30px] py-5 text-[13px] text-[#333]">
        {loadError && <p className="text-[#e57373]">{t(loadError)}</p>}
        {!indicators && !loadError && <p className="text-[#999]">{t("Загрузка...")}</p>}
        {indicators && !indicator && <p className="text-[#e57373]">{t("KPI не найден")}</p>}
        {indicator && state && (
          <>
            <ul className="space-y-1.5">
              <li className="flex justify-between gap-4">
                <span className="text-[#666]">{t("Тип плана")}</span>
                <span className="text-right font-semibold">{t(indicator.planType)}</span>
              </li>
              {!indicator.supported && <li className="text-[12px] text-[#e57373]">{t("нет данных в системе")}</li>}
              <li className="flex justify-between gap-4">
                <span className="text-[#666]">{t("Активный")}</span>
                <span className="font-semibold">{indicator.active ? t("Да") : t("Нет")}</span>
              </li>
            </ul>
            <label className="block max-w-[260px] text-[12px] text-[#999]">
              {t("Бонусный фонд")}
              <input
                value={state.bonusFund}
                disabled={!canEdit}
                inputMode="decimal"
                onChange={(event) => setState({ ...state, bonusFund: cleanNumberInput(event.target.value) })}
                className={field}
              />
            </label>
            <h3 className="pt-2 font-semibold">{t("Уровень вознаграждения")}</h3>
            {canEdit && (
              <div className="-mx-[30px] flex flex-wrap items-end gap-4 bg-[#f1f5f8] px-[30px] pb-2.5 pt-3">
                <div className="flex items-end gap-1.5 whitespace-nowrap">
                  {t("от")} <b>{kpiNumber(fromInitial, "%")}</b> - {t("до")}
                  <input
                    value={levelDraft.toAmount}
                    inputMode="decimal"
                    aria-label={t("До")}
                    onChange={(event) => setLevelDraft({ ...levelDraft, toAmount: cleanNumberInput(event.target.value) })}
                    onKeyDown={(event) => event.key === "Enter" && addLevel()}
                    className={`${field} w-[80px]`}
                  />
                  %
                </div>
                <label className="block w-[140px] text-[12px] text-[#999]">
                  {t("Бонус")}
                  <input
                    value={levelDraft.bonus}
                    inputMode="decimal"
                    onChange={(event) => setLevelDraft({ ...levelDraft, bonus: cleanNumberInput(event.target.value) })}
                    onKeyDown={(event) => event.key === "Enter" && addLevel()}
                    className={field}
                  />
                </label>
                <label className="block w-[220px] text-[12px] text-[#999]">
                  {t("Тип расчета")}
                  <select value={levelDraft.calculationType} onChange={(event) => setLevelDraft({ ...levelDraft, calculationType: event.target.value as BranchKpiCalcType })} className={field}>
                    <option value="" />
                    {BRANCH_KPI_CALC_TYPES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {t(item.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={levelDraft.excludeLowLevel}
                    onChange={(event) => setLevelDraft({ ...levelDraft, excludeLowLevel: event.target.checked })}
                    className="h-4 w-4 accent-[#4f71dc]"
                  />
                  {t("Обнулить предыдущие уровни")}
                </label>
                <button type="button" onClick={addLevel} aria-label={t("Добавить")} title={t("Добавить")} className="ml-auto pb-1.5 text-[#4f71dc]">
                  <PlusCircle className="h-7 w-7" />
                </button>
              </div>
            )}
            {levels.length ? (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="h-[50px] border-b-2 border-dotted border-[#dbe0e8] font-semibold">
                    <th className="font-semibold">№</th>
                    <th className="font-semibold">{t("От")}</th>
                    <th className="font-semibold">{t("До")}</th>
                    <th className="font-semibold">{t("Бонус")}</th>
                    <th className="font-semibold">{t("Тип расчета")}</th>
                    <th className="font-semibold">{t("Обнуление уровней")}</th>
                    {canEdit && <th className="w-10" />}
                  </tr>
                </thead>
                <tbody>
                  {levels.map((level, index) => (
                    <tr key={`${level.id}-${level.fromAmount}`} className="h-[50px] border-b-2 border-dotted border-[#dbe0e8] font-semibold last:border-b-0">
                      <td>{level.id}</td>
                      <td>{kpiNumber(level.fromAmount, "%")}</td>
                      <td>{kpiNumber(level.toAmount, "%")}</td>
                      <td>{kpiNumber(level.bonus)}</td>
                      <td>{t(branchKpiCalcTypeName(level.calculationType))}</td>
                      <td>{level.excludeLowLevel ? t("Включено") : t("Отключено")}</td>
                      {canEdit && (
                        <td>
                          <button type="button" onClick={() => removeLevel(index)} aria-label={t("Удалить")} title={t("Удалить")} className="p-2 text-[#666] hover:text-[#e57373]">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="py-6 text-center text-[#999]">{t("Нет уровней вознаграждения")}</p>
            )}
          </>
        )}
        {error && <p className="text-[#e57373]">{error}</p>}
      </div>
    </KpiDialogFrame>
  )
}
