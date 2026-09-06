import "server-only"

import { getDb } from "@/lib/db"

export type DashboardWidget = {
  id: number
  reportSlug: string
  reportLabel: string
  dashboard: string
  visibility: string
  employeeIds: number[]
  accessRightIds: number[]
}

type Row = {
  id: number
  report_slug: string
  report_label: string
  dashboard: string
  visibility: string
  employee_ids: string
  access_right_ids: string
}

function parseIds(raw: string): number[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []
  } catch {
    return []
  }
}

function rowToWidget(row: Row): DashboardWidget {
  return {
    id: row.id,
    reportSlug: row.report_slug,
    reportLabel: row.report_label,
    dashboard: row.dashboard,
    visibility: row.visibility,
    employeeIds: parseIds(row.employee_ids),
    accessRightIds: parseIds(row.access_right_ids),
  }
}

export type DashboardWidgetInput = {
  reportSlug: string
  reportLabel: string
  dashboard: string
  visibility: string
  employeeIds: number[]
  accessRightIds: number[]
}

export async function listDashboardWidgets(reportSlug?: string): Promise<DashboardWidget[]> {
  const db = getDb()
  const rows = reportSlug
    ? ((await db.prepare("SELECT * FROM dashboard_widgets WHERE report_slug = ? ORDER BY id ASC").all(reportSlug)) as Row[])
    : ((await db.prepare("SELECT * FROM dashboard_widgets ORDER BY id ASC").all()) as Row[])
  return rows.map(rowToWidget)
}

/** Creates the widget assignment, or updates it in place if one already
 * exists for this report+dashboard pair (re-saving "Добавить в дашборд"
 * for the same report/dashboard replaces the previous visibility choice
 * instead of piling up duplicate rows). */
export async function saveDashboardWidget(input: DashboardWidgetInput): Promise<DashboardWidget> {
  const db = getDb()
  await db.prepare(
        `INSERT INTO dashboard_widgets (report_slug, report_label, dashboard, visibility, employee_ids, access_right_ids)
     VALUES (@reportSlug, @reportLabel, @dashboard, @visibility, @employeeIds, @accessRightIds)
     ON CONFLICT(report_slug, dashboard) DO UPDATE SET
       report_label = excluded.report_label,
       visibility = excluded.visibility,
       employee_ids = excluded.employee_ids,
       access_right_ids = excluded.access_right_ids,
       updated_at = datetime('now')`,
      ).run({
        reportSlug: input.reportSlug,
        reportLabel: input.reportLabel,
        dashboard: input.dashboard,
        visibility: input.visibility,
        employeeIds: JSON.stringify(input.employeeIds),
        accessRightIds: JSON.stringify(input.accessRightIds),
      })
  const row = (await db.prepare("SELECT * FROM dashboard_widgets WHERE report_slug = ? AND dashboard = ?").get(input.reportSlug, input.dashboard)) as Row
  return rowToWidget(row)
}
