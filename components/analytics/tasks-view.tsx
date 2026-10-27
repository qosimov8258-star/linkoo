"use client"

import { Loader2 } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"

import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { RI, RefButton, RefCard, RefEmpty, RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  TASK_DEFAULT_PAGE_SIZE,
  TASK_PAGE_SIZES,
  TASK_TABS,
  monthRange,
  todayTaskDate,
  type TaskDetail,
  type TaskListResponse,
  type TaskOptions,
  type TaskTab,
} from "./tasks-data"
import { TaskDialog } from "./tasks-dialog"
import { TaskDrawer, TaskStatusIcon } from "./tasks-drawer"
import { TaskFilterControl, type TaskFilterValue } from "./tasks-filter"
import { TasksImportDialog } from "./tasks-import"

// "Задачи" (/analytics/tasks), the reference app's "#/task-management/": tabs В процессе / Выполнено /
// Завершенный / Все, the filter (opens on the current month of "Дата задачи"), search, server-side
// paging, the task drawer (?task=<id>), "Добавить" / "Импортировать". The view state lives in the
// URL (status, search, page, pageSize, responsible, createdBy, client, createdFrom, createdTo,
// taskFrom, taskTo, task), so a reload or a shared link shows the same list.

type ViewState = TaskFilterValue & { tab: TaskTab; search: string; page: number; pageSize: number; task: number | null }

const LIST_KEYS = ["responsible", "createdBy", "client"] as const
const DAY_KEYS = ["createdFrom", "createdTo", "taskFrom", "taskTo"] as const

const ids = (raw: string | null) =>
  (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^\d{1,10}$/.test(part))
const day = (raw: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(raw ?? "") ? (raw as string) : "")
const positive = (raw: string | null, fallback: number) => (/^\d{1,7}$/.test(raw ?? "") && Number(raw) > 0 ? Number(raw) : fallback)

/** The state of the URL; "Период задачи" defaults to the current month until the URL says otherwise. */
function stateOf(params: URLSearchParams, today: string): ViewState {
  const tabText = params.get("status") ?? ""
  const tab = (TASK_TABS.some((item) => item.key === tabText) ? tabText : "all") as TaskTab
  const [monthFrom, monthTo] = monthRange(today)
  const hasTaskPeriod = params.has("taskFrom") || params.has("taskTo")
  const size = positive(params.get("pageSize"), TASK_DEFAULT_PAGE_SIZE)
  return {
    tab,
    search: (params.get("search") ?? "").slice(0, 200),
    page: positive(params.get("page"), 1),
    pageSize: (TASK_PAGE_SIZES as readonly number[]).includes(size) ? size : TASK_DEFAULT_PAGE_SIZE,
    responsible: ids(params.get("responsible")),
    createdBy: ids(params.get("createdBy")),
    client: ids(params.get("client")),
    createdFrom: day(params.get("createdFrom")),
    createdTo: day(params.get("createdTo")),
    taskFrom: hasTaskPeriod ? day(params.get("taskFrom")) : monthFrom,
    taskTo: hasTaskPeriod ? day(params.get("taskTo")) : monthTo,
    task: /^\d{1,10}$/.test(params.get("task") ?? "") ? Number(params.get("task")) : null,
  }
}

/** The URL of a state (defaults left out; a cleared task period is kept as empty values). */
function paramsOf(state: ViewState, today: string): URLSearchParams {
  const params = new URLSearchParams()
  if (state.tab !== "all") params.set("status", state.tab)
  if (state.search) params.set("search", state.search)
  if (state.page > 1) params.set("page", String(state.page))
  if (state.pageSize !== TASK_DEFAULT_PAGE_SIZE) params.set("pageSize", String(state.pageSize))
  for (const key of LIST_KEYS) if (state[key].length) params.set(key, state[key].join(","))
  if (state.createdFrom) params.set("createdFrom", state.createdFrom)
  if (state.createdTo) params.set("createdTo", state.createdTo)
  const [monthFrom, monthTo] = monthRange(today)
  if (state.taskFrom !== monthFrom || state.taskTo !== monthTo) {
    params.set("taskFrom", state.taskFrom)
    params.set("taskTo", state.taskTo)
  }
  if (state.task !== null) params.set("task", String(state.task))
  return params
}

/** The API query of a state (GET /api/tasks). */
function apiParamsOf(state: ViewState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.tab !== "all") params.set("status", state.tab)
  if (state.search) params.set("search", state.search)
  for (const key of LIST_KEYS) if (state[key].length) params.set(key, state[key].join(","))
  for (const key of DAY_KEYS) if (state[key]) params.set(key, state[key])
  return params
}

const EMPTY_OPTIONS: TaskOptions = { clients: [], employees: [], creators: [] }

