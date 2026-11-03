// Shared (client + server) options and answer of the dashboard donut (lib/dashboard-breakdown-repo.ts).

export const BREAKDOWN_GROUPS = [
  "По товарам",
  "По родительскому типу продукта",
  "По типам продуктов",
  "По брендам",
  "По агентам",
  "По доставщикам",
  "По клиентам",
  "Территории",
  "По складам",
  "По филиалам",
  "По дням",
  "По неделям",
  "По месяцам",
] as const
export type BreakdownGroup = (typeof BREAKDOWN_GROUPS)[number]

export const BREAKDOWN_MEASURES = [
  "Факт продажи",
  "Факт АКБ",
  "Факт",
  "Фактическая скидка",
  "Обьем без учета возвратов",
  "КГ без учета возвратов",
  "Сумма возвратов",
  "Кол-во возвратов",
  "Продажа без учета возвратов",
] as const
export type BreakdownMeasure = (typeof BREAKDOWN_MEASURES)[number]

export type BreakdownRow = { name: string; value: number }
export type DashboardBreakdown = { group: BreakdownGroup; measure: BreakdownMeasure; currency: string; unit: "money" | "count" | "pieces" | "kg"; rows: BreakdownRow[]; total: number }
