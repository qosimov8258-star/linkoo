// Single source of truth for the settings navigation, shared by the gear-icon
// panel and the catalog pages' left sidebar so the two cannot drift apart.
export type SettingsNavLink = { label: string; href?: string; /** Query the reference appends to the sidebar link (not to the top-menu one). */ query?: string }
export type SettingsNavGroup = { title: string; items: SettingsNavLink[] }

export const settingsNavGroups: SettingsNavGroup[] = [
  {
    title: "Персонал",
    items: [
      { label: "Подписки", href: "/analytics/subscriptions" },
      { label: "Сотрудники", href: "/analytics/employees" },
      { label: "Смены", href: "/analytics/shifts" },
      { label: "Должности", href: "/analytics/positions" },
      { label: "Права доступа", href: "/analytics/access-rights", query: "page=1&pageSize=100" },
      { label: "Транспорт", href: "/analytics/transport" },
      { label: "Сессия", href: "/analytics/sessions" },
    ],
  },
  {
    title: "Финансы",
    items: [
      { label: "Валюты", href: "/analytics/currencies" },
      { label: "Кассы", href: "/analytics/cashboxes" },
      { label: "Категории приходов", href: "/analytics/income-categories" },
      { label: "Категории расходов", href: "/analytics/expense-categories" },
    ],
  },
  {
    title: "Продукты",
    items: [
      { label: "Типы продуктов", href: "/analytics/product-types" },
      { label: "Измерения", href: "/analytics/units-of-measure" },
      { label: "Бренд", href: "/analytics/brands" },
      { label: "Атрибуты", href: "/analytics/product-attributes" },
      { label: "Значение атрибута", href: "/analytics/product-attribute-values" },
      { label: "Продукты конкурентов", href: "/analytics/rival-products" },
    ],
  },
  {
    title: "Клиенты",
    items: [
      { label: "Типы клиентов", href: "/clients/client-types" },
      { label: "Атрибуты", href: "/clients/attributes" },
      { label: "Значение атрибута", href: "/clients/attribute-values" },
      { label: "Категория магазина", href: "/analytics/store-categories" },
    ],
  },
  {
    title: "Конструкторы",
    items: [
      { label: "Конструктор документов", href: "/analytics/document-templates" },
      { label: "Дашборды", href: "/analytics/dashboard-settings" },
      { label: "Настройка EXCEL заказов", href: "/analytics/order-excel-settings" },
    ],
  },
  {
    title: "Поставщики",
    items: [{ label: "Категории поставщиков", href: "/analytics/supplier-categories" }],
  },
  {
    title: "Склад",
    items: [
      { label: "Склады", href: "/analytics/warehouses" },
      { label: "Настройка чека", href: "/analytics/receipt-settings" },
      { label: "Тип ячейки", href: "/analytics/cell-types" },
      { label: "Ячейки", href: "/analytics/cells" },
    ],
  },
  {
    title: "Разное",
    items: [
      { label: "Прайс-листы", href: "/analytics/price-lists" },
      { label: "Тип отказа", href: "/analytics/refusal-types" },
      { label: "Филиалы", href: "/analytics/branches" },
      { label: "Оборудования", href: "/analytics/equipment" },
      { label: "Организация", href: "/analytics/organization" },
      { label: "Объединение", href: "/analytics/duplicate-analysis" },
      { label: "Ограничение времени", href: "/analytics/time-restrictions" },
      { label: "Закрытия дня/месяца", href: "/analytics/period-closings" },
      { label: "Интеграция", href: "/settings/integrations" },
      { label: "Уведомления", href: "/settings/notifications" },
    ],
  },
]
