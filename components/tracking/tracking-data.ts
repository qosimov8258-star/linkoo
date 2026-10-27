import type { Client } from "@/components/clients/clients-data"

export type LatLng = [number, number]

/** A zone of the directory (GET /api/clients/zones, lib/client-zones-repo.ts). */
export type ClientZone = {
  id: number
  name: string
  branch: string
  parentId: number | null
  parent: string
  polygon: LatLng[] | null
  clients: number
  located: number
  createdBy: string
  createdAt: string
}

/** A client with a location, as a map marker. */
export type MapClient = {
  id: number
  name: string
  address: string
  zone: string
  problem: boolean
  color: string
  position: LatLng
}

/** A zone outline on the map: drawn on Территория, or around its clients' locations. */
export type MapZone = {
  id: number | null
  name: string
  ring: LatLng[]
  /** true = no outline was drawn; the shape surrounds the zone's located clients. */
  derived: boolean
  color: string
}

const NOT_SET = new Set(["", "не указано", "не указан", "—", "-"])
export const zoneKey = (name: string | undefined) => (name ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
export const hasZone = (client: Pick<Client, "zone">) => !NOT_SET.has(zoneKey(client.zone))
export const isLocated = (client: Pick<Client, "locationLat" | "locationLng">) =>
  typeof client.locationLat === "number" && typeof client.locationLng === "number" && Number.isFinite(client.locationLat) && Number.isFinite(client.locationLng)

const PALETTE = ["#4f71dc", "#27ae60", "#e67e22", "#8e44ad", "#16a085", "#c0392b", "#2c3e50", "#d35400", "#2980b9", "#7f8c8d"]
const NO_ZONE_COLOR = "#9e9e9e"

/** One color per zone (by its place in the sorted zone list), grey for clients without a zone. */
export function zoneColors(names: string[]): (zone: string) => string {
  const keys = [...new Set(names.map(zoneKey).filter((key) => !NOT_SET.has(key)))].sort()
  const index = new Map(keys.map((key, i) => [key, i]))
  return (zone) => {
    const i = index.get(zoneKey(zone))
    return i === undefined ? NO_ZONE_COLOR : PALETTE[i % PALETTE.length]
  }
}

export function mapClientsOf(clients: Client[], colorOf: (zone: string) => string): MapClient[] {
  return clients.filter(isLocated).map((client) => ({
    id: client.id,
    name: client.name,
    address: client.address ?? "",
    zone: hasZone(client) ? client.zone : "",
    problem: Boolean(client.isProblem),
    color: colorOf(client.zone),
    position: [client.locationLat as number, client.locationLng as number],
  }))
}

// --- shapes around the located clients of a zone without a drawn outline ------

const METERS_PER_DEGREE = 111_320
const MIN_RADIUS = 300
const PADDING = 150

type Plane = { x: number; y: number }

function toPlane([lat, lng]: LatLng, origin: LatLng): Plane {
  return { x: (lng - origin[1]) * METERS_PER_DEGREE * Math.cos((origin[0] * Math.PI) / 180), y: (lat - origin[0]) * METERS_PER_DEGREE }
}

function fromPlane({ x, y }: Plane, origin: LatLng): LatLng {
  return [origin[0] + y / METERS_PER_DEGREE, origin[1] + x / (METERS_PER_DEGREE * Math.cos((origin[0] * Math.PI) / 180))]
}

/** Andrew's monotone chain; [] when the points are fewer than 3 or collinear. */
function convexHull(points: Plane[]): Plane[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Plane, a: Plane, b: Plane) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (list: Plane[]) => {
    const out: Plane[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 1e-6) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = [...half(sorted), ...half([...sorted].reverse())]
  return hull.length >= 3 ? hull : []
}

/** Outline around located points: a padded convex hull, or a circle for one / two / collinear points. */
export function shapeAround(points: LatLng[]): LatLng[] {
  if (!points.length) return []
  const origin: LatLng = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
  const plane = points.map((point) => toPlane(point, origin))
  const hull = convexHull(plane)
  if (hull.length) {
    return hull.map((p) => {
      const length = Math.hypot(p.x, p.y) || 1
      const scale = (length + PADDING) / length
      return fromPlane({ x: p.x * scale, y: p.y * scale }, origin)
    })
  }
  const radius = Math.max(MIN_RADIUS, Math.max(...plane.map((p) => Math.hypot(p.x, p.y))) + PADDING)
  return Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * 2 * Math.PI
    return fromPlane({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }, origin)
  })
}

/** Shapes larger than this (degrees) come from scattered data, not an area: not drawn. */
const MAX_DERIVED_SPAN = 1

/** Drawn outlines of the directory, plus shapes around the clients of zones without one. */
export function mapZonesOf(zones: ClientZone[], clients: MapClient[], colorOf: (zone: string) => string): MapZone[] {
  const out: MapZone[] = []
  const drawn = new Set<string>()
  for (const zone of zones) {
    if (!zone.polygon || zone.polygon.length < 3) continue
    drawn.add(zoneKey(zone.name))
    out.push({ id: zone.id, name: zone.name, ring: zone.polygon, derived: false, color: colorOf(zone.name) })
  }
  const byZone = new Map<string, { name: string; points: LatLng[] }>()
  for (const client of clients) {
    const key = zoneKey(client.zone)
    if (!client.zone || drawn.has(key)) continue
    const entry = byZone.get(key) ?? { name: client.zone, points: [] }
    entry.points.push(client.position)
    byZone.set(key, entry)
  }
  const idByKey = new Map(zones.map((zone) => [zoneKey(zone.name), zone.id]))
  for (const [key, entry] of byZone) {
    const ring = shapeAround(entry.points)
    if (ring.length < 3) continue
    const lats = ring.map((p) => p[0])
    const lngs = ring.map((p) => p[1])
    if (Math.max(...lats) - Math.min(...lats) > MAX_DERIVED_SPAN || Math.max(...lngs) - Math.min(...lngs) > MAX_DERIVED_SPAN) continue
    out.push({ id: idByKey.get(key) ?? null, name: entry.name, ring, derived: true, color: colorOf(entry.name) })
  }
  return out
}
