"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { SurveyForm, emptyQuestion, emptySurveyDraft, type SurveyDraft } from "@/components/analytics/survey-form"
import { KitRangeField } from "@/components/orders/field-filter-kit"
import { RefAppliedFilter, RefFilterPanel, RefHeader, RefPage, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { SplitDetailList } from "@/components/ref/split-detail"
import { askDelete } from "@/lib/ask-confirm"
import { downloadExcelTable } from "@/lib/excel-export"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// «Опросник» (Продажи → Маркетинг), the reference's #/questionnaire/:
//   * its state lives in the link with the reference's names: isActive (the tab: true / false / "" = Все), search, page,
//     pageSize, fromDate / toDate («Период создания»), openFilterDialog and id (the open card), so a reload, Back and a
//     shared link keep it;
//   * the filter is the reference's small «Фильтр» card; once applied it turns into «Фильтр: N элемента» (✎ / ⊗). The
//     reference writes the period into the link but never sends it to its list request (the list stays unfiltered);
//     here the period does filter the list by the creation day;
//   * the card of a survey: «Скачать» (a period dialog), «Изменить», «Дублировать» and «Удалить» (with its confirmation).

type Survey = {
  id: number
  name: string
  createdAt: string
  createdOn?: string
  active: boolean
  organization: string
  /** null = saved before surveys were linked by id. */
  organizationId?: number | null
  storeType: string
  clientTypeId?: number | null
  comment: string
  orderNo?: string
  flags?: SurveyDraft["flags"]
  questions?: Array<Partial<SurveyDraft["questions"][number]>>
}

type ActiveTab = "" | "true" | "false"

type PageState = {
  isActive: ActiveTab
  search: string
  page: number
  pageSize: number
  fromDate: string
  toDate: string
  openFilterDialog: boolean
  id: number
}

const PAGE_SIZE = 25
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const STATE_KEYS = ["isActive", "search", "page", "pageSize", "fromDate", "toDate", "openFilterDialog", "id"]

const positive = (value: string | null) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function readState(search: string): PageState {
  const params = new URLSearchParams(search)
  const active = params.get("isActive")
  const fromDate = params.get("fromDate") ?? ""
  const toDate = params.get("toDate") ?? ""
  return {
    isActive: active === "true" || active === "false" ? active : "",
    search: (params.get("search") ?? "").trim(),
    page: positive(params.get("page")) || 1,
    pageSize: positive(params.get("pageSize")) || PAGE_SIZE,
    fromDate: ISO_DAY.test(fromDate) ? fromDate : "",
    toDate: ISO_DAY.test(toDate) ? toDate : "",
    openFilterDialog: params.get("openFilterDialog") === "true",
    id: positive(params.get("id")),
  }
}

/** The page state → the link's query; keys of other features (e.g. a dialog of the layout) stay as they are. */
function stateQuery(state: PageState, current: string): string {
  const params = new URLSearchParams(current)
  for (const key of STATE_KEYS) params.delete(key)
  if (state.isActive) params.set("isActive", state.isActive)
  if (state.search) params.set("search", state.search)
  if (state.page > 1) params.set("page", String(state.page))
  if (state.pageSize !== PAGE_SIZE) params.set("pageSize", String(state.pageSize))
  if (state.fromDate) params.set("fromDate", state.fromDate)
  if (state.toDate) params.set("toDate", state.toDate)
  if (state.openFilterDialog) params.set("openFilterDialog", "true")
  if (state.id) params.set("id", String(state.id))
  return params.toString()
}

// "Организация" = the factory's organizations (/api/organizations, optional), "Тип клиента" = its
// client types (/api/client-types; "Не указано" = none). Nothing is pre-selected; the form works with
// their names and save() sends the ids (the API checks both).
type Named = { id: number; name: string }
const NO_CLIENT_TYPE = "Не указано"

async function loadNamed(url: string): Promise<Named[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    const rows = (await response.json()) as unknown
    return Array.isArray(rows)
      ? rows
          .map((row) => ({ id: Number((row as Named).id), name: String((row as Named).name ?? "") }))
          .filter((row) => row.id > 0 && row.name)
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      : []
  } catch {
    return []
  }
}

const ICON = {
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
  delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  add: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
}

/** A labelled action of the card header (the reference's flat buttons: 18px icon, semibold label). */
function CardAction({ icon, label, color = "#666", onClick }: { icon: string; label: string; color?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-[5px] flex h-[30px] items-center rounded-[2px] pl-[12px] pr-[16px] text-[13px] font-semibold hover:bg-black/[0.06]" style={{ color }}>
      <svg viewBox="0 0 24 24" className="mb-[2px] h-[18px] w-[18px]" style={{ fill: color }} aria-hidden>
        <path d={icon} />
      </svg>
      <span className="pl-[8px]">{label}</span>
    </button>
  )
}

