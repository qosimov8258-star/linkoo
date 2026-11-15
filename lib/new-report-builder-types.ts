// Saved constructor reports («Сохранить» / «Отчеты» of the constructors): shapes shared by the API
// (lib/new-report-builder-repo.ts, app/api/new-report-builder-saves) and the pages
// (components/analytics/builder-saves.tsx).

/** The period presets of a saved report (the reference's СЕГОДНЯ | ВЧЕРА | ПОСЛ. 7 | МЕСЯЦ | СВОЯ). */
export const BUILDER_DATE_RANGES = ["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"] as const
export type BuilderDateRange = (typeof BUILDER_DATE_RANGES)[number]

/** Who sees a saved report besides its author and the administrators («ПОЛЬЗОВАТЕЛИ»): the chosen
 * accounts (users.id), or every account of the chosen access rights (access_rights.id). */
export type BuilderShare = { mode: "users" | "rights"; ids: number[] }

export type NewReportBuilderSave = {
  id: number
  name: string
  /** The model (Визит, Задачи, ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ, …). */
  reportType: string
  /** Every setting of the report: the page it was made on (`builder`), columns, groupings, filters,
   * totals, `dateRange` and the period (`from`, `to`). */
  config: Record<string, unknown>
  createdAt: string
  /** The account that saved it (null: saved before authors were kept). */
  createdBy: number | null
  /** null: every signed-in user sees it. */
  share: BuilderShare | null
  /** The reader may rename, re-share and delete it (its author or an administrator). */
  editable: boolean
}

export type BuilderShareOption = { id: number; name: string }
export type BuilderShareOptions = { users: BuilderShareOption[]; rights: BuilderShareOption[] }
