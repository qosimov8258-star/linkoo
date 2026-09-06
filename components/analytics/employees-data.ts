export type Employee = {
  id: number
  name: string
  login: string
  role: string
  extraPermission?: string
  phone: string
  position: string
  active: boolean
  firstName: string
  lastName: string
  integrationCode: string
  branch: string
  systemAccess: boolean
  showInTracking: boolean
  twoStepCheck: boolean
  sessionLimit: boolean
  gpsCheck: boolean
  startPoint: boolean
  organizations: string[]
}

export const employeeOrganizations = [
  "05,08,2025", "1111111111111111111111", "1112233", "7777", "878", "avto organizatsiya 2", "baby still", "Buxoro 2", "ddr",
  "ddr1", "doston2organizationCola", "DostonFood", "Dosya organization", "Electronika", "energetik", "Fardad", "gulomfood tashkilot",
  "HANGUK", "hanguk13", "Ichimliklar", "IT maxsulotlari", "Konditerka", "Konstavar", "krug1Cola", "krug2Lit", "kumush", "Lalaku",
  "laptops", "linko mevalar", "linko texnika", "Maishiy texnika", "maishiy texnika buyumlari", "Maxsulotlar", "mevalar",
  "meva mahsulotlari", "MSI", "my_organitzation_2", "my_organization", "name of organisation", "NEW ORG", "Non Mahsulotlari",
  "oltin", "oltin1", "Orbit", "ORG", "organizatsiya 007", "Pampers", "Pampers", "Pampers", "parfyumeriya", "PEPSI", "qwe123 org",
  "RITM TEST", "robototexnika", "ROYAL", "Salohiddin Texnika", "Salohiddin Yemaklar", "Shaxnoza", "shirinliklar", "SmartPhone",
  "telefonlar", "test1", "test_dilmurod_organisatsi...", "TestOrganization", "Texnika", "texnikalar", "tosh98", "vova", "waters",
  "Xasanboy MCHJ", "xo'jalik mollari", "x org", "y org", "Zalal Mowafaq Company", "ZMC", "Айти-Системс", "Глобал", "Гулноза",
  "напитки", "Одежда", "ООО ПРОФШ", "ООО \"ТестМаркет\"", "Орг_1", "Орг_2", "Парус", "производство организаци...",
  "ТестоваяОрганизация", "Турецкий Айран", "Шахноза",
]

export const employeePositions = ["Админ", "Агент", "Доставщик", "Оператор", "Супервайзер", "Вансел агент", "Кассир", "Зав. склад", "Директор", "Мерчендайзер"]
export const employeeBranches = ["777", "878", "agent", "Andijon", "AURUM samarqand", "baby still", "Buxoro"]
