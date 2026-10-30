// Built-in permission catalogue ("Права доступа" → "Возможности" → permissions).
//
// The `permissions` table is seeded from PERMISSION_CATALOG on every schema
// bootstrap (lib/db.ts, INSERT … ON CONFLICT (code) DO UPDATE), so a fresh
// install already has the full list and an administrator can build roles for
// the accountant, cashier, storekeeper and agent.
//
// Enforcement: a user linked to an access right (users.access_right_id) may only
// send writes (POST/PUT/PATCH/DELETE) to a resource when one of the access right's
// capabilities grants the resource's permission code (ROUTE_PERMISSIONS). Users
// without an access right keep the plain role model (admin / manager / viewer),
// and admins are never restricted. Checked twice: at the edge from the signed
// session claims (middleware.ts) and against Postgres in requireRole (lib/rbac.ts).
//
// Pure data and helpers only: imported by the Edge middleware, so no Node APIs.

export type PermissionDefinition = { code: string; category: string; type: string; label: string }

const MANAGE = "Изменение"

export const PERMISSION_CATALOG: ReadonlyArray<PermissionDefinition> = [
  { code: "cash.manage", category: "Касса", type: MANAGE, label: "Кассовые операции: приход, расход, перемещение, проверка и удаление" },
  { code: "payments.manage", category: "Финансы", type: MANAGE, label: "Оплаты от клиентов и оплаты поставщикам" },
  { code: "finance.manage", category: "Финансы", type: MANAGE, label: "Балансы, зарплата, договоры и финансовые справочники" },
  { code: "stock.manage", category: "Склад", type: MANAGE, label: "Остатки, передачи, списания, инвентаризация и склады" },
  { code: "procurement.manage", category: "Склад", type: MANAGE, label: "Приход и возврат поставщикам, поставщики" },
  { code: "orders.manage", category: "Продажи", type: MANAGE, label: "Заказы и возвраты клиентов" },
  { code: "clients.manage", category: "Клиенты", type: MANAGE, label: "Клиенты, маршруты, задачи и опросы" },
  { code: "catalog.manage", category: "Товары", type: MANAGE, label: "Продукты, сырье, прайс-листы и переоценка" },
  { code: "production.manage", category: "Производство", type: MANAGE, label: "Производство: рецепты, этапы и выпуск" },
  { code: "settings.manage", category: "Настройки", type: MANAGE, label: "Филиалы, валюты, сотрудники, должности и кассы" },
  { code: "reports.manage", category: "Отчеты", type: MANAGE, label: "Сохраненные отчеты и дашборды" },
]

export const PERMISSION_CODES: ReadonlySet<string> = new Set(PERMISSION_CATALOG.map((item) => item.code))

/** API resource → permission needed to change it. Matched by whole path segments, first
 * matching rule wins: more specific sub-resources come before their parent prefix. */
