import "server-only"

import { getDb } from "@/lib/db"
import type { Brand } from "@/components/analytics/brands-data"

type Row = {
  id: number
  name: string
  organization: string
  photo_url: string | null
  created_at: string
}

function rowToBrand(row: Row): Brand {
  return {
    id: row.id,
    name: row.name,
    organization: row.organization,
    photoUrl: row.photo_url,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type BrandInput = { name: string; organization: string; photoUrl: string | null }

export function parseBrandInput(body: unknown): BrandInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const organization = typeof value.organization === "string" ? value.organization.trim() : ""
  if (!name || !organization) return null
  const photoUrl = typeof value.photoUrl === "string" && value.photoUrl.trim() ? value.photoUrl : null
  return { name, organization, photoUrl }
}

export async function listBrands(): Promise<Brand[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM brands ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToBrand)
}

export async function getBrand(id: number): Promise<Brand | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM brands WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToBrand(row) : null
}

export async function createBrand(input: BrandInput): Promise<Brand> {
  const db = getDb()
  const result = (await db
      .prepare("INSERT INTO brands (name, organization, photo_url) VALUES (@name, @organization, @photoUrl)")
      .run({ name: input.name, organization: input.organization, photoUrl: input.photoUrl }))
  return (await getBrand(Number(result.lastInsertRowid)))!
}

export async function updateBrand(id: number, input: BrandInput): Promise<Brand | null> {
  if (!(await getBrand(id))) return null
  const db = getDb()
  await db.prepare(
        "UPDATE brands SET name = @name, organization = @organization, photo_url = @photoUrl, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, name: input.name, organization: input.organization, photoUrl: input.photoUrl })
  return (await getBrand(id))
}

export async function deleteBrand(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM brands WHERE id = ?").run(id))
  return result.changes > 0
}
