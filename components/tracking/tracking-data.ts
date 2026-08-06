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

const agentRows = [
  ["Admin Ritm", "25 июля 2026, 17:28", "0 / 7", 35],
  ["Сотрудник Илхомжон Жураев", "25 июня 2026, 13:43", "0 / 0", 2],
  ["Fozil Agent", "12 июня 2026, 15:58", "0 / 0", 5],
  ["Samandar Abdurahmonov", "11 мая 2026, 16:41", "0 / 0", 33],
  ["universal dostavshik", "23 февр. 2026, 17:26", "0 / 0", 90],
  ["Temur Raupov", "18 февр. 2026, 20:49", "0 / 0", 70],
  ["Ares are", "11 февр. 2026, 12:02", "0 / 0", 93],
  ["AboMuslim Raximov", "31 дек. 2025, 13:22", "0 / 0", 85],
  ["Salohiddin Dastavchik Farg'ona", "24 дек. 2025, 22:12", "0 / 0", 100],
  ["Хайрулло Доставщик", "03 дек. 2025, 22:52", "0 / 0", 80],
  ["Admin Ritm44", "26 нояб. 2025, 18:45", "0 / 0", 66],
  ["agent 007", "20 нояб. 2025, 22:21", "0 / 0", 100],
  ["Salohiddin Agent Tashkent", "17 нояб. 2025, 10:50", "0 / 0", 70],
  ["test1 asdsa", "04 нояб. 2025, 16:54", "0 / 0", 96],
  ["Islom Yuldashev", "08 окт. 2025, 10:07", "0 / 0", 87],
  ["van.agent2 2", "30 сент. 2025, 11:17", "0 / 0", 38],
  ["agent2 2", "30 сент. 2025, 10:45", "0 / 0", 42],
  ["bobur axmadov", "26 сент. 2025, 09:44", "0 / 0", 25],
  ["feruz bobokulov Bobokulov", "22 сент. 2025, 12:43", "0 / 0", 60],
  ["Feruz2 Bobokulov", "19 сент. 2025, 17:56", "0 / 0", 80],
  ["Тп 1 Алиса", "05 сент. 2025, 01:01", "0 / 0", 70],
  ["Админ 1", "04 сент. 2025, 11:27", "0 / 0", 55],
  ["xodim1 1", "02 сент. 2025, 18:56", "0 / 0", 31],
  ["xodim2 1", "29 авг. 2025, 16:40", "0 / 0", 90],
  ["Zaynillo Sadullayev", "28 авг. 2025, 03:42", "0 / 0", 1],
  ["05,08,2025 (1)", "15 авг. 2025, 10:10", "0 / 0", 40],
  ["xodim3 1", "14 авг. 2025, 13:03", "0 / 0", 42],
  ["Salohiddin Dastavchik Tashkent", "04 авг. 2025, 14:23", "0 / 0", 76],
  ["beyn kim", "14 июня 2025, 10:39", "0 / 0", 38],
  ["Otabek Komiljonov", "07 мая 2025, 14:16", "0 / 0", 51],
  ["Тп 1 Исмоилов Гани", "20 мар. 2025, 10:51", "0 / 0", 26],
  ["Азизхон Супервайзер", "15 мар. 2025, 14:54", "0 / 0", 85],
  ["Quvonchbek Admin", "07 февр. 2025, 14:45", "0 / 0", 51],
  ["Анвар Комилов", "", "0 / 0", 0],
] as const

const markerPositions: Array<[number, number]> = [
  [41.31, 69.24], [41.33, 69.28], [41.29, 69.19], [41.36, 69.22],
  [41.27, 69.31], [41.281, 69.19], [41.35, 69.33], [41.322, 69.185],
  [41.30, 69.17], [41.34, 69.30], [41.318, 69.275], [41.292, 69.255],
]

const agentColors = ["#f2b705", "#ff4d3d", "#8e24aa", "#ef4136", "#ff5722", "#71bf44", "#079fd6"]

// У этого агента в источнике данных повреждённая метка времени — карта
// показывает это как есть, вместо того чтобы скрывать запись.
const CORRUPTED_TIMESTAMP_INDEX = 9

export const agents: Agent[] = agentRows.map(([name, timestamp, ratio, battery], index) => ({
  id: index + 1,
  name,
  timestamp,
  ratio,
  battery,
  color: agentColors[index % agentColors.length],
  position: markerPositions[index],
  chips: index === CORRUPTED_TIMESTAMP_INDEX ? ["INVALID DATE"] : timestamp ? [timestamp.split(", ").at(-1) ?? ""] : [],
}))

export const mapAgents = agents.filter((a) => a.position)

export const mapClients: MapClient[] = [
  {
    id: 1,
    name: "Makro Chilonzor",
    address: "Чиланзарский район, Ташкент",
    status: "active",
    position: [41.2768, 69.2034],
  },
  {
    id: 2,
    name: "Korzinka Next",
    address: "Шайхантахурский район, Ташкент",
    status: "active",
    position: [41.3236, 69.2418],
  },
  {
    id: 3,
    name: "Havas Yunusabad",
    address: "Юнусабадский район, Ташкент",
    status: "attention",
    position: [41.3662, 69.2871],
  },
  {
    id: 4,
    name: "Baraka Market",
    address: "Мирабадский район, Ташкент",
    status: "active",
    position: [41.2932, 69.2876],
  },
  {
    id: 5,
    name: "Sardoba Savdo",
    address: "Яшнабадский район, Ташкент",
    status: "attention",
    position: [41.3059, 69.3316],
  },
]

export const mapZones: MapZone[] = [
  {
    id: 1,
    name: "Западная зона",
    center: [41.292, 69.208],
    radius: 3_000,
    color: "#2f80ed",
  },
  {
    id: 2,
    name: "Восточная зона",
    center: [41.315, 69.307],
    radius: 3_200,
    color: "#27ae60",
  },
]
