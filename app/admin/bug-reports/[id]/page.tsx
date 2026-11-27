import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { BugReportAdminDetail } from "@/components/bug-report/admin-detail"
import { BugReportsNoAccess } from "@/components/bug-report/admin-no-access"
import { NotFoundContent, notFoundMetadata } from "@/components/not-found-content"
import { getCurrentUser } from "@/lib/current-user"
import { getServerT } from "@/lib/i18n/server"

type BugReportPageProps = { params: Promise<{ id: string }> }

/** The report id of the address, or null for anything but a positive integer. */
function reportId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function generateMetadata({ params }: BugReportPageProps): Promise<Metadata> {
  const id = reportId((await params).id)
  if (id === null) return notFoundMetadata()
  const t = await getServerT()
  return { title: `${t("Сообщение об ошибке")} #${id} — Mezon`, robots: { index: false, follow: false } }
}

// One report of «Xato xabarlari». Admins only, like the list; the data comes from /api/admin/bug-reports/<id>.
export default async function BugReportAdminPage({ params }: BugReportPageProps) {
  const { id: raw } = await params
  const user = await getCurrentUser()
  if (!user || user.mustChangePassword) redirect(`/login?from=${encodeURIComponent(`/admin/bug-reports/${raw}`)}`)
  if (user.role !== "admin") return <BugReportsNoAccess />
  const id = reportId(raw)
  if (id === null) return <NotFoundContent />
  return <BugReportAdminDetail id={id} />
}
