import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteContract, updateContract } from "@/lib/contracts-repo"

const contractUpdateSchema = z
  .object({
    officialName: z.string().trim().optional(),
    client: z.string().trim().optional(),
    agent: z.string().trim().optional(),
    zone: z.string().trim().optional(),
    inn: z.string().trim().optional(),
    organization: z.string().trim().optional(),
    comment: z.string().trim().optional(),
    status: z.string().trim().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Нет данных для обновления" })

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, contractUpdateSchema)
  if (parsed.error) return parsed.error

  const contract = (await updateContract(id, parsed.data))
  if (!contract) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
  return NextResponse.json(contract)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteContract(id))
  if (!ok) return NextResponse.json({ error: "Договор не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
