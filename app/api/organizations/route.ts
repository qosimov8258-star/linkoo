import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createOrganization, listOrganizations, parseOrganizationInput } from "@/lib/organizations-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listOrganizations())
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parseOrganizationInput(body)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const organization = createOrganization(input)
  return NextResponse.json(organization, { status: 201 })
}
