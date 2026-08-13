import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createClient, listClients, parseClientInput } from "@/lib/clients-repo"

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const search = request.nextUrl.searchParams.get("q") ?? undefined
  return NextResponse.json(listClients(search))
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

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

  const client = createClient(input)
  return NextResponse.json(client, { status: 201 })
}
