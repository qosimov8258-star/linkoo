import Link from "next/link"

export default function SettingsPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">Настройки</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Управляйте параметрами аккаунта, уведомлениями, структурой приложения и предпочтениями.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {[
            {
              title: "Профиль",
              description: "Измените информацию аккаунта, логин, права доступа и контакты.",
              href: "/settings/profile",
            },
            {
              title: "Уведомления",
              description: "Настройте уведомления по почте, в приложении и по SMS.",
              href: "/settings/notifications",
            },
            {
              title: "Интеграции",
              description: "Управляйте подключениями к внешним сервисам и API.",
              href: "/settings/integrations",
            },
          ].map((item) => (
            <Link
              key={item.title}
              href={item.href}
              className="group overflow-hidden rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-blue/30 hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-blue">
                    {item.title}
                  </p>
                  <h2 className="mt-3 text-2xl font-bold text-slate-900">{item.title}</h2>
                </div>
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-brand-blue/10 text-brand-blue">
                  {item.title.slice(0, 1)}
                </span>
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-600">{item.description}</p>
              <div className="mt-6 flex items-center justify-between text-sm font-semibold text-brand-blue">
                <span>Открыть</span>
                <span aria-hidden="true">→</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
