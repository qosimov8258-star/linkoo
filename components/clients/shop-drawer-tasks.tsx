"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { SearchSelect, type PickOption } from "@/components/analytics/cash-management-shared"
import { TASK_PLAN_FREQUENCIES, TASK_REPEAT_MAX, isTaskDate, repeatPlanDates, type TaskOptions } from "@/components/analytics/tasks-data"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { useShopDrawerOrderLink } from "./shop-drawer-order"
import { readShopDrawerParam, writeShopDrawerParams } from "./shop-drawer-url"

// ЗАДАЧИ of the shop drawer, as Linko's: «Создать задачу» opens an inline form in place of the timeline
// (?openCreateNotification=true; the button turns into «Закрыть»): the shop's responsible people as radios plus «Другие»,
// «Клиент», «Дата выполнения задачи», «Повторять план» (with «Недельный период» / «Количество планов» and the plan days),
// «Комментарий...» and «Создать» (a task of «Задачи», POST /api/tasks). The timeline lists the shop's plans 25 at a time
// (GET /api/clients/[id]/plans) and loads the next ones while it is scrolled to the end.

type Plan = { key: string; user: string; text: string; status: string; type: string; doneAt: string | null; orderId: number | null }
type PlanPage = { count: number; results: Plan[] }
type Responsible = { employeeId: number; name: string; role: string }

const PAGE_SIZE = 25

/** "17 июля 08:24": Linko's moment(doneTime).format("DD MMM") + " HH:mm" (Russian months for ru and uz alike). */
function doneLabel(value: string, language: string): string {
  const day = formatStatementDate(value.slice(0, 10), language === "uz" ? "ru" : language, false)
  return `${day.replace(/\s+\d{4}$/, "")} ${value.slice(11, 16)}`
}

