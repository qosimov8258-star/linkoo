import { OrdersView } from "@/components/orders/orders-view"

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OrdersView initialOrderId={Number(id)} />
}
