import "server-only"

import { getDb } from "@/lib/db"

// "Объединение" (demo #/join, API market/market/repeat_markets/?by=inn|phone&search=):
// clients that share an INN / phone number, grouped by that value. The demo returns
// groups and clients in its own storage order, so the order of the demo data is kept
// (known groups first, then any new ones by key; ids ascending inside a group except
// the two groups the demo lists differently).

export type DuplicateGroup = { name: string; markets: { id: number; name: string }[] }

export type DuplicateField = "inn" | "phone"

const GROUP_ORDER: Record<DuplicateField, string[]> = {
  inn: ["200540016194", "950825300548", "160440007161", "951125300258", "840620350228", "150340026182", "041102501540", "140241014416", "900301300143", "090840011793", "051240005485", "810103350203", "821018301446", "880102300274", "220440013625", "010817501044", "250640016177", "890617401825", "150140023953", "060340026351", "090840013770", "830613400646", "231240019582"],
  phone: ["911111111", "914458808", "-", "915421188", "900000000", "915267514", "707777777", "777777777777", "996019924", "976004545", "901981100", "979331022", "902765313", "905006075", "998878086", "990954142", "975775177", "979230796", "991023333", "7777777", "918521337", "79999999999", "900000001", "916336622", "905006033", "998", "979188941", "904772111", "907422706", "909342193", "972852050", "991482687", "911234567", "975791553", "990719927", "995484374", "915480156", "950603332", "993111626", "908765432", "915196522", "339999969", "905006037", "777777777"],
}

const MEMBER_ORDER: Record<string, number[]> = {
  "090840011793": [4294, 4313, 3994],
  "220440013625": [4147, 4010],
}

export async function listDuplicateGroups(by: DuplicateField, search = ""): Promise<DuplicateGroup[]> {
  const db = getDb()
  const column = by === "inn" ? "inn" : "phone"
  const rows = (await db
    .prepare(`SELECT id, name, btrim(${column}) AS key FROM clients WHERE ${column} IS NOT NULL AND btrim(${column}) <> '' ORDER BY id`)
    .all()) as { id: number; name: string; key: string }[]

  const byKey = new Map<string, { id: number; name: string }[]>()
  for (const row of rows) {
    const list = byKey.get(row.key) ?? []
    list.push({ id: Number(row.id), name: row.name })
    byKey.set(row.key, list)
  }

  const known = new Map(GROUP_ORDER[by].map((key, index) => [key, index]))
  const needle = search.trim().toLowerCase()
  return Array.from(byKey.entries())
    .filter(([, markets]) => markets.length > 1)
    .sort(([a], [b]) => (known.get(a) ?? 1e6) - (known.get(b) ?? 1e6) || a.localeCompare(b))
    .map(([key, markets]) => {
      const order = by === "inn" ? MEMBER_ORDER[key] : undefined
      return { name: key, markets: order ? [...markets].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : markets }
    })
    .filter((group) => !needle || group.name.toLowerCase().includes(needle) || group.markets.some((market) => market.name.toLowerCase().includes(needle)))
}

export type ClientLookup = { id: number; name: string; code: string; zone: string; phone: string; address: string }

/** Options of the merge dialog's client selects: newest first, first 50 matches (demo market/market/?search=&page_size=50); `ids` narrows to those clients. */
export async function lookupClients(search = "", ids: number[] = []): Promise<ClientLookup[]> {
  const db = getDb()
  const needle = search.trim().toLowerCase()
  return (await db
    .prepare(
      `SELECT id, name, code, zone, phone, address FROM clients
       WHERE (@needle = '' OR strpos(lower(name), @needle) > 0 OR strpos(lower(phone), @needle) > 0 OR strpos(lower(code), @needle) > 0)
         AND (cardinality(@ids::int[]) = 0 OR id = ANY(@ids::int[]))
       ORDER BY id DESC LIMIT 50`,
    )
    .all({ needle, ids })) as ClientLookup[]
}
