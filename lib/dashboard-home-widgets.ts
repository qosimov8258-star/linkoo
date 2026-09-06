export type HomeWidgetKind =
  | "statcard"
  | "unitStatcard"
  | "kpi"
  | "visitsDelivery"
  | "productCategory"
  | "agentBranchVisits"
  | "cashboxSummary"
  | "placeholder"

export type HomeWidgetDef = {
  key: string
  label: string
  kind: HomeWidgetKind
  defaultChecked: boolean
}

export const HOME_WIDGETS: HomeWidgetDef[] = [
  { key: "sales", label: "Продажи", kind: "statcard", defaultChecked: true },
  { key: "payments", label: "Оплаты", kind: "statcard", defaultChecked: true },
  { key: "returns", label: "Возвраты", kind: "statcard", defaultChecked: true },
  { key: "akb", label: "АКБ", kind: "statcard", defaultChecked: true },
  { key: "salesUnits", label: "Продажи в Штуках", kind: "unitStatcard", defaultChecked: true },
  { key: "salesBlocks", label: "Продажи в Блоках", kind: "unitStatcard", defaultChecked: true },
  { key: "salesWeight", label: "Продажи в Весе", kind: "unitStatcard", defaultChecked: true },
  { key: "kpi", label: "KPI", kind: "kpi", defaultChecked: true },
  { key: "visitsDelivery", label: "Посещение и доставка", kind: "visitsDelivery", defaultChecked: true },
  { key: "productCategory", label: "Категория по продуктам", kind: "productCategory", defaultChecked: true },
  { key: "agentSales", label: "Продажи агентов", kind: "placeholder", defaultChecked: true },
  { key: "agentBranchVisits", label: "Визиты агента по филиалам", kind: "agentBranchVisits", defaultChecked: true },
  { key: "akbTrend", label: "Тенденция акб и отказов", kind: "placeholder", defaultChecked: true },
  { key: "refusals", label: "Отказы", kind: "placeholder", defaultChecked: true },
  { key: "couriers", label: "Доставщики", kind: "placeholder", defaultChecked: true },
  { key: "cashboxes", label: "Кассы", kind: "cashboxSummary", defaultChecked: true },
  { key: "productAnalysis", label: "Анализ по товару", kind: "placeholder", defaultChecked: true },
  { key: "warehouseWriteoff", label: "Склад списание по ндям", kind: "placeholder", defaultChecked: false },
  { key: "ttVisitsByTp", label: "Посещение ТТ по ТП", kind: "placeholder", defaultChecked: false },
  { key: "warehouseIncomeByDay", label: "Склад приход по дням", kind: "placeholder", defaultChecked: false },
  { key: "fev4Info", label: "4-fev info", kind: "placeholder", defaultChecked: false },
  { key: "visitConstructor", label: "конструктор по визитов", kind: "placeholder", defaultChecked: false },
  { key: "testOtchot", label: "test otchot", kind: "placeholder", defaultChecked: false },
  { key: "okbReport", label: "отчет ОКБ", kind: "placeholder", defaultChecked: false },
  { key: "skidka", label: "skidka", kind: "placeholder", defaultChecked: false },
  { key: "productTypeRating", label: "Тип продукта рейтинг 1", kind: "placeholder", defaultChecked: false },
  { key: "testUchun", label: "Test Uchun", kind: "placeholder", defaultChecked: false },
  { key: "productNames", label: "названия продукта", kind: "placeholder", defaultChecked: false },
  { key: "agentReports", label: "отчеты по агентам", kind: "placeholder", defaultChecked: false },
]

const STORAGE_KEY = "linko.dashboard.homeWidgets"

export function defaultSelectedHomeWidgets(): string[] {
  return HOME_WIDGETS.filter((widget) => widget.defaultChecked).map((widget) => widget.key)
}

export function loadSelectedHomeWidgets(): string[] {
  if (typeof window === "undefined") return defaultSelectedHomeWidgets()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSelectedHomeWidgets()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return defaultSelectedHomeWidgets()
    const validKeys = new Set(HOME_WIDGETS.map((widget) => widget.key))
    return parsed.filter((key): key is string => typeof key === "string" && validKeys.has(key))
  } catch {
    return defaultSelectedHomeWidgets()
  }
}

export function saveSelectedHomeWidgets(keys: string[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {}
}
