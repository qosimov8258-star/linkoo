import { analyticsReports } from "@/lib/analytics-catalog"

// Browser-tab titles (Russian i18n keys) of pages that have no metadata of
// their own; app/layout.tsx translates them into the UI language on the
// server, so the first paint already has the right title.
const ROUTE_TITLES: Record<string, string> = {
  "/login": "Войти в систему",
  "/login/add-account": "Войти в систему",
  "/analytics/agent-profit": "Прибыль от агентов",
  "/analytics/client-bonuses": "Бонусы клиентов",
  "/analytics/dashboard-settings": "Дашборды",
  "/analytics/debts-tab": "Долги с заказов",
  "/analytics/general": "Новый конструктор отчетов",
  "/analytics/mailing": "Рассылка",
  "/analytics/marketing-campaigns": "Маркетинговые акции",
  "/analytics/old-report-builder": "Старый конструктор отчетов",
  "/analytics/perfect-store": "Perfect Store",
  "/analytics/perfect-store/config": "Perfect Store",
  "/analytics/photo-reports": "Фотоотчеты",
  "/analytics/product-attribute-values": "Значение атрибута",
  "/analytics/product-attributes": "Атрибуты",
  "/analytics/product-profit": "Прибыль от товаров",
  "/analytics/product-type-profit": "Прибыль по типам продуктов",
  "/analytics/refusals": "Отказы",
  "/analytics/report-list": "Список отчетов",
  "/analytics/returns": "Возвраты",
  "/analytics/rival-products": "Продукты конкурентов",
  "/analytics/sales": "Заказы",
  "/analytics/store-categories": "Категория магазина",
  "/analytics/trend-builder": "Конструктор тенденция",
  "/clients": "Клиенты",
  "/clients/attribute-values": "Значение атрибута",
  "/clients/attributes": "Атрибуты",
  "/clients/client-dynamics": "Классификация и динамика клиентов",
  "/clients/client-restrictions": "Ограничения по клиентам",
  "/clients/client-types": "Типы клиентов",
  "/clients/duplicate-analysis": "Анализ дублей",
  "/clients/financial-accounts": "Финансовые счета",
  "/clients/restrictions": "Ограничения по клиентам",
  "/clients/routes": "Маршруты",
  "/clients/telegram-users": "Пользователи Телеграм бота",
  "/clients/territory": "Территория",
  "/clients/territory-coverage": "Охват территорий",
  "/notifications": "Уведомления",
  "/settings": "Настройки",
  "/settings/integrations": "Интеграция",
  "/settings/notifications": "Настройки уведомлений",
  "/settings/profile": "Профиль",
  "/tracking": "Отслеживание",
}

const REPORT_TITLES = new Map(analyticsReports.map((report) => [report.href.split("?")[0], report.label]))

/** Russian title key for a path, or null for the app's default title. */
export function routeTitle(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
  return ROUTE_TITLES[path] ?? REPORT_TITLES.get(path) ?? null
}
