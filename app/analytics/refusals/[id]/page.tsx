import { RefusalsView } from "@/components/orders/refusals-view"

// Linko's #/reject/<id>: the list with that refusal opened under its row.
export default async function RefusalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RefusalsView initialId={Number(id)} />
}
