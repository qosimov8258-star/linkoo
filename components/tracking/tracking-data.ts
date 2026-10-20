export type AgentCategory = "walk" | "tags" | "delivery" | "finance"

export type Agent = {
  id: number
  name: string
  color: string
  timestamp: string
  ratio: string
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

// No GPS / visit tracking source exists yet, so no agent has a position or a
// last-seen time: the lists stay empty instead of showing invented people.
export const agents: Agent[] = []

export const mapAgents = agents.filter((a) => a.position)

export const mapClients: MapClient[] = []

export const mapZones: MapZone[] = []
