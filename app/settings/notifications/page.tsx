import Link from "next/link"

export default function SettingsNotificationsPage() {
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
            {[
              { label: "E-mail уведомления", value: "Включены" },
              { label: "Push-уведомления", value: "Отключены" },
              { label: "SMS уведомления", value: "Включены" },
            ].map((field) => (
              <div key={field.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
                <p className="text-sm font-semibold text-slate-500">{field.label}</p>
                <p className="mt-2 text-lg font-medium text-slate-900">{field.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Настройки уведомлений</h2>
              <p className="mt-1 text-sm text-slate-600">Выберите события, для которых приходят оповещения.</p>
            </div>
            <button className="rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark">
              Изменить настройки
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}
