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

export const agents: Agent[] = [
  { id: 1, name: "Admin Ritm", color: "#f2c94c", timestamp: "25 авг. 2026, 08:59", ratio: "0/0", battery: 89, position: [41.317, 69.279], chips: ["08:59"], categories: [] },
  { id: 2, name: "Сотрудник Илхомжон Жураев", color: "#f2c94c", timestamp: "25 июня 2026, 13:43", ratio: "0/0", battery: 2, position: [41.322, 69.263], chips: ["13:43"], categories: [] },
  { id: 3, name: "Fozil Agent", color: "#9b51e0", timestamp: "12 июня 2026, 15:58", ratio: "0/0", battery: 5, position: [41.312, 69.271], chips: ["15:58"], categories: [] },
  { id: 4, name: "Samandar Abdurahmonov", color: "#eb5757", timestamp: "11 мая 2026, 16:41", ratio: "0/0", battery: 33, position: [41.309, 69.257], chips: ["16:41"], categories: [] },
  { id: 5, name: "universal dostavshik", color: "#eb5757", timestamp: "23 февр. 2026, 17:26", ratio: "0/0", battery: 90, position: [41.315, 69.29], chips: ["17:26"], categories: ["delivery"] },
  { id: 6, name: "Temur Raupov", color: "#27ae60", timestamp: "18 февр. 2026, 20:49", ratio: "0/0", battery: 70, position: [41.303, 69.268], chips: ["20:49"], categories: [] },
  { id: 7, name: "Ares are", color: "#2f80ed", timestamp: "11 февр. 2026, 12:02", ratio: "0/0", battery: 93, position: [41.32, 69.298], chips: ["12:02"], categories: [] },
  { id: 8, name: "AboMuslim Raximov", color: "#2f80ed", timestamp: "31 дек. 2025, 13:22", ratio: "0/0", battery: 85, position: [41.325, 69.25], chips: ["13:22"], categories: [] },
  { id: 9, name: "Salohiddin Dastavchik Farg'ona", color: "#f2c94c", timestamp: "24 дек. 2025, 22:12", ratio: "0/0", battery: 100, position: [41.308, 69.285], chips: ["22:12"], categories: ["delivery"] },
  { id: 10, name: "Хайрулло Доставщик", color: "#27ae60", timestamp: "03 дек. 2025, 22:52", ratio: "0/0", battery: 80, position: [41.298, 69.276], chips: ["22:52"], categories: ["delivery"] },
  { id: 11, name: "Admin Ritm44", color: "#2f80ed", timestamp: "26 нояб. 2025, 18:45", ratio: "0/0", battery: 66, position: [41.33, 69.267], chips: ["18:45"], categories: [] },
]

export const mapAgents = agents.filter((a) => a.position)

export const mapClients: MapClient[] = []

export const mapZones: MapZone[] = []
