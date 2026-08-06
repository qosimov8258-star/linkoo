export type ClientModuleKind = "list" | "report" | "ledger" | "directory" | "operations"

export type ClientModule = {
  slug: string
  label: string
  href: string
  description: string
  kind: ClientModuleKind
  categoryLabel: string
  valueLabel: string
}

export type ClientMenuGroup = {
  title: string
  items: ClientModule[]
}

const counterparties: ClientModule[] = [
  {
    slug: "clients",
    label: "Клиенты",
    href: "/clients",
    description: "Единый список клиентов, контактов и ответственных сотрудников.",
    kind: "list",
    categoryLabel: "Тип клиента",
    valueLabel: "Баланс",
  },
  {
    slug: "client-dynamics",
    label: "Классификация и динамика клиентов",
    href: "/clients/client-dynamics",
    description: "Сегментация клиентской базы и изменение активности по периодам.",
    kind: "report",
    categoryLabel: "Сегмент",
    valueLabel: "Клиентов",
  },
  {
    slug: "financial-accounts",
    label: "Финансовые счета",
    href: "/clients/financial-accounts",
    description: "Финансовые счета клиентов, текущие остатки и лимиты.",
    kind: "ledger",
    categoryLabel: "Тип счёта",
    valueLabel: "Остаток",
  },
  {
    slug: "telegram-users",
    label: "Пользователи Телеграм бота",
    href: "/clients/telegram-users",
    description: "Пользователи Telegram-бота, привязанные клиенты и активность.",
    kind: "operations",
    categoryLabel: "Роль",
    valueLabel: "Сессии",
  },
  {
    slug: "restrictions",
    label: "Ограничения по клиентам",
    href: "/clients/restrictions",
    description: "Кредитные, товарные и маршрутные ограничения клиентской базы.",
    kind: "operations",
    categoryLabel: "Тип ограничения",
    valueLabel: "Лимит",
  },
]

const territory: ClientModule[] = [
  {
    slug: "territory",
    label: "Территория",
    href: "/clients/territory",
    description: "Территории продаж, ответственные команды и торговые точки.",
    kind: "directory",
    categoryLabel: "Регион",
    valueLabel: "Точек",
  },
  {
    slug: "territory-coverage",
    label: "Охват территорий",
    href: "/clients/territory-coverage",
    description: "Покрытие территории активными клиентами и полевыми командами.",
    kind: "report",
    categoryLabel: "Территория",
    valueLabel: "Охват",
  },
  {
    slug: "routes",
    label: "Маршруты",
    href: "/clients/routes",
    description: "Маршруты агентов, расписание визитов и закреплённые клиенты.",
    kind: "operations",
    categoryLabel: "Агент",
    valueLabel: "Визитов",
  },
  {
    slug: "duplicate-analysis",
    label: "Анализ дублей",
    href: "/clients/duplicate-analysis",
    description: "Поиск и обработка возможных дубликатов клиентов.",
    kind: "report",
    categoryLabel: "Причина совпадения",
    valueLabel: "Совпадение",
  },
]

const directories: ClientModule[] = [
  {
    slug: "client-types",
    label: "Типы клиентов",
    href: "/clients/client-types",
    description: "Справочник типов и форматов торговых точек.",
    kind: "directory",
    categoryLabel: "Группа",
    valueLabel: "Клиентов",
  },
  {
    slug: "attributes",
    label: "Атрибуты",
    href: "/clients/attributes",
    description: "Настраиваемые характеристики и поля карточки клиента.",
    kind: "directory",
    categoryLabel: "Формат",
    valueLabel: "Значений",
  },
  {
    slug: "attribute-values",
    label: "Значение атрибута",
    href: "/clients/attribute-values",
    description: "Допустимые значения атрибутов и правила их применения.",
    kind: "directory",
    categoryLabel: "Атрибут",
    valueLabel: "Использований",
  },
]

export const clientsMenuGroups: ClientMenuGroup[] = [
  { title: "Контрагенты", items: counterparties },
  { title: "Территория", items: territory },
  { title: "Справочники", items: directories },
]

export const clientModules = clientsMenuGroups.flatMap((group) => group.items)

export function getClientModule(slug: string) {
  return clientModules.find((module) => module.slug === slug)
}
