export type Client = {
  id: number
  name: string
  phone: string
  info?: string
  inn?: string
  type: string
  zone: string
  zoneAgent: string
  agent: string
  deliverer: string
  collector: string
  balance?: number
  tab: "unconfirmed" | "problem" | "plan" | "closing" | "all"
  branch?: string
  /** Has an agent route assigned (reference «Маршрут»). */
  inRoute?: boolean
  /** Shown under the «Проблемные» tab. */
  isProblem?: boolean
  /** «Статус объекта»: an inactive confirmed client is marked red in the list. */
  isActive?: boolean
  salesChannel?: string
  realizationBy?: string
  address?: string
  landmark?: string
  locationLat?: number
  locationLng?: number
  telegramLocationLink?: string
  code?: string
  contactPerson?: string
  note?: string
  autoDelivery?: boolean
  unlimitedDebt?: boolean
  attributes?: Record<string, string>
  /** Per-currency balance lines, e.g. "12 047 000 SUM". */
  balanceLines?: string[]
  createdAt?: string
}

export const clients: Client[] = [
  {
    id: 1,
    name: "aziz",
    phone: "+998950603332",
    type: "chakana savdo",
    zone: "spark",
    zoneAgent: "agent",
    agent: "Шохрух Туляганов",
    deliverer: "Admin Ritm",
    collector: "Не указано",
    tab: "all",
  },
  {
    id: 2,
    name: "test2 yaratgan klient",
    phone: "+998963369696",
    inn: "45874587",
    type: "Розница",
    zone: "spark",
    zoneAgent: "agent",
    agent: "Шохрух Туляганов",
    deliverer: "Не указано",
    collector: "Не указано",
    balance: -69992,
    tab: "all",
  },
]

const screenshotClientNames = ["Markus Vitinha", "Usman Dembele", "Ashraf Hakimi", "Doston market", "333333333333333333333333333333", "Частное Лицо", "ЧЛ Кылышбай", "ИП Каркабаев", "ЧЛ Николай", "klient 1", "ЧЛ Балаев Фаик Мусаевич", "ТОО SEDA ELECTRIC", "ИП Рамазан (Каметулы Бауржан)", "ТОО Пол Берри Юг", "ТОО Mega zakaz", "ЧЛ Курбатов Вадим Николаевич", "ЧЛ Автигунов Замон Едилбайугли", "ИП Торехан (Анна)", "ЧЛ Ибраева Мадина Амангельдыева", "ИП Алина", "ЧЛ Ведлер Руслан Алексеевич", "ИП АРЕНОВ АБУ-АЛИ НУРЛАНОВИЧ", "ИП Эльмира", "ИП Исаева"]
clients.unshift(...screenshotClientNames.map((name, index) => ({
  id: 100 + index, name, phone: index < 8 ? `+9989${String(111111111 + index * 33777).slice(0, 9)}` : "-", inn: index >= 10 ? String(240840031027 + index * 11378491) : undefined,
  type: index < 6 ? (index === 5 ? "Юр. лицо" : "chakana savdo") : index < 10 ? "Физ. лицо" : "не какокоаткт ПКП", zone: index < 8 ? (index === 0 ? "Arslan" : "spark") : "Не указано", zoneAgent: index === 3 ? "Buxoro" : "Ташкент",
  agent: index % 4 === 3 ? "Samandar Abdurahmonov" : "Admin Ritm", deliverer: index < 3 ? "Admin Ritm" : "Не указано", collector: "Не указано",
  balance: index === 0 ? -1000 : index === 1 ? 12050000 : index === 2 ? -251171800 : index === 3 ? -17.6 : index === 4 ? 40000000 : index === 5 ? -343375 : index === 7 ? 30000 : index === 8 ? -40000 : index === 9 ? -169000 : undefined, tab: "all" as const,
})))

export const clientTabs = [
  { id: "unconfirmed", label: "Не подтвержденные" },
  { id: "problem", label: "Проблемные" },
  { id: "plan", label: "Плановый ОКБ" },
  { id: "closing", label: "Закрытие" },
  { id: "all", label: "Все" },
] as const
