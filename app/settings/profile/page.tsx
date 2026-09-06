"use client"

import Link from "next/link"
import { useState } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

type Field = { key: "username" | "email" | "role" | "phone"; label: string; editable: boolean }

const fields: Field[] = [
  { key: "username", label: "Имя пользователя", editable: true },
  { key: "email", label: "Электронная почта", editable: true },
  { key: "role", label: "Роль", editable: false },
  { key: "phone", label: "Телефон", editable: true },
]

export default function SettingsProfilePage() {
  const { t } = useLanguage()
  const [values, setValues] = useState<Record<Field["key"], string>>({
    username: "admin",
    email: "admin@linko.local",
    role: "Администратор",
    phone: "+998 90 123 45 67",
  })
  const [editing, setEditing] = useState(false)

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 rounded-3xl bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">{t("Профиль")}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                {t("Обновите имя пользователя, контактные данные и параметры доступа.")}
              </p>
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
                {editing && field.editable ? (
                  <input
                    value={values[field.key]}
                    onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                    className="mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-lg font-medium text-slate-900 outline-none focus:border-brand-blue"
                  />
                ) : (
                  <p className="mt-2 text-lg font-medium text-slate-900">{t(values[field.key])}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">{t("Управление профилем")}</h2>
              <p className="mt-1 text-sm text-slate-600">{t("Настройки аккаунта и параметры входа.")}</p>
            </div>
            <button
              onClick={() => setEditing((value) => !value)}
              className="rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark"
            >
              {editing ? t("Сохранить") : t("Редактировать профиль")}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
