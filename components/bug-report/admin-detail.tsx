"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import { BugContextBlock } from "@/components/bug-report/admin-context"
import {
  AdminCard,
  DELIVERY_LABELS,
  ResolvedByAiBadge,
  STATUS_LABELS,
  SeverityBadge,
  apiError,
  formatDateTime,
  safeHttpUrl,
} from "@/components/bug-report/admin-ui"
import { RefHeader, RefLoader, RefPage, RI } from "@/components/ref/list-kit"
import { BUG_REPORT_STATUSES, type BugAnalysis, type BugReportDetail, type BugReportStatus } from "@/lib/bug-reports/types"
import { useLanguage } from "@/lib/i18n/language-context"

/** «Qayta tahlil qilish» polls the report this often while the analysis runs, and gives up after POLL_LIMIT_MS
 * (one analysis is at most 2 × 30 s plus the retries' waits; anything longer is reported, not waited for). */
const POLL_EVERY_MS = 5_000
const POLL_LIMIT_MS = 3 * 60_000

/** The analysis' fields in the order the developer reads them (labels are Russian keys of the Uzbek names). */
const ANALYSIS_FIELDS: Array<{ key: keyof BugAnalysis; label: string }> = [
  { key: "qisqa", label: "Кратко" },
  { key: "skrinshotda_korinadi", label: "Видно на скриншоте" },
  { key: "mijoz_nima_demoqchi", label: "Что хочет сказать клиент" },
  { key: "qayerda", label: "Где именно" },
  { key: "texnik_sabab", label: "Техническая причина" },
  { key: "yechim", label: "Решение проблемы" },
  { key: "turi", label: "Тип проблемы" },
  { key: "jiddiylik", label: "Серьёзность" },
  { key: "ishonch", label: "Уверенность" },
  { key: "dalillar", label: "Доказательства" },
]

type LoadState = { kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ready" }

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="border-b border-dashed border-[#e6e9ee] py-[9px] last:border-b-0">
      <dt className="mb-[3px] text-[12px] font-bold uppercase tracking-[0.02em] text-[#5d6474]">{t(label)}</dt>
      <dd data-no-translate className="min-w-0 whitespace-pre-wrap break-words text-[13px] leading-[19px]">{children}</dd>
    </div>
  )
}

function Notice({ tone, children }: { tone: "info" | "warn" | "error" | "muted"; children: ReactNode }) {
  const colors = {
    info: "border-[#b9cbef] bg-[#eef3fd] text-[#1E4A9A]",
    warn: "border-[#f1d36b] bg-[#fff8db] text-[#7a5a00]",
    error: "border-[#f2b8b5] bg-[#fdecea] text-[#b3261e]",
    muted: "border-[#e0e0e0] bg-[#f5f6f8] text-[#666]",
  }[tone]
  return <div className={`mb-3 rounded-[5px] border px-3 py-[10px] ${colors}`}>{children}</div>
}

function AnalysisValue({ analysis, field }: { analysis: BugAnalysis; field: keyof BugAnalysis }) {
  const value = analysis[field]
  if (field === "jiddiylik") return <SeverityBadge value={analysis.jiddiylik} />
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[#999]">—</span>
    return (
      <ul className="list-disc space-y-[3px] pl-5">
        {value.map((item, index) => (
          <li key={index}>{String(item)}</li>
        ))}
      </ul>
    )
  }
  return value ? <>{String(value)}</> : <span className="text-[#999]">—</span>
}

/** Full-screen view of the screenshot: a click anywhere or Escape closes it. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    // The page behind must not scroll while the picture covers it.
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={t("Скриншот")} onClick={onClose} className="fixed inset-0 z-[1500] flex cursor-zoom-out items-center justify-center bg-black/85 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={t("Скриншот")} className="max-h-full max-w-full object-contain shadow-[0_6px_30px_rgba(0,0,0,0.5)]" />
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25">
        <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6 fill-white"><path d={RI.close} /></svg>
      </button>
    </div>
  )
}

/** One report of «Xato xabarlari» (admin): what the customer wrote next to what the AI made of it, the context
 * below, the status buttons on top. */
