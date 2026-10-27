"use client"

import { LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useEffect, useState } from "react"
import { formatDate } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"

type UserSession = {
  id: string
  ip: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  isCurrent: boolean
}

function describeDevice(userAgent: string, t: (text: string) => string): string {
  if (!userAgent) return t("Неизвестное устройство")
  const ua = userAgent.toLowerCase()
  const os = ua.includes("windows")
    ? "Windows"
    : ua.includes("mac os") || ua.includes("macintosh")
      ? "macOS"
      : ua.includes("android")
        ? "Android"
        : ua.includes("iphone") || ua.includes("ipad")
          ? "iOS"
          : ua.includes("linux")
            ? "Linux"
            : t("Неизвестная ОС")
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("chrome/")
      ? "Chrome"
      : ua.includes("firefox/")
        ? "Firefox"
        : ua.includes("safari/")
          ? "Safari"
          : t("Неизвестный браузер")
  return `${os} · ${browser}`
}

/** A session moment (UTC "YYYY-MM-DD HH:MM:SS" or ISO) in the browser's time, in the UI language. */
function formatMoment(value: string, language: LanguageCode) {
  if (!value) return "—"
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return value
  return formatDate(date, language, true)
}

export function SessionsView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetch("/api/user-sessions")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить сессии")
        return (await response.json()) as UserSession[]
      })
      .then(setSessions)
      .catch(() => window.alert(t("Не удалось загрузить активные сессии")))
      .finally(() => setLoading(false))
  }

  useEffect(load, [t])

  async function revoke(id: string) {
    setBusyId(id)
    try {
      const response = await fetch(`/api/user-sessions/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(t(data.error || "Не удалось завершить сессию"))
        return
      }
      if (id === sessions.find((s) => s.id === id)?.id && sessions.find((s) => s.id === id)?.isCurrent) {
        window.location.href = "/login"
        return
      }
      setSessions((list) => list.filter((session) => session.id !== id))
    } finally {
      setBusyId(null)
    }
  }

  async function revokeOthers() {
    setBusyId("others")
    try {
      const response = await fetch("/api/user-sessions/revoke-others", { method: "POST" })
      if (!response.ok) {
        window.alert(t("Не удалось завершить остальные сессии"))
        return
      }
      setSessions((list) => list.filter((session) => session.isCurrent))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> {t("Сессия")}
          </h1>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <p className="text-sm text-slate-500">{t("Активные входы в аккаунт на разных устройствах и браузерах.")}</p>
          <button
            type="button"
            onClick={revokeOthers}
            disabled={busyId === "others" || sessions.length <= 1}
            className="inline-flex items-center gap-2 rounded border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <LogOut className="h-4 w-4" />
            {t("Завершить остальные сессии")}
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-4 text-[13px]">{t("Устройство")}</th>
              <th className="px-5 py-4 text-[13px]">{t("IP-адрес")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Начало")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Последняя активность")}</th>
              <th className="w-40" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">
                  <div className="flex items-center gap-2 text-slate-700">
                    <MonitorSmartphone className="h-5 w-5 text-slate-400" />
                    {describeDevice(session.userAgent, t)}
                    {session.isCurrent && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-600">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {t("Это устройство")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-4 text-slate-600">{session.ip || "—"}</td>
                <td className="px-5 py-4 text-slate-600">{formatMoment(session.createdAt, language)}</td>
                <td className="px-5 py-4 text-slate-600">{formatMoment(session.lastSeenAt, language)}</td>
                <td className="px-5 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => revoke(session.id)}
                    disabled={busyId === session.id}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:underline disabled:opacity-40"
                  >
                    <LogOut className="h-4 w-4" />
                    {session.isCurrent ? t("Выйти") : t("Завершить")}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  {t("Активных сессий не найдено")}
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  {t("Загрузка...")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}