export function TasksView() {
  const { t, language } = useLanguage()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const today = useMemo(() => todayTaskDate(), [])
  const state = useMemo(() => stateOf(new URLSearchParams(searchParams.toString()), today), [searchParams, today])
  const canManage = useCanManage(["clients.manage"])

  const [searchText, setSearchText] = useState(state.search)
  const [data, setData] = useState<TaskListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const [options, setOptions] = useState<TaskOptions>(EMPTY_OPTIONS)
  const [optionsKey, setOptionsKey] = useState(0)
  const [dialog, setDialog] = useState<{ task: TaskDetail | null } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [drawerKey, setDrawerKey] = useState(0)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  // The search box follows the URL (back / forward, a cleared filter).
  useEffect(() => setSearchText(state.search), [state.search])

  /** Writes a new state into the URL (Next.js keeps useSearchParams in sync, no server round-trip). */
  const navigate = useCallback(
    (patch: Partial<ViewState>, mode: "push" | "replace" = "replace") => {
      const next = paramsOf({ ...state, ...patch }, today).toString()
      const url = `${pathname}${next ? `?${next}` : ""}`
      if (mode === "push") window.history.pushState(null, "", url)
      else window.history.replaceState(null, "", url)
    },
    [state, pathname, today],
  )

  const apiQuery = useMemo(() => apiParamsOf(state), [state])
  const apiKey = apiQuery.toString()

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const params = new URLSearchParams(apiKey)
    params.set("page", String(state.page))
    params.set("pageSize", String(state.pageSize))
    fetch(`/api/tasks?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as TaskListResponse & { error?: string }
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить задачи")
        setData(body)
        setLoadError("")
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setLoadError(error instanceof Error && error.message ? error.message : "Не удалось загрузить задачи")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [apiKey, state.page, state.pageSize, reloadKey])

  useEffect(() => {
    let cancelled = false
    fetch("/api/tasks/options", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<TaskOptions>) : EMPTY_OPTIONS))
      .then((body) => {
        if (!cancelled) setOptions({ clients: body.clients ?? [], employees: body.employees ?? [], creators: body.creators ?? [] })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [optionsKey])

  const count = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(count / state.pageSize))
  const rows = data?.results ?? []
  const from = count ? (state.page - 1) * state.pageSize + 1 : 0
  const to = Math.min(state.page * state.pageSize, count)

  // A page beyond the end (the list shrank) goes back to the last page.
  useEffect(() => {
    if (!loading && data && state.page > pageCount) navigate({ page: pageCount })
  }, [loading, data, state.page, pageCount, navigate])

  const filterValue: TaskFilterValue = {
    responsible: state.responsible,
    createdBy: state.createdBy,
    client: state.client,
    createdFrom: state.createdFrom,
    createdTo: state.createdTo,
    taskFrom: state.taskFrom,
    taskTo: state.taskTo,
  }

  const employeeOptions = useMemo(() => options.employees.map(({ id, name, hint }) => ({ id, name, hint })), [options.employees])
  const clientOptions = useMemo(() => options.clients.map(({ id, name, hint }) => ({ id, name, hint })), [options.clients])

  const taskHref = (id: number) => {
    const params = paramsOf({ ...state, task: id }, today).toString()
    return `${pathname}?${params}`
  }

  const openTask = (event: MouseEvent<HTMLAnchorElement>, id: number) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate({ task: id }, "push")
  }

  const afterSave = (saved: TaskDetail, created: boolean) => {
    setDialog(null)
    setMessage({ text: "Задача сохранена", tone: "success" })
    setOptionsKey((value) => value + 1)
    setDrawerKey((value) => value + 1)
    if (created) {
      // Show the new task: the first page of "Все", without filters that would hide it.
      const [monthFrom, monthTo] = monthRange(saved.taskDate || today)
      const keepPeriod = !state.taskFrom && !state.taskTo
      navigate({
        tab: "all",
        search: "",
        page: 1,
        responsible: [],
        createdBy: [],
        client: [],
        createdFrom: "",
        createdTo: "",
        taskFrom: keepPeriod ? "" : monthFrom,
        taskTo: keepPeriod ? "" : monthTo,
      })
    }
    setReloadKey((value) => value + 1)
  }

  return (
    <RefPage>
      <RefHeader title="Задачи">
        {canManage && <RefButton icon={RI.chart} label="Импортировать" onClick={() => setImportOpen(true)} />}
        {canManage && <RefButton icon={RI.add} green label="Добавить" onClick={() => setDialog({ task: null })} />}
      </RefHeader>

      <RefCard className="bg-white">
        <RefTabs
          labels={TASK_TABS.map((item) => item.label)}
          value={TASK_TABS.find((item) => item.key === state.tab)?.label ?? "Все"}
          onChange={(label) => navigate({ tab: TASK_TABS.find((item) => item.label === label)?.key ?? "all", page: 1 })}
        />

        <div className="relative flex h-[50px] items-center border-t border-[#efefef] bg-white px-[5px]">
          <div className="w-[355px] shrink-0">
            <TaskFilterControl
              value={filterValue}
              employees={employeeOptions}
              creators={options.creators}
              clients={clientOptions}
              onApply={(next) => navigate({ ...next, page: 1 })}
            />
          </div>
          <form
            role="search"
            className="relative ml-[18px] flex w-[300px] items-center border-b border-[#e0e0e0] focus-within:border-[#5d6474]"
            onSubmit={(event) => {
              event.preventDefault()
              navigate({ search: searchText.trim().slice(0, 200), page: 1 })
            }}
          >
            <input
              value={searchText}
              maxLength={200}
              onChange={(event) => {
                setSearchText(event.target.value)
                // An emptied box shows everything again at once.
                if (!event.target.value && state.search) navigate({ search: "", page: 1 })
              }}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30"
            />
            <button type="submit" aria-label={t("Поиск")} className="shrink-0">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#ccc]" aria-hidden>
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            </button>
          </form>
          <div className="ml-auto flex items-center text-[#5d6474]">
            <div className="relative mr-[27px]">
              <select
                value={state.pageSize}
                aria-label={t("Строк на странице")}
                onChange={(event) => navigate({ pageSize: Number(event.target.value), page: 1 })}
                className="h-12 w-[52px] appearance-none bg-transparent text-[13px] text-[#333] outline-none"
              >
                {TASK_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30" aria-hidden>
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </div>
            <span className="mr-2 whitespace-nowrap">
              {from} - {to} {t("из")} {count}
            </span>
            <button type="button" disabled={state.page <= 1} onClick={() => navigate({ page: state.page - 1 })} aria-label={t("Назад")} className="px-[5px]">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${state.page <= 1 ? "fill-black/30" : "fill-black/55"}`} aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" />
              </svg>
            </button>
            <button type="button" disabled={state.page >= pageCount} onClick={() => navigate({ page: state.page + 1 })} aria-label={t("Вперед")}>
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${state.page >= pageCount ? "fill-black/30" : "fill-black/55"}`} aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto bg-white">
          <div className="min-w-[900px]">
            <div className="grid h-[50px] grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,5fr)_minmax(0,1fr)] items-center bg-[#5d6474] px-[30px] text-[13px] font-semibold text-white">
              <div className="px-2">№</div>
              <div className="px-2">{t("Ответственный")}</div>
              <div className="px-2">{t("Дата задачи")}</div>
              <div className="px-2">{t("Магазин")}</div>
              <div className="px-2">{t("Описание")}</div>
              <div className="px-2" />
            </div>
            {loading && !data ? (
              <div className="flex min-h-[200px] items-center justify-center text-[#5d6474]">
                <Loader2 className="h-7 w-7 animate-spin" aria-label={t("Загрузка...")} />
              </div>
            ) : loadError ? (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-[13px]">
                <p className="text-[#e57373]">{t(loadError)}</p>
                <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="text-[#4f71dc] hover:underline">
                  {t("Повторить")}
                </button>
              </div>
            ) : rows.length === 0 ? (
              <RefEmpty text="По вашему запросу ничего не найдено" />
            ) : (
              <div className={loading ? "opacity-60" : ""}>
                {rows.map((task) => (
                  <a
                    key={task.id}
                    href={taskHref(task.id)}
                    onClick={(event) => openTask(event, task.id)}
                    className={`grid min-h-[50px] grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,5fr)_minmax(0,1fr)] items-center border-b border-dashed border-[#d6d6d6] px-[30px] py-[7px] text-[13px] text-[#333] hover:bg-[#f2f5f8] ${state.task === task.id ? "bg-[#f2f5f8]" : ""}`}
                  >
                    <div className="px-2">{task.id}</div>
                    <div className="truncate px-2">{task.responsible || t("Не указано")}</div>
                    <div className="px-2">{task.taskDate ? formatDateText(task.taskDate, language, { withTime: false }) : t("Не указано")}</div>
                    <div className="truncate px-2">{task.client || t("Не указано")}</div>
                    <div className="line-clamp-2 break-words px-2">{task.title}</div>
                    <div className="flex justify-end px-2">
                      <TaskStatusIcon status={task.status} />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </RefCard>

      {state.task !== null && (
        <TaskDrawer
          taskId={state.task}
          canManage={canManage}
          paused={dialog !== null}
          refreshKey={drawerKey}
          onClose={() => navigate({ task: null })}
          onEdit={(task) => setDialog({ task })}
          onChanged={() => setReloadKey((value) => value + 1)}
          onNotify={setMessage}
        />
      )}

      {dialog && <TaskDialog task={dialog.task} options={options} onClose={() => setDialog(null)} onSaved={(saved) => afterSave(saved, dialog.task === null)} />}

      {importOpen && (
        <TasksImportDialog
          query={apiQuery}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false)
            setOptionsKey((value) => value + 1)
            setReloadKey((value) => value + 1)
          }}
          onNotify={setMessage}
        />
      )}

      <CashSnackbar message={message} onClose={() => setMessage(null)} />
    </RefPage>
  )
}
