export default function NotificationsPage() {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">Уведомления</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Просмотрите последние события, оповещения и системные уведомления.
          </p>
        </div>

        <div className="space-y-4">
          {[
            {
              title: "Напоминание по заявке",
              detail: "Заявка №7942 требует проверки клиентом.",
              time: "2 минуты назад",
            },
            {
              title: "Новая задача от менеджера",
              detail: "Поставьте приоритет на объём заказов в регионе Юг.",
              time: "15 минут назад",
            },
            {
              title: "Отчёт готов",
              detail: "Отчёт по кассовой сверке за вчерашний день доступен.",
              time: "1 час назад",
            },
          ].map((item) => (
            <article key={item.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500">{item.time}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
