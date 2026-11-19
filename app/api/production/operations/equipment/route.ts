import { NextResponse } from "next/server"

import { requireViewer } from "@/lib/production-api"
import { listOperationEquipment } from "@/lib/production-stages-repo"

// GET /api/production/operations/equipment — the machines an operation can use: those of every stage, with the
// stage's name (the reference's «Оборудование» field searches all equipment, operations being global).
export async function GET() {
  const denied = await requireViewer()
  if (denied) return denied
  return NextResponse.json(await listOperationEquipment())
}
