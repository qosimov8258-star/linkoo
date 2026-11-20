import { notFound } from "next/navigation"

import { PerfectStoreConfigView } from "@/components/orders/perfect-store-config-view"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ id: string }> }

/** A config opened for editing (reference: #/perfect-store-config/<id>?openUpdateDialog=true): the list with its form. */
export default async function PerfectStoreConfigItemPage({ params }: PageProps) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) notFound()
  return <PerfectStoreConfigView itemId={id} />
}
