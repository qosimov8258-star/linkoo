import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { BugReportsAdminList } from "@/components/bug-report/admin-list"
import { BugReportsNoAccess } from "@/components/bug-report/admin-no-access"
import { getCurrentUser } from "@/lib/current-user"
import { getServerT } from "@/lib/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT()
  return { title: `${t("Сообщения об ошибках")} — Mezon`, robots: { index: false, follow: false } }
}

// «Xato xabarlari»: the reports sent from the AI assistant of the top navigation. Admins only; the API
// (/api/admin/bug-reports) checks the role again on every request.
export default async function BugReportsAdminPage() {
  const user = await getCurrentUser()
  // The login page also takes the password change a session may still owe.
  if (!user || user.mustChangePassword) redirect(`/login?from=${encodeURIComponent("/admin/bug-reports")}`)
  if (user.role !== "admin") return <BugReportsNoAccess />
  return <BugReportsAdminList />
}
