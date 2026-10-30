"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { ROLE_LABELS, type AccountUser } from "@/components/dashboard/account-dropdown"
import { useLanguage } from "@/lib/i18n/language-context"

// The signed-in account (GET /api/auth/me): login, the person's name and role, and the branches it works with.
// The password is changed from the account menu ("Сменить пароль"); the rest is set by an administrator in
// Права доступа → Пользователи / Сотрудники.
type Me = AccountUser & { fullName?: string; branches?: Array<{ id: number; name: string }> }

type Field = { key: "username" | "name" | "role" | "branches"; label: string }

const fields: Field[] = [
  { key: "username", label: "Имя пользователя" },
  { key: "name", label: "Имя" },
  { key: "role", label: "Роль" },
  { key: "branches", label: "Филиалы" },
]

export default function SettingsProfilePage() {
  const { t } = useLanguage()
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Me>) : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        if (!cancelled) setMe(data)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = (key: Field["key"]): string => {
    if (!me) return failed ? "—" : t("Загрузка...")
    if (key === "username") return me.username
    if (key === "name") return me.fullName || me.displayName || t("Не указано")
    if (key === "role") return t(ROLE_LABELS[me.role] ?? me.role)
    const names = (me.branches ?? []).map((branch) => branch.name).filter(Boolean)
    return names.length ? names.join(", ") : t("Не указано")
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 rounded-3xl bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{t("Профиль")}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{t("Данные вашей учетной записи.")}</p>
            </div>
            <Link
              href="/settings"
              className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark"
            >
              {t("Назад к настройкам")}
            </Link>
          </div>
        </div>

        <section className="rounded-3xl bg-white p-8 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <p className="text-sm font-semibold text-slate-500">{t(field.label)}</p>
                <p className="mt-2 break-words text-lg font-medium text-slate-900">{value(field.key)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
