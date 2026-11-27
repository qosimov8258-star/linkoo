"use client"

import type { ReactNode } from "react"

import { formatClock, formatDateTime } from "@/components/bug-report/admin-ui"
import type { BugReportDetail } from "@/lib/bug-reports/types"
import { useLanguage } from "@/lib/i18n/language-context"

// The «Kontekst» block of a report: what the browser collected on its own (errors, failed requests, clicks,
// browser / OS / screen) and what the server added, readable first and then as the raw JSON. The stored
// context is whatever the browser sent (masked), so every field is read defensively.

type Loose = Record<string, unknown>

const asRecord = (value: unknown): Loose => (value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {})
const asRecords = (value: unknown): Loose[] => (Array.isArray(value) ? value.map(asRecord) : [])
const asText = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "")

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#5d6474]">
        {t(title)}
        {count !== undefined ? <span className="rounded-[10px] bg-[#eef1f5] px-[7px] text-[12px] font-semibold leading-[18px] text-[#5d6474]">{count}</span> : null}
      </h3>
      {children}
    </div>
  )
}

function Empty() {
  const { t } = useLanguage()
  return <p className="text-[#999]">{t("Нет записей")}</p>
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  const { t } = useLanguage()
  return (
    <dl className="grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-4 gap-y-[6px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[#5d6474]">{t(label)}</dt>
          <dd data-no-translate className="min-w-0 break-words">{value || <span className="text-[#999]">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

const MONO = "font-mono text-[12px] leading-[17px]"

export function BugContextBlock({ context }: { context: BugReportDetail["context"] }) {
  const { t } = useLanguage()
  const root = asRecord(context)
  const screen = asRecord(root.screen)
  const viewport = asRecord(root.viewport)
  const server = asRecord(root.server)
  const consoleErrors = asRecords(root.consoleErrors)
  const failedRequests = asRecords(root.failedRequests)
  const actions = asRecords(root.actions)
  const backendErrors = Array.isArray(server.backendErrors) ? server.backendErrors : []
  const size = (box: Loose) => (box.width !== undefined || box.height !== undefined ? `${asText(box.width)} × ${asText(box.height)}` : "")
  const ratio = asText(screen.pixelRatio)

  return (
    <details className="group bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <summary className="flex min-h-[46px] cursor-pointer list-none items-center justify-between gap-3 bg-[#5d6474] px-5 py-2 text-[14px] font-semibold text-white [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{t("Контекст")}</span>
          <span className="text-[12px] font-normal text-white/80">
            {t("Ошибки в консоли")}: {consoleErrors.length} · {t("Неудачные запросы")}: {failedRequests.length} · {t("Последние действия")}: {actions.length}
          </span>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6 shrink-0 fill-white transition-transform group-open:rotate-180">
          <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
        </svg>
      </summary>
      <div className="space-y-6 px-5 py-4">
        <Section title="Окружение">
          <Facts
            rows={[
              ["Время", formatDateTime(asText(root.time)) || asText(root.time)],
              ["Браузер", asText(root.browser)],
              ["Операционная система", asText(root.os)],
              ["Язык", asText(root.language)],
              ["Экран", size(screen) ? `${size(screen)}${ratio ? ` @${ratio}x` : ""}` : ""],
              ["Окно браузера", size(viewport)],
              ["User-Agent", asText(root.userAgent) ? <span key="ua" className={MONO}>{asText(root.userAgent)}</span> : ""],
            ]}
          />
        </Section>

        <Section title="Ошибки в консоли" count={consoleErrors.length}>
          {consoleErrors.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {consoleErrors.map((entry, index) => (
                <li key={index} data-no-translate className="rounded-[4px] border-l-[3px] border-[#e57373] bg-[#fdf3f3] px-3 py-2">
                  <span className="mr-2 text-[12px] text-[#999]">{formatClock(asText(entry.time))}</span>
                  <span className={`whitespace-pre-wrap break-words ${MONO}`}>{asText(entry.message)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Неудачные запросы" count={failedRequests.length}>
          {failedRequests.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {failedRequests.map((entry, index) => {
                const status = Number(entry.status)
                return (
                  <li key={index} data-no-translate className="rounded-[4px] border border-[#eceff3] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[12px] text-[#999]">{formatClock(asText(entry.time))}</span>
                      <span className={`rounded-[3px] px-[6px] text-[12px] font-bold leading-[18px] text-white ${status >= 500 || !status ? "bg-[#c62828]" : "bg-[#e08a00]"}`}>{status || "—"}</span>
                      <span className="text-[12px] font-bold">{asText(entry.method)}</span>
                      <span className={`min-w-0 break-all ${MONO}`}>{asText(entry.url)}</span>
                    </div>
                    {asText(entry.body) ? <pre className={`mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-[3px] bg-[#f7f9fb] p-2 ${MONO}`}>{asText(entry.body)}</pre> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section title="Последние действия" count={actions.length}>
          {actions.length === 0 ? (
            <Empty />
          ) : (
            <ol className="space-y-[6px]">
              {actions.map((entry, index) => (
                <li key={index} data-no-translate className="flex flex-wrap items-baseline gap-x-2 border-b border-dashed border-[#e6e9ee] pb-[6px] last:border-b-0">
                  <span className="text-[12px] text-[#999]">{formatClock(asText(entry.time))}</span>
                  <span className="rounded-[3px] bg-[#eef1f5] px-[6px] text-[12px] leading-[18px] text-[#5d6474]">{asText(entry.kind)}</span>
                  <span className="min-w-0 break-words font-semibold">{asText(entry.label)}</span>
                  {asText(entry.target) ? <span className={`min-w-0 break-all text-[#777] ${MONO}`}>{asText(entry.target)}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Сервер">
          <Facts
            rows={[
              ["Пользователь", [asText(server.username), server.userId !== undefined ? `#${asText(server.userId)}` : ""].filter(Boolean).join(" ")],
              ["Роль", asText(server.role)],
              ["Получено", formatDateTime(asText(server.receivedAt))],
            ]}
          />
          {backendErrors.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-[#5d6474]">{t("Ошибки сервера")}: {backendErrors.length}</p>
              <pre data-no-translate className={`max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-[3px] bg-[#f7f9fb] p-2 ${MONO}`}>{JSON.stringify(backendErrors, null, 2)}</pre>
            </div>
          ) : null}
        </Section>

        <Section title="Исходный JSON">
          <pre data-no-translate className={`max-h-[480px] overflow-auto whitespace-pre rounded-[3px] bg-[#1f2430] p-3 text-[#e6e6e6] ${MONO}`}>{JSON.stringify(context, null, 2)}</pre>
        </Section>
      </div>
    </details>
  )
}
