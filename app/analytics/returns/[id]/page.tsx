import { ReturnsView } from "@/components/orders/returns-view"

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ReturnsView initialId={Number(id)} />
}
