import { ClientRestrictionsView } from "@/components/clients/client-restrictions-view"

export default async function ClientRestrictionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const openId = Number(id)
  return <ClientRestrictionsView initialOpenId={Number.isInteger(openId) && openId > 0 ? openId : undefined} />
}
