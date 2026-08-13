import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { deleteClient, getClient, parseClientInput, updateClient } from "@/lib/clients-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const client = getClient(id)
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(client)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parseClientInput(body)
  if (!input) {
    return NextResponse.json({ error: "Название, телефон, тип и зона обязательны" }, { status: 400 })
  }

  const client = updateClient(id, input)
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(client)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const ok = deleteClient(id)
  if (!ok) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
