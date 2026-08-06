import Link from "next/link"

export default function SettingsIntegrationsPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 rounded-3xl bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Интеграции</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Управляйте подключениями к внешним сервисам и API.
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
          <div className="space-y-6">
            {[
              { title: "CRM", status: "Подключено" },
              { title: "Telegram", status: "Отключено" },
              { title: "1C", status: "В ожидании" },
            ].map((integration) => (
              <div key={integration.title} className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{integration.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">Статус подключения: {integration.status}</p>
                  </div>
                  <button className="rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark">
                    Управлять
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
