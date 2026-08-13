import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createRawMaterial, listRawMaterials, parseRawMaterialInput } from "@/lib/raw-materials-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listRawMaterials())
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

  const input = parseRawMaterialInput(body)
  if (!input) return NextResponse.json({ error: "Наименование и мера обязательны" }, { status: 400 })

  const material = createRawMaterial(input)
  return NextResponse.json(material, { status: 201 })
}
