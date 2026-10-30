import { NotificationsFeed } from "@/components/dashboard/notifications-feed"
import { getServerT } from "@/lib/i18n/server"

export default async function NotificationsPage() {
  const t = await getServerT()
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1320px]">
        <div className="mb-8 rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">{t("Уведомления")}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            {t("Просмотрите последние события, оповещения и системные уведомления.")}
          </p>
        </div>

        {/* The signed-in user's own notifications (GET /api/notifications). */}
        <NotificationsFeed />
      </div>
    </main>
  )
}