export function BugReportAdminDetail({ id }: { id: number }) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<BugReportDetail | null>(null)
  const [state, setState] = useState<LoadState>({ kind: "loading" })
  const [busy, setBusy] = useState<"" | "status" | "reanalyze">("")
  const [actionError, setActionError] = useState("")
  const [notice, setNotice] = useState("")
  /** Poll until this moment (ms) while the analysis is PENDING; null = not polling. */
  const [pollUntil, setPollUntil] = useState<number | null>(null)
  const [zoom, setZoom] = useState(false)
  const closeZoom = useCallback(() => setZoom(false), [])

  const fetchDetail = useCallback(async (): Promise<BugReportDetail | null> => {
    const response = await fetch(`/api/admin/bug-reports/${id}`, { cache: "no-store" })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(await apiError(response, "Не удалось загрузить данные"))
    return (await response.json()) as BugReportDetail
  }, [id])

  // The first load. A report whose analysis is running in the background (delivered, still PENDING) is
  // followed the same way as after «Qayta tahlil qilish».
  useEffect(() => {
    let cancelled = false
    fetchDetail()
      .then((loaded) => {
        if (cancelled) return
        if (!loaded) return setState({ kind: "missing" })
        setDetail(loaded)
        setState({ kind: "ready" })
        if (loaded.aiStatus === "PENDING" && loaded.delivery === "delivered") setPollUntil(Date.now() + POLL_LIMIT_MS)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setState({ kind: "error", message: reason instanceof Error ? reason.message : "Не удалось загрузить данные" })
      })
    return () => {
      cancelled = true
    }
  }, [fetchDetail])

  // Polling: every 5 s while the analysis is PENDING, at most 3 minutes; a failed poll just waits for the next one.
  useEffect(() => {
    if (pollUntil === null || !detail) return
    if (detail.aiStatus !== "PENDING") {
      setPollUntil(null)
      return
    }
    if (Date.now() >= pollUntil) {
      setPollUntil(null)
      setNotice("Анализ ещё не готов, обновите страницу позже")
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      fetchDetail()
        .then((loaded) => {
          if (cancelled) return
          // Each answer is a new object, which re-arms this effect for the next poll; a report removed
          // meanwhile ends the polling.
          if (loaded) setDetail(loaded)
          else setPollUntil(null)
        })
        .catch(() => {
          // A failed poll (network, server restart) changes nothing: a copy of the detail re-arms the next one.
          if (!cancelled) setDetail((current) => (current ? { ...current } : current))
        })
    }, POLL_EVERY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [detail, pollUntil, fetchDetail])

  async function changeStatus(next: BugReportStatus) {
    if (!detail || next === detail.status || busy) return
    setBusy("status")
    setActionError("")
    try {
      const response = await fetch(`/api/admin/bug-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!response.ok) throw new Error(await apiError(response, "Не удалось изменить статус"))
      setDetail((await response.json()) as BugReportDetail)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Не удалось изменить статус")
    } finally {
      setBusy("")
    }
  }

  async function reanalyze() {
    if (!detail || busy) return
    setBusy("reanalyze")
    setActionError("")
    setNotice("")
    try {
      const response = await fetch(`/api/admin/bug-reports/${id}/reanalyze`, { method: "POST" })
      if (!response.ok) throw new Error(await apiError(response, "Не удалось запустить анализ"))
      // The analysis runs in the background: show it as running at once, the polling brings the result.
      setDetail((current) => (current ? { ...current, aiStatus: "PENDING", aiError: null } : current))
      setPollUntil(Date.now() + POLL_LIMIT_MS)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Не удалось запустить анализ")
    } finally {
      setBusy("")
    }
  }

  const backLink = (
    <Link href="/admin/bug-reports" className="flex h-[30px] items-center gap-1 whitespace-nowrap rounded-[5px] border border-[#1E4A9A] bg-white pl-2 pr-4 text-[13px] font-semibold text-[#1E4A9A] hover:bg-[#e8efff]">
      <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px] fill-[#1E4A9A]"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
      {t("Назад к списку")}
    </Link>
  )

  return (
    <RefPage>
      <RefHeader title="Сообщение об ошибке" left={<span className="ml-2 text-[18px] font-bold text-[#5d6474]">#{id}</span>}>
        {backLink}
      </RefHeader>

      {state.kind === "loading" ? (
        <div className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"><RefLoader /></div>
      ) : state.kind === "missing" ? (
        <div className="bg-white px-5 py-16 text-center text-[#666] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">{t("Сообщение не найдено")}</div>
      ) : state.kind === "error" || !detail ? (
        <div className="bg-white px-5 py-16 text-center text-[#c62828] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">{t(state.kind === "error" ? state.message : "Не удалось загрузить данные")}</div>
      ) : (
        <DetailBody
          detail={detail}
          busy={busy}
          actionError={actionError}
          notice={notice}
          polling={pollUntil !== null}
          onStatus={changeStatus}
          onReanalyze={reanalyze}
          onZoom={() => setZoom(true)}
        />
      )}

      {zoom && detail?.screenshotUrl ? <Lightbox src={detail.screenshotUrl} onClose={closeZoom} /> : null}
    </RefPage>
  )
}

function DetailBody({
  detail,
  busy,
  actionError,
  notice,
  polling,
  onStatus,
  onReanalyze,
  onZoom,
}: {
  detail: BugReportDetail
  busy: "" | "status" | "reanalyze"
  actionError: string
  notice: string
  polling: boolean
  onStatus: (status: BugReportStatus) => void
  onReanalyze: () => void
  onZoom: () => void
}) {
  const { t } = useLanguage()
  const pageHref = safeHttpUrl(detail.pageUrl)
  const analysis = detail.aiAnalysis
  const helper = detail.helperResult
  // The analysis only starts once the report is delivered (or the admin asked for it); before that it waits.
  const running = detail.aiStatus === "PENDING" && (detail.delivery === "delivered" || polling)

  return (
    <>
      <section className="flex flex-wrap items-center gap-x-5 gap-y-3 bg-white px-5 py-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <span className="font-semibold text-[#5d6474]">{t("Статус")}</span>
        <div className="flex flex-wrap gap-2">
          {BUG_REPORT_STATUSES.map((value) => {
            const current = detail.status === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={current}
                disabled={busy !== "" && !current}
                onClick={() => onStatus(value)}
                className={`h-[30px] rounded-[5px] px-4 text-[13px] font-semibold disabled:opacity-60 ${current ? "cursor-default bg-[#1E4A9A] text-white" : "border border-[#cfd6e2] bg-white text-[#333] hover:bg-[#f2f5f8]"}`}
              >
                {t(STATUS_LABELS[value])}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[12px] text-[#5d6474]">
          {detail.resolvedByAi ? <ResolvedByAiBadge /> : <span className="rounded-[10px] bg-[#eef1f5] px-[8px] py-[2px] font-semibold">{t(DELIVERY_LABELS[detail.delivery] ?? detail.delivery)}</span>}
        </div>
        {actionError ? <p className="w-full text-[#c62828]">{t(actionError)}</p> : null}
      </section>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <AdminCard title="Что написал клиент">
          <div data-no-translate className="whitespace-pre-wrap break-words rounded-[5px] border border-[#eceff3] bg-[#f7f9fb] px-3 py-[10px] text-[14px] leading-[20px] text-[#222]">
            {detail.comment}
          </div>

          {detail.screenshotUrl ? (
            <button type="button" onClick={onZoom} title={t("Нажмите, чтобы увеличить")} className="mt-4 block w-full cursor-zoom-in overflow-hidden rounded-[5px] border border-[#e0e4ea] bg-[#f2f5f8]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={detail.screenshotUrl} alt={t("Скриншот")} className="mx-auto max-h-[460px] w-auto max-w-full object-contain" />
            </button>
          ) : (
            <div className="mt-4 rounded-[5px] border border-dashed border-[#cfd6e2] px-3 py-6 text-center text-[#999]">{t("Скриншота нет")}</div>
          )}

          <dl className="mt-4 grid grid-cols-[minmax(100px,max-content)_minmax(0,1fr)] gap-x-4 gap-y-[6px]">
            <dt className="text-[#5d6474]">{t("Страница")}</dt>
            <dd data-no-translate className="min-w-0 break-all">
              {pageHref ? (
                <a href={pageHref} target="_blank" rel="noopener noreferrer" className="text-[#1E4A9A] hover:underline">{detail.pageUrl}</a>
              ) : (
                detail.pageUrl || "—"
              )}
            </dd>
            <dt className="text-[#5d6474]">{t("Время")}</dt>
            <dd>{formatDateTime(detail.createdAt)}</dd>
            <dt className="text-[#5d6474]">{t("Пользователь")}</dt>
            <dd data-no-translate className="min-w-0 break-words">{detail.userName || "—"} <span className="text-[#999]">#{detail.userId}</span></dd>
          </dl>
        </AdminCard>

        <AdminCard
          title="Анализ ИИ"
          aside={
            <button
              type="button"
              onClick={onReanalyze}
              disabled={busy !== ""}
              className="flex h-[30px] shrink-0 items-center gap-[6px] rounded-[5px] border border-white/70 pl-2 pr-3 text-[13px] font-semibold text-white hover:bg-white/10 disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" aria-hidden className={`h-[18px] w-[18px] fill-white ${busy === "reanalyze" || running ? "animate-spin" : ""}`}><path d={RI.autorenew} /></svg>
              {t("Повторить анализ")}
            </button>
          }
        >
          {detail.resolvedByAi ? (
            <div className="mb-3">
              <ResolvedByAiBadge />
            </div>
          ) : null}
          {notice ? <Notice tone="muted">{t(notice)}</Notice> : null}

          {running ? <Notice tone="info">{t("Анализ выполняется…")}</Notice> : null}
          {/* Not delivered yet: the helper still waits for the customer's feedback or answer. */}
          {detail.aiStatus === "PENDING" && !running && (detail.delivery === "awaiting_feedback" || detail.delivery === "awaiting_answer") ? (
            <Notice tone="muted">{t(DELIVERY_LABELS[detail.delivery])}</Notice>
          ) : null}

          {detail.aiStatus === "FAILED" ? (
            <Notice tone="error">
              <p className="font-bold">{t("ИИ не смог проанализировать")}</p>
              {detail.aiError ? <p data-no-translate className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-[17px]">{detail.aiError}</p> : null}
            </Notice>
          ) : null}

          {analysis ? (
            <div className={detail.aiStatus === "PENDING" ? "opacity-60" : ""}>
              {analysis.ishonch === "taxmin" ? <Notice tone="warn"><span className="font-semibold">{t("Предположение, проверьте")}</span></Notice> : null}
              <dl>
                {ANALYSIS_FIELDS.map(({ key, label }) => (
                  <Field key={key} label={label}>
                    <AnalysisValue analysis={analysis} field={key} />
                  </Field>
                ))}
              </dl>
            </div>
          ) : null}

          {helper ? (
            <div className="mt-4 rounded-[5px] border border-[#eceff3] bg-[#fafbfc] px-3 pt-1">
              <p className="pt-2 text-[13px] font-bold text-[#5d6474]">{t("Ответ помощника")}</p>
              <dl>
                <Field label="Состояние">{helper.holat || "—"}</Field>
                <Field label="Ответ клиенту">{helper.mijozga_javob || "—"}</Field>
                {helper.savol ? <Field label="Вопрос">{helper.savol}</Field> : null}
              </dl>
            </div>
          ) : null}
        </AdminCard>
      </div>

      <div className="mt-5">
        <BugContextBlock context={detail.context} />
      </div>
    </>
  )
}
