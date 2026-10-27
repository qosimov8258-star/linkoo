export type AgentCategory = "walk" | "tags" | "delivery" | "finance"

export type Agent = {
  /** a live (online) agent; the reference panel lists them above the offline ones */
  online?: boolean
  id: number
  name: string
  color: string
  timestamp: string
  ratio: string
  /** Counters of the day: clients to visit, visited and the ones visited without a plan. */
  todo: number
  done: number
  noPlan: number
  battery: number
  /** map marker position [lat, lng] — only online-ish agents shown on map */
  position?: [number, number]
  /** time chips shown on the map pill */
  chips?: string[]
  /** which sidebar category tabs (beyond the default "all agents" tab) this agent shows up under */
  categories: AgentCategory[]
}

export type MapClient = {
  id: number
  name: string
  address: string
  status: "active" | "attention"
  position: [number, number]
}

export type MapZone = {
  id: number
  name: string
  center: [number, number]
  radius: number
  color: string
}

export const mapClients: MapClient[] = []

export const mapZones: MapZone[] = []