function StatusIcon({ status, type }: { status: string; type: string }) {
  if (status === "done") {
    return (
      <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 ${type === "no_plan_visit" ? "fill-[#e57373]" : "fill-[#92ce95]"}`} aria-hidden>
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    )
  }
  if (status === "undone") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-[rgb(229,115,115)]" aria-hidden>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z" />
      </svg>
    )
  }
  if (status === "pending") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-[rgb(240,173,78)]" aria-hidden>
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
      </svg>
    )
  }
  return null
}

function Hint({ text }: { text: string }) {
  const { t } = useLanguage()
  return (
    <span title={t(text)} aria-label={t(text)} role="img" className="inline-flex h-6 w-6 shrink-0 cursor-help items-center justify-center">
      {/* Linko's outlined (i), 24 px, in its blue. */}
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]" aria-hidden>
        <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
      </svg>
    </span>
  )
}

/** Linko's material field: the label sits inside the empty field (13 px, bold) and moves above it once filled. */
function FloatField({ label, filled, children }: { label: string; filled: boolean; children: ReactNode }) {
  return (
    <label className="relative block h-[56px] w-full flex-1 pt-[22px]">
      <span
        className={`pointer-events-none absolute left-0 origin-top-left font-semibold text-black transition-transform duration-150 ${filled ? "top-[6px] scale-75" : "top-[30px]"} text-[13px] leading-[16px]`}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

function CreateTaskForm({ clientId, clientName, onCreated }: { clientId: number; clientName: string; onCreated: () => void }) {
  const { t, language } = useLanguage()
  const [responsibles, setResponsibles] = useState<Responsible[] | null>(null)
  const [options, setOptions] = useState<TaskOptions | null>(null)
  const [choice, setChoice] = useState("")
  const [otherId, setOtherId] = useState("")
  const [shopId, setShopId] = useState(String(clientId))
  const [date, setDate] = useState("")
  const [repeat, setRepeat] = useState(false)
  // Linko's «Недельный период» starts empty.
  const [frequency, setFrequency] = useState("")
  const [count, setCount] = useState("")
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/clients/${clientId}/responsible-users`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Responsible[]>) : []))
      .then((rows) => setResponsibles(Array.isArray(rows) ? rows : []))
      .catch((cause: { name?: string }) => {
        if (cause?.name !== "AbortError") setResponsibles([])
      })
    fetch("/api/tasks/options", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<TaskOptions>) : null))
      .then(setOptions)
      .catch(() => {})
    return () => controller.abort()
  }, [clientId])

  const clientOptions: PickOption[] = (options?.clients ?? []).map((item) => ({ value: String(item.id), label: item.name, hint: item.hint }))
  const employeeOptions: PickOption[] = (options?.employees ?? []).filter((item) => item.active !== false).map((item) => ({ value: String(item.id), label: item.name, hint: item.hint }))
  const repeatCount = /^\d{1,3}$/.test(count.trim()) ? Number(count.trim()) : 0
  const preview = repeat && frequency && isTaskDate(date) ? repeatPlanDates(date, Number(frequency), repeatCount) : []

  async function submit() {
    const employeeId = choice === "other" ? otherId : choice
    const next: Record<string, string> = {}
    if (!employeeId) next.employee = "Выберите ответственного"
    if (!shopId) next.client = "Выберите магазин"
    if (!date) next.date = "Укажите дату"
    if (repeat && !frequency) next.frequency = "Обязательное поле"
    if (repeat && !(repeatCount >= 1 && repeatCount <= TASK_REPEAT_MAX)) next.count = "Введите целое число от 1 до 52"
    if (!comment.trim()) next.comment = "Обязательное поле"
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: comment.trim(),
          clientId: Number(shopId),
          employeeId: Number(employeeId),
          taskDate: date,
          repeat: repeat ? { frequency: Number(frequency), count: repeatCount } : null,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string; field?: string }
      if (!response.ok) {
        const message = response.status === 403 ? "Недостаточно прав" : body.error || "Не удалось сохранить задачу"
        const field = body.field === "title" ? "comment" : body.field === "clientId" ? "client" : body.field === "employeeId" ? "employee" : body.field === "taskDate" ? "date" : body.field === "repeat.count" ? "count" : "form"
        setErrors({ [field]: message })
        return
      }
      onCreated()
    } catch {
      setErrors({ form: "Сервер недоступен, попробуйте ещё раз" })
    } finally {
      setSaving(false)
    }
  }

  const error = (name: string) => (errors[name] ? <p className="mt-1 text-[12px] text-[#e57373]">{t(errors[name])}</p> : null)
  const underline = "h-[34px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] text-black outline-none focus:border-[#1E4A9A]"

  return (
    <form
      className="flex min-h-[300px] flex-col gap-[16px] pt-[10px]"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div role="radiogroup" className="flex flex-col">
        {responsibles === null ? (
          <p className="py-2 text-[#999]">{t("Загрузка...")}</p>
        ) : (
          [...responsibles.map((item) => ({ value: String(item.employeeId), label: `${item.name} ${t(item.role)}` })), { value: "other", label: t("Другие") }].map((option) => (
            <label key={option.value} className="flex h-[34px] cursor-pointer items-center gap-[16px] text-[13px] text-black">
              <input type="radio" name="shop-task-responsible" checked={choice === option.value} onChange={() => setChoice(option.value)} className="h-[22px] w-[22px] shrink-0 accent-[#333]" />
              <span>{option.label}</span>
            </label>
          ))
        )}
        {error("employee")}
      </div>
      {choice === "other" && (
        <div className="w-full">
          <p className="mb-[2px] text-[11px] font-semibold text-black">{t("Ответственный")}</p>
          <SearchSelect variant="underline" value={otherId} onChange={(value) => setOtherId(value)} options={employeeOptions} placeholder={t("Поиск")} loading={options === null} />
        </div>
      )}
      <div className="w-full">
        <p className="mb-[2px] text-[11px] font-semibold text-black">{t("Клиент")}</p>
        <SearchSelect variant="underline" value={shopId} onChange={(value) => setShopId(value)} options={clientOptions} selectedLabel={shopId === String(clientId) ? clientName : undefined} placeholder={t("Поиск")} loading={options === null} />
        {error("client")}
      </div>
      <label className="relative mt-[22px] block w-full">
        <input
          type="date"
          value={date}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(event) => setDate(event.target.value)}
          aria-label={t("Дата выполнения задачи")}
          className={`peer ${underline} ${date ? "" : "text-transparent focus:text-black"}`}
        />
        {/* Linko's field shows its label until a day is picked. */}
        {!date && <span className="pointer-events-none absolute left-0 top-[8px] text-[13px] text-black peer-focus:hidden">{t("Дата выполнения задачи")}</span>}
        {error("date")}
      </label>
      <label className="mt-[16px] flex cursor-pointer items-center gap-[10px] text-[13px] font-semibold text-black">
        <input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} className="h-[16px] w-[16px] accent-[#333]" />
        {t("Повторять план")}
      </label>
      {repeat && (
        <div className="w-full">
          <div className="flex items-end gap-[10px]">
            <FloatField label={t("Недельный период")} filled={!!frequency}>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value)} className={`${underline} appearance-none pr-[24px] ${frequency ? "" : "text-transparent"}`}>
                <option value="" />
                {TASK_PLAN_FREQUENCIES.map((option) => (
                  <option key={option.value} value={String(option.value)} className="text-black">
                    {t(option.label)}
                  </option>
                ))}
              </select>
              {/* Linko's grey arrow at the field's end. */}
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[5px] right-0 h-6 w-6 fill-[#999]" aria-hidden>
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </FloatField>
            <span className="mb-[8px]">
              <Hint text="С какой периодичностью ставить в план данную задачу" />
            </span>
          </div>
          {error("frequency")}
          <div className="flex items-end gap-[10px]">
            <FloatField label={t("Количество планов")} filled={count !== ""}>
              <input type="number" min={1} max={TASK_REPEAT_MAX} value={count} onChange={(event) => setCount(event.target.value)} className={underline} />
            </FloatField>
            <span className="mb-[8px]">
              <Hint text="Сколько раз поставить в план сотруднику выполнение этой задачи" />
            </span>
          </div>
          {error("count")}
          {preview.length > 0 && (
            <div className="mt-[12px] text-[14px] font-medium text-[#666]">
              <div>{t("Планы установятся на даты")}:</div>
              <div className="mt-[6px]">
                {preview.map((day, index) => (
                  <div key={day}>
                    {formatStatementDate(day, language, false)}
                    {index !== preview.length - 1 ? "," : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        rows={1}
        maxLength={1000}
        placeholder={`${t("Комментарий")}...`}
        className="mt-[10px] min-h-[34px] w-full resize-y border-b border-[#e0e0e0] bg-transparent py-[6px] text-[13px] leading-[20px] outline-none placeholder:font-semibold placeholder:text-black focus:border-[#1E4A9A]"
      />
      {error("comment")}
      {error("form")}
      <button type="submit" disabled={saving} className="mt-[10px] h-[34px] w-full rounded-[5px] bg-[#1E4A9A] text-[13px] font-semibold text-white disabled:opacity-60">
        {t("Создать")}
      </button>
    </form>
  )
}

export function ShopTasksTab({ clientId, clientName }: { clientId: number; clientName: string }) {
  const { t, language } = useLanguage()
  // «Просмотреть»: the order card over the page when the page shows one (Linko's ?orderDetails=<id>), else the order page.
  const orderLink = useShopDrawerOrderLink()
  const [formOpen, setFormOpen] = useState(() => readShopDrawerParam("openCreateNotification") === "true")
  const [plans, setPlans] = useState<Plan[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  const nextPage = useRef(1)
  const busy = useRef(false)
  const sentinel = useRef<HTMLDivElement>(null)

  const loadPage = useCallback(
    async (page: number, signal?: AbortSignal) => {
      if (busy.current) return
      busy.current = true
      setLoading(true)
      try {
        const response = await fetch(`/api/clients/${clientId}/plans?page=${page}&pageSize=${PAGE_SIZE}`, { cache: "no-store", signal })
        const body = (await response.json().catch(() => null)) as (PlanPage & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.results)) throw new Error(body?.error || "Не удалось загрузить данные")
        setPlans((current) => (page === 1 ? body.results : [...current, ...body.results.filter((plan) => !current.some((item) => item.key === plan.key))]))
        setCount(body.count)
        nextPage.current = page + 1
        setError("")
      } catch (cause) {
        if ((cause as { name?: string })?.name !== "AbortError") setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        busy.current = false
        setLoading(false)
      }
    },
    [clientId],
  )

  useEffect(() => {
    if (formOpen) return
    const controller = new AbortController()
    busy.current = false
    nextPage.current = 1
    void loadPage(1, controller.signal)
    return () => controller.abort()
  }, [loadPage, formOpen, version])

  const hasMore = count !== null && plans.length < count
  // Linko's infinite list: the next 25 come once the end of the timeline scrolls into view.
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore || formOpen) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadPage(nextPage.current)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, formOpen, loadPage, plans.length])

  const toggleForm = () => {
    const next = !formOpen
    setFormOpen(next)
    writeShopDrawerParams({ openCreateNotification: next ? "true" : null })
  }

  return (
    <div className="p-5">
      <button type="button" onClick={toggleForm} className="mb-5 h-[34px] w-full rounded-[5px] bg-[#1E4A9A] text-[13px] font-semibold text-white">
        {formOpen ? t("Закрыть") : t("Создать задачу")}
      </button>
      {formOpen ? (
        <CreateTaskForm
          clientId={clientId}
          clientName={clientName}
          onCreated={() => {
            setFormOpen(false)
            writeShopDrawerParams({ openCreateNotification: null })
            setVersion((value) => value + 1)
          }}
        />
      ) : count === 0 ? (
        <div className="flex flex-col items-center pt-[20px] text-center text-[13px] text-[#666]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[120px]" />
          <span className="mt-[10px]">{t("На сегодня задачи по клиенту {marketName} не заданы").replace("{marketName}", clientName)}</span>
        </div>
      ) : (
        <div className="relative pt-[10px]">
          {plans.length > 0 && <span className="absolute bottom-0 left-[8px] top-0 w-[3px] bg-[#22a6c6]" />}
          {plans.map((plan) => (
            <div key={plan.key} className="relative mb-[10px] pl-[41px]">
              <span className="absolute left-0 top-[15px] h-4 w-4 rounded-full bg-[#22a6c6] outline outline-2 outline-[#f4f4f4]" />
              <div className="relative mr-[10px] rounded-[2px] bg-white px-5 py-[15px] text-[#666] shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
                <span className="absolute -left-[9px] top-[13px] h-0 w-0 border-y-[9px] border-r-[9px] border-y-transparent border-r-white" />
                <div className="flex justify-between gap-3">
                  {/* Linko's 14 px line for the name, 16.25 px for the moment: a card with a moment is 2 px taller. */}
                  <h2 className="mb-[10px] text-base font-bold leading-[14px]">{plan.user.trim() || t("Не указан")}</h2>
                  {plan.doneAt && <p className="mb-[10px] whitespace-nowrap leading-[16.25px]">{doneLabel(plan.doneAt, language)}</p>}
                </div>
                <div className="flex min-h-[25px] items-center gap-[10px] font-semibold leading-[25px]">
                  <StatusIcon status={plan.status} type={plan.type} />
                  {/* Linko's server text, shown as it comes (also in uz). */}
                  <span>
                    {plan.text}
                    {plan.type === "order" && plan.orderId !== null && (
                      <>
                        {" ("}
                        {orderLink ? (
                          <a
                            href={orderLink.href(plan.orderId)}
                            onClick={(event) => {
                              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || plan.orderId === null) return
                              event.preventDefault()
                              orderLink.open(plan.orderId)
                            }}
                            className="text-[#129fdd] hover:underline"
                          >
                            {t("Просмотреть")}
                          </a>
                        ) : (
                          <Link href={`/analytics/sales/${plan.orderId}`} className="text-[#129fdd] hover:underline">
                            {t("Просмотреть")}
                          </Link>
                        )}
                        {")"}
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {error && <p className="py-3 text-center text-[#e57373]">{t(error)}</p>}
          {loading && <p className="py-3 text-center text-[#888]">{t("Загрузка...")}</p>}
          <div ref={sentinel} className="h-px" />
        </div>
      )}
    </div>
  )
}