export const ROUTE_PERMISSIONS: ReadonlyArray<{ prefix: string; code: string }> = [
  // Customer payments received into a cashbox from the finance pages ("Групповой приход" of
  // Баланс клиентов / Долги по счетам, "Групповая оплата" of Долги с заказов) move money like
  // POST /api/cash/group-payment, so they need the same permission, not finance.manage.
  ...["balances/group-payment", "order-debts/group-payment"].map((r) => ({ prefix: `/api/${r}`, code: "cash.manage" })),
  ...["cash", "cash-management-entries", "cashback-withdrawal-requests", "expected-payment-confirmations"].map((r) => ({
    prefix: `/api/${r}`,
    code: "cash.manage",
  })),
  ...[
    "customer-payments",
    "client-payments",
    "client-bulk-payments",
    "account-bulk-payments",
    "supplier-payments",
    "loyalty-card",
  ].map((r) => ({ prefix: `/api/${r}`, code: "payments.manage" })),
  // Manual balance entries ("Баланс поставщиков": прочие приходы / расходы, запросы средств and
  // their approval) change a supplier's balance without any cash, like the branch / employee
  // balance entries: they belong to the balances permission, not to payments.manage (which
  // agents hold for their client payments).
  ...[
    "salary-plans",
    "supplier-balance-transactions",
    "branch-balance-transactions",
    "employee-balance-transactions",
    "vansell-transactions",
    "contracts",
    "store-reconciliation",
    "order-debts",
    "branch-kpi-plans",
    "debt-limits",
    // Лимит долга of a client card (/api/client-debt-limits) and "Зарплата и установка планов" (/api/salary-records).
    "client-debt-limits",
    "salary-records",
    "financial-accounts",
    // Закрытие периода (Настройки → Финансы): closing / reopening a month for money documents.
    "period-closings",
    "income-categories",
    "expense-categories",
    "organizations",
    "balances",
  ].map((r) => ({ prefix: `/api/${r}`, code: "finance.manage" })),
  // Ячейки склада and their types (cells / cell-types) are warehouse settings.
  ...["stock", "internal-transfers", "write-offs", "inventory-items", "warehouses", "cost-of-goods", "cells", "cell-types"].map((r) => ({
    prefix: `/api/${r}`,
    code: "stock.manage",
  })),
  ...["supplier-incomings", "supplier-returns", "suppliers", "supplier-categories", "invoice-incomings"].map((r) => ({
    prefix: `/api/${r}`,
    code: "procurement.manage",
  })),
  ...["orders", "order-items", "client-returns"].map((r) => ({ prefix: `/api/${r}`, code: "orders.manage" })),
  ...[
    "clients",
    "client-types",
    "client-attributes",
    "client-attribute-values",
    "client-module-items",
    "client-restrictions",
    "store-categories",
    // Классификация клиентов (ABC/XYZ classes, PUT /api/client-classification/classes).
    "client-classification",
    "refusal-types",
    "surveys",
    "survey-plans",
    "tasks",
    "kpi-tasks",
    "telegram-bot-pages",
    // Пользователи Телеграм бота: removing a bot user (DELETE /api/telegram-users/[id]).
    "telegram-users",
    "rival-products",
    // Field activity (lib/field-activity): planned routes, the mobile app's visits with their
    // refusals / photo reports and photos, and the review of a photo report
    // (PATCH /api/field-activity/photo-reports/[id]/status). /api/mobile/gps is self-service like
    // /api/mobile/check-ins (the caller's own track), so it is deliberately not listed.
    // clients.manage only lets a user write; WHOSE field data they read and write is the field scope
    // of lib/field-activity/actor.ts: every employee for administrators, role-only users and holders
    // of settings.manage (the staff permission); otherwise their own employee and the agents they supervise.
    "field-activity",
    "mobile/visits",
    "mobile/photos",
    // Активность (/api/activity/**): read-only page APIs today; any write added there needs clients.manage.
    "activity",
    // Отслеживание: route optimisation (route order) and the clients' location lock.
    "tracking",
  ].map((r) => ({ prefix: `/api/${r}`, code: "clients.manage" })),
  // The "Продажи" list pages kept in the generic record store (/api/ref-records/<kind>, lib/ref-records-repo.ts): each
  // kind needs the permission of the page that uses it. The API serves only the kinds and methods a page uses (others
  // answer 404 / 405); the rest are mapped too, so no kind of the store is ever writable without a permission.
  ...[
    ["promo", "orders.manage"], // Маркетинговые акции: rules applied to orders
    ["draft-order", "orders.manage"], // Интеграция (draft orders)
    ["gear", "clients.manage"], // Эффективность оборудования (equipment at clients)
    ["mailing", "clients.manage"], // Рассылка to clients, like /api/telegram-bot-pages
    ["bonus", "clients.manage"], // Бонусы клиентов (points per client)
    ["survey", "clients.manage"],
    ["survey-plan", "clients.manage"],
    ["tg-page", "clients.manage"],
    ["shift", "cash.manage"], // Смена (cash shifts)
  ].map(([kind, code]) => ({ prefix: `/api/ref-records/${kind}`, code })),
  ...[
    "products",
    "raw-materials",
    "price-lists",
    "price-list-entries",
    "repricings",
    "linked-repricings",
    "product-attributes",
    "product-attribute-values",
    "product-attribute-assignments",
    "product-types",
    "product-restrictions",
    "brands",
    "units-of-measure",
  ].map((r) => ({ prefix: `/api/${r}`, code: "catalog.manage" })),
  { prefix: "/api/production", code: "production.manage" },
  // Оборудования of production (lib/equipment-repo.ts, demo manufacture/equipment).
  { prefix: "/api/equipment", code: "production.manage" },
  // Посещаемость: holidays, work time, Изменить, Перерасчет, Excel import and check-ins a manager
  // registers (/api/work-attendance/**). The mobile app's own check-in (/api/mobile/check-ins) is
  // self-service: that route checks the signed-in employee itself and calls no requireRole.
  ...["branches", "currencies", "employees", "job-positions", "cashboxes", "transport", "subscriptions", "attendance-weekend-days", "work-attendance"].map(
    (r) => ({ prefix: `/api/${r}`, code: "settings.manage" }),
  ),
  // Валюты → "Индивидуальный" tab (individual rates, lib/currency-rates-repo.ts): part of the currencies setting.
  { prefix: "/api/individual-rates", code: "settings.manage" },
  // Смены (work shifts of the attendance settings) and Шаблоны уведомлений (templates and their subscribers): staff settings.
  ...["work-shifts", "notification-templates"].map((r) => ({ prefix: `/api/${r}`, code: "settings.manage" })),
  // Print / export settings and integrations: Шаблоны документов, Шаблоны чеков, the order Excel
  // columns and the external integrations (their keys) are company settings.
  ...["doc-templates", "receipt-templates", "order-excel-settings", "integrations"].map((r) => ({ prefix: `/api/${r}`, code: "settings.manage" })),
  // POST /api/report-builder only runs a report (reads): deliberately not listed, like every GET.
  // Ограничение времени: the windows in which agents may create / edit orders. A setting (the
  // reference's frontend_settings_permissions), not orders.manage: an agent who may create orders
  // must not be able to lift the restriction that applies to them.
  { prefix: "/api/order-time-restrictions", code: "settings.manage" },
  // База знания: articles + their PDF uploads (/api/knowledge-base/files) published to job
  // positions; a staff setting like the reference's (frontend_settings_notifications).
  { prefix: "/api/knowledge-base", code: "settings.manage" },
  // Сессия (the sign-in journal, Settings → Персонал): ending another account's sign-in
  // (PATCH /api/auth-logs/[id]) is staff management; restoring one is an administrator's action only.
  // Ending a sign-in of one's own account stays self-service, like /api/user-sessions; the route
  // decides all of that (lib/auth-logs-repo.ts).
  { prefix: "/api/auth-logs", code: "settings.manage" },
  ...[
    "saved-reports",
    "old-saved-reports",
    "new-report-builder-saves",
    "trend-reports",
    "custom-dashboards",
    "dashboard-widgets",
  ].map((r) => ({ prefix: `/api/${r}`, code: "reports.manage" })),
]

/** Self-service resources: every signed-in user (any role, any access right) reads and changes
 * only their own rows there — the route scopes every query to the caller and answers 404 for
 * anybody else's — so no permission code applies, and no broader prefix above may claim them.
 * Уведомления (/api/notifications/**): the caller's own notifications (list, mark viewed,
 * mark all viewed, delete). */
export const SELF_SERVICE_PREFIXES: ReadonlyArray<string> = ["/api/notifications"]

/** True for a path of a self-service resource (SELF_SERVICE_PREFIXES). */
export function isSelfServiceRoute(pathname: string): boolean {
  return SELF_SERVICE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** Permission code a request needs, or null when the role check alone decides. */
export function requiredPermission(pathname: string, method: string): string | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null
  if (isSelfServiceRoute(pathname)) return null
  for (const rule of ROUTE_PERMISSIONS) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) return rule.code
  }
  return null
}
