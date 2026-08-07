"use client"

import Link from "next/link"
import { useState } from "react"

type Channel = { key: "email" | "push" | "sms"; label: string }

const channels: Channel[] = [
  { key: "email", label: "E-mail уведомления" },
  { key: "push", label: "Push-уведомления" },
  { key: "sms", label: "SMS уведомления" },
]

export default function SettingsNotificationsPage() {
  const [enabled, setEnabled] = useState<Record<Channel["key"], boolean>>({ email: true, push: false, sms: true })
  const [editing, setEditing] = useState(false)

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 rounded-3xl bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Уведомления</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Управляйте уведомлениями для приложений, почты и системы.
              </p>
            </div>
            <Link
              href="/settings"
              className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark"
            >
              Назад к настройкам
            </Link>
          </div>
        </div>

        <section className="rounded-3xl bg-white p-8 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-3">
            {channels.map((channel) => (
              <div key={channel.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <p className="text-sm font-semibold text-slate-500">{channel.label}</p>
                {editing ? (
                  <label className="mt-3 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled[channel.key]}
                      onChange={(event) => setEnabled((current) => ({ ...current, [channel.key]: event.target.checked }))}
                      className="h-5 w-5 accent-brand-blue"
                    />
                    <span className="text-sm text-slate-700">{enabled[channel.key] ? "Включены" : "Отключены"}</span>
                  </label>
                ) : (
                  <p className="mt-2 text-lg font-medium text-slate-900">{enabled[channel.key] ? "Включены" : "Отключены"}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Настройки уведомлений</h2>
              <p className="mt-1 text-sm text-slate-600">Выберите события, для которых приходят оповещения.</p>
            </div>
            <button
              onClick={() => setEditing((value) => !value)}
              className="rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark"
            >
              {editing ? "Сохранить" : "Изменить настройки"}
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