/** The reference's «Скачать акт сверки» dialog of a survey: «Выберите период» and «Скачать». */
function DownloadDialog({ survey, onClose }: { survey: Survey; onClose: () => void }) {
  const { t, language } = useLanguage()
  const [period, setPeriod] = useState({ from: "", to: "" })

  function download() {
    const questions = survey.questions ?? []
    downloadExcelTable(`${t("Опросник")} №${survey.id}${period.from ? ` ${period.from} - ${period.to || period.from}` : ""}`, [
      ["№", t("Название"), t("Дата создания"), t("Статус"), t("Организация"), t("Тип магазина"), t("Комментарий")],
      [survey.id, survey.name, formatDateText(survey.createdAt, language), survey.active ? t("Активный") : t("Отключен"), survey.organization || t(NO_CLIENT_TYPE), survey.storeType || t(NO_CLIENT_TYPE), survey.comment],
      [],
      ["№", t("Вопрос"), t("Тип"), t("Ответы")],
      ...questions.map((question, index) => [index + 1, question.text ?? "", t(question.type || NO_CLIENT_TYPE), (question.answers ?? []).filter(Boolean).join(", ")]),
    ])
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/[0.54]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("Скачать акт сверки")} onClick={(event) => event.stopPropagation()} className="w-[400px] max-w-full bg-white text-[13px] text-black shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[15px]">
          <h3 className="text-[13px] font-bold uppercase text-[#333]">{t("Скачать акт сверки")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333] hover:opacity-70">
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </header>
        <div className="px-[30px] pb-[10px] pt-[20px]">
          <KitRangeField label="Выберите период" begin={period.from} end={period.to} onChange={(from, to) => setPeriod({ from, to })} clearable={false} />
        </div>
        <footer className="flex h-[57px] items-center justify-end pr-[30px]">
          <button type="button" onClick={download} className="h-[36px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8]">
            {t("Скачать")}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function QuestionnaireView() {
  const { t, language } = useLanguage()
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [organizations, setOrganizations] = useState<Named[]>([])
  const [clientTypes, setClientTypes] = useState<Named[]>([])
  // The page state is the link's (read after mount: the server render has no window).
  const [state, setState] = useState<PageState | null>(null)
  const [searchText, setSearchText] = useState("")
  const [period, setPeriod] = useState({ from: "", to: "" })
  const [editing, setEditing] = useState<{ mode: "new" | "edit" | "duplicate"; id: number } | null>(null)
  const [draft, setDraft] = useState<SurveyDraft>(emptySurveyDraft)
  const [downloading, setDownloading] = useState<Survey | null>(null)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([loadNamed("/api/organizations"), loadNamed("/api/client-types")]).then(([organizationRows, typeRows]) => {
      if (cancelled) return
      setOrganizations(organizationRows)
      setClientTypes(typeRows)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/surveys")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Survey[]
      })
      .then((data) => {
        if (!cancelled) setSurveys(data)
      })
      .catch(() => {
        if (!cancelled) notify(t("Не удалось загрузить опросники с сервера"))
      })
    return () => {
      cancelled = true
    }
  }, [t])

  // Link → state on mount and on Back / Forward.
  useEffect(() => {
    const sync = () => {
      const next = readState(window.location.search)
      setState(next)
      setSearchText(next.search)
    }
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  /** A new state, written into the link as a new history entry (typing in «Поиск» replaces the current one). */
  const navigate = useCallback((next: PageState, replace = false) => {
    setState(next)
    setSearchText(next.search)
    const query = stateQuery(next, window.location.search)
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    if (replace) window.history.replaceState(window.history.state, "", url)
    else window.history.pushState(window.history.state, "", url)
  }, [])

  const filtered = useMemo(() => {
    if (!state) return []
    const needle = state.search.toLowerCase()
    const until = state.toDate || state.fromDate
    return surveys
      .filter((survey) => (state.isActive === "true" ? survey.active : state.isActive === "false" ? !survey.active : true))
      .filter((survey) => !state.fromDate || ((survey.createdOn ?? "") >= state.fromDate && (survey.createdOn ?? "") <= until))
      .filter((survey) => survey.name.toLowerCase().includes(needle))
  }, [surveys, state])

  const closeNotice = useCallback(() => setNotice(null), [])

  if (!state) return <RefPage><RefHeader title="Опросник" /></RefPage>
  const current = state

  const pageCount = Math.max(1, Math.ceil(filtered.length / current.pageSize))
  const page = Math.min(current.page, pageCount)
  const start = (page - 1) * current.pageSize
  const end = Math.min(start + current.pageSize, filtered.length)
  const filterCount = current.toDate ? 1 : 0

  function openCreate() {
    setDraft(emptySurveyDraft())
    setEditing({ mode: "new", id: 0 })
  }

  function surveyDraft(survey: Survey): SurveyDraft {
    // An older survey without ids is matched by name (an unknown name has to be chosen again).
    const organization = organizations.find((item) => item.id === survey.organizationId) ?? organizations.find((item) => item.name === survey.organization)
    const clientType = clientTypes.find((item) => item.id === survey.clientTypeId) ?? clientTypes.find((item) => item.name === survey.storeType)
    const base = emptySurveyDraft()
    return {
      ...base,
      name: survey.name,
      orderNo: survey.orderNo ?? "",
      organization: organization?.name ?? "",
      storeType: clientType?.name ?? "",
      active: survey.active,
      comment: survey.comment,
      flags: { ...base.flags, ...(survey.flags ?? {}) },
      questions: survey.questions?.length
        ? survey.questions.map((question) => {
            const merged = { ...emptyQuestion(), ...question }
            return { ...merged, answers: merged.answers.length ? merged.answers : [""], balls: merged.answers.map((_, index) => merged.balls[index] ?? "") }
          })
        : base.questions,
    }
  }

  function openEdit(survey: Survey, mode: "edit" | "duplicate") {
    setDraft(surveyDraft(survey))
    setEditing({ mode, id: survey.id })
  }

  async function remove(survey: Survey) {
    if (!(await askDelete())) return
    try {
      const response = await fetch(`/api/surveys/${survey.id}`, { method: "DELETE" })
      if (!response.ok) {
        setNotice({ text: "Удаление невозможно из-за связи с другими данными", tone: "error" })
        return
      }
      setSurveys((list) => list.filter((item) => item.id !== survey.id))
      navigate({ ...current, id: 0 })
      setNotice({ text: "Успешно удалено", tone: "success" })
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function save() {
    if (!editing || !draft.name.trim()) return
    // The form picks names; the survey is linked by id to the factory's own organization / client type (both optional,
    // as in the reference).
    const organization = organizations.find((item) => item.name === draft.organization) ?? null
    const clientType = clientTypes.find((item) => item.name === draft.storeType) ?? null
    const payload = {
      name: draft.name.trim(),
      active: draft.active,
      organizationId: organization ? organization.id : null,
      organization: organization ? organization.name : "",
      clientTypeId: clientType ? clientType.id : null,
      storeType: clientType ? clientType.name : "",
      comment: draft.comment,
      orderNo: draft.orderNo,
      flags: draft.flags,
      questions: draft.questions,
    }
    const creating = editing.mode !== "edit"
    try {
      const response = await fetch(creating ? "/api/surveys" : `/api/surveys/${editing.id}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(data.error || (creating ? "Не удалось создать опросник" : "Не удалось сохранить опросник")))
        return
      }
      const saved = (await response.json()) as Survey
      setSurveys((list) => (creating ? [saved, ...list] : list.map((survey) => (survey.id === saved.id ? saved : survey))))
      setEditing(null)
      setNotice({ text: creating ? "Успешно сохранено" : "Успешно изменено", tone: "success" })
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function openFilter() {
    // The reference's card opens with the applied period, else the current month.
    const today = todayIso()
    setPeriod(current.fromDate ? { from: current.fromDate, to: current.toDate || current.fromDate } : { from: monthStartIso(today), to: monthEndIso(today) })
    navigate({ ...current, openFilterDialog: true })
  }

  function applyFilter() {
    navigate({ ...current, fromDate: period.from, toDate: period.from ? period.to || period.from : "", openFilterDialog: false, page: 1 })
  }

  const tabs: { key: ActiveTab; label: string }[] = [
    { key: "true", label: "Активные" },
    { key: "false", label: "Не активные" },
    { key: "", label: "Все" },
  ]
  const formTitle = !editing ? "" : editing.mode === "edit" ? `${t("Изменение")} № ${editing.id}` : editing.mode === "duplicate" ? t("Дублирование") : t("Добавление")

  return (
    <RefPage>
      <RefHeader title="Опросник">
        <button type="button" onClick={openCreate} className="flex h-[30px] w-[118px] items-center justify-center gap-2 rounded-[5px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current"><path d={ICON.add} /></svg>
          {t("Добавить")}
        </button>
      </RefHeader>

      <SplitDetailList
        rows={filtered.slice(start, end)}
        selectedKey={current.id || null}
        rowKey={(survey) => survey.id}
        toolbar={
          <>
            <RefTabs labels={tabs.map((item) => item.label)} value={tabs.find((item) => item.key === current.isActive)?.label ?? "Все"} onChange={(label) => navigate({ ...current, isActive: tabs.find((item) => item.label === label)?.key ?? "", page: 1 })} />
            <RefToolbar
              // The reference's search field starts at 430 px (its filter column is wider than the default).
              filterWidth={379}
              filterOpen={current.openFilterDialog}
              onToggleFilter={openFilter}
              leftSlot={filterCount > 0 && !current.openFilterDialog ? <RefAppliedFilter count={filterCount} width={370} shift={28} onEdit={openFilter} onClear={() => navigate({ ...current, fromDate: "", toDate: "", page: 1 })} /> : undefined}
              filterPanel={
                <RefFilterPanel narrow onClose={() => navigate({ ...current, openFilterDialog: false })} onApply={applyFilter}>
                  <KitRangeField label="Период создания" begin={period.from} end={period.to} onChange={(from, to) => setPeriod({ from, to })} />
                </RefFilterPanel>
              }
              query={searchText}
              onQuery={(value) => {
                navigate({ ...current, search: value.trim(), page: 1 }, true)
                setSearchText(value)
              }}
              pageSize={current.pageSize}
              onPageSize={(size) => navigate({ ...current, pageSize: size, page: 1 })}
              from={filtered.length ? start + 1 : 0}
              to={end}
              total={filtered.length}
              page={page}
              pageCount={pageCount}
              onPage={(next) => navigate({ ...current, page: next })}
            />
          </>
        }
        tableProps={{
          cols: "minmax(0,1fr) minmax(0,5fr) minmax(0,3fr) minmax(0,2fr)",
          heads: [t("№"), t("Название"), t("Дата создания"), t("Статус")],
          rowKey: (survey: Survey) => survey.id,
          onRowClick: (survey: Survey) => navigate({ ...current, id: current.id === survey.id ? 0 : survey.id }),
          empty: t("Ничего не найдено"),
          render: (survey: Survey) => [survey.id, survey.name, formatDateText(survey.createdAt, language), t(survey.active ? "Активный" : "Отключен")],
        }}
        detail={(survey) => (
          <>
            <div className="relative flex h-[65px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
              {/* A click on the header closes the card, as in the reference. */}
              <button type="button" aria-label={t("Закрыть")} onClick={() => navigate({ ...current, id: 0 })} className="absolute inset-0 z-0 cursor-pointer" />
              <h2 className="relative z-[1] text-[18px] font-semibold text-[#333]">
                № {survey.id} - {survey.name}
              </h2>
              <div className="relative z-[1] flex items-center">
                <CardAction icon={ICON.download} label={t("Скачать")} onClick={() => setDownloading(survey)} />
                <CardAction icon={ICON.edit} label={t("Изменить")} onClick={() => openEdit(survey, "edit")} />
                <CardAction icon={ICON.copy} label={t("Дублировать")} onClick={() => openEdit(survey, "duplicate")} />
                <CardAction icon={ICON.delete} label={t("Удалить")} color="#e57373" onClick={() => void remove(survey)} />
              </div>
            </div>
            <div className="w-[320px] px-[30px] pb-[20px] pt-[16px] text-[13px] leading-[25px] text-[#333]">
              <p>{t("Дата создания")} <b className="float-right font-semibold">{formatDateText(survey.createdAt, language)}</b></p>
              <p>{t("Организация")} <b className="float-right font-semibold">{survey.organization || t(NO_CLIENT_TYPE)}</b></p>
              <p>{t("Тип магазина")} <b className="float-right font-semibold">{survey.storeType || t(NO_CLIENT_TYPE)}</b></p>
              <div className="-mx-[30px] mt-[15px] border-t border-[#e7ebf0] px-[30px] pt-[16px] leading-[20px]">
                <p className="mb-[5px] font-semibold">{t("Комментарий")}:</p>
                <p>{survey.comment || t("Комментарий отсутствует")}</p>
              </div>
            </div>
          </>
        )}
      />

      {/* "Не указано" is the first client type: picking it unlinks the client type (save() sends null). */}
      {editing !== null && (
        <SurveyForm
          title={formTitle}
          draft={draft}
          organizations={organizations.map((item) => item.name)}
          clientTypes={[t(NO_CLIENT_TYPE), ...clientTypes.map((item) => item.name)]}
          onChange={setDraft}
          onSave={() => void save()}
          onClose={() => setEditing(null)}
        />
      )}

      {downloading && <DownloadDialog survey={downloading} onClose={() => setDownloading(null)} />}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </RefPage>
  )
}
