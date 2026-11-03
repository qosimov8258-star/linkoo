// Master data of the simulated factory "Zilol Ichimliklar Zavodi" (a soft drink and water
// plant in Tashkent with a branch in Samarkand). Everything is invented for local testing
// and generated deterministically (seeded random), so a re-run produces the same factory.

export function rng(seed = 20261031) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  }
}

export const COMPANY = {
  organization: "Zilol Ichimliklar MChJ",
  tradeOrganization: "Zilol Savdo MChJ",
  mainBranch: "Toshkent bosh zavod",
  branch2: "Samarqand filiali",
}

export const CURRENCIES = [
  { name: "SUM", code: "SUM", isBase: true },
  { name: "USD", code: "USD", rate: 12850 },
]

export const UNITS = [
  { name: "dona" },
  { name: "kg", isWeighted: true },
  { name: "litr" },
  { name: "blok" },
  { name: "rulon" },
  { name: "metr" },
]

export const PRODUCT_TYPES = [
  { name: "Gazli ichimliklar", children: ["Cola", "Mevali gazli"] },
  { name: "Sharbatlar", children: ["Nektar", "Sharbat 100%"] },
  { name: "Ichimlik suvi", children: ["Gazsiz suv", "Gazli suv", "Kuler suvi"] },
  { name: "Xom ashyo", children: ["Qadoqlash", "Oziq-ovqat xom ashyosi", "Kimyoviy moddalar"] },
]

export const BRANDS = ["Zilol", "Bahor", "Toza Suv"]

export const PRICE_LISTS = [
  { name: "Ulgurji", currency: "SUM", position: 1, isDefaultForOrder: true },
  { name: "Chakana", currency: "SUM", position: 2 },
  { name: "Diler", currency: "SUM", position: 3 },
]

export const WORK_SHIFTS = [
  { name: "1-smena (kunduzgi)", beginTime: "08:00", endTime: "20:00" },
  { name: "2-smena (tungi)", beginTime: "20:00", endTime: "08:00" },
  { name: "Ofis", beginTime: "09:00", endTime: "18:00" },
]

export const EXPENSE_CATEGORIES = [
  { name: "Elektr energiya" },
  { name: "Tabiiy gaz" },
  { name: "Suv va kanalizatsiya" },
  { name: "Yoqilg'i (transport)" },
  { name: "Uskunalar ta'miri" },
  { name: "Ish haqi", option: "staff_expense", excludeFromPnl: true },
  { name: "Avans", option: "staff_expense", excludeFromPnl: true },
  { name: "Soliqlar" },
  { name: "Reklama va marketing" },
  { name: "Ofis xarajatlari" },
  { name: "Yetkazib beruvchiga to'lov", option: "provider" },
  { name: "Kirim bo'yicha qo'shimcha xarajat", option: "supply_expense" },
  { name: "Mijozga pul qaytarish", option: "client" },
]

export const INCOME_CATEGORIES = [
  { name: "Mahsulot sotuvi", option: "client" },
  { name: "Buyurtma bo'yicha to'lov", option: "order" },
  { name: "Ta'sischi investitsiyasi" },
  { name: "Boshqa kirimlar" },
]

export const CLIENT_TYPES = ["Do'kon", "Supermarket", "Diler", "Kafe va restoran", "Ulgurji baza"]

export const ZONES = [
  { name: "Chilonzor", branch: COMPANY.mainBranch },
  { name: "Yunusobod", branch: COMPANY.mainBranch },
  { name: "Sergeli", branch: COMPANY.mainBranch },
  { name: "Mirzo Ulug'bek", branch: COMPANY.mainBranch },
  { name: "Yakkasaroy", branch: COMPANY.mainBranch },
  { name: "Samarqand markaz", branch: COMPANY.branch2 },
  { name: "Urgut", branch: COMPANY.branch2 },
]

export const SUPPLIER_CATEGORIES = ["Qadoqlash materiallari", "Oziq-ovqat xom ashyosi", "Kimyoviy moddalar", "Gaz va energiya"]

export const SUPPLIERS = [
  { name: "Preform Plast MChJ", category: "Qadoqlash materiallari", address: "Toshkent, Bektemir sanoat zonasi 12", phone: "+998712001010" },
  { name: "Qopqoq Invest MChJ", category: "Qadoqlash materiallari", address: "Toshkent viloyati, Chirchiq sh., Sanoat ko'chasi 4", phone: "+998712002020" },
  { name: "Etiketka Print MChJ", category: "Qadoqlash materiallari", address: "Toshkent, Yashnobod, Fargona yo'li 88", phone: "+998712003030" },
  { name: "Karton Box Servis", category: "Qadoqlash materiallari", address: "Toshkent, Sergeli, 6-mavze", phone: "+998712004040" },
  { name: "Shakar Savdo MChJ", category: "Oziq-ovqat xom ashyosi", address: "Xorazm, Urganch, Shakar zavodi yo'li 1", phone: "+998622005050" },
  { name: "Anadolu Concentrate", category: "Oziq-ovqat xom ashyosi", address: "Turkiya, Istanbul, Esenyurt OSB", phone: "+902125006060" },
  { name: "Kimyo Reagent MChJ", category: "Kimyoviy moddalar", address: "Navoiy, Sanoat zonasi 3", phone: "+998792007070" },
  { name: "Uzbek CO2 Gaz", category: "Gaz va energiya", address: "Olmaliq, Kimyogarlar ko'chasi 15", phone: "+998712008080" },
]

// Raw materials: [name, type child, unit, supplier, cost per unit (SUM), barcode]
export const RAW_MATERIALS = [
  ["PET preforma 18g (0,5L)", "Qadoqlash", "dona", "Preform Plast MChJ", 420],
  ["PET preforma 28g (1L)", "Qadoqlash", "dona", "Preform Plast MChJ", 610],
  ["PET preforma 38g (1,5L)", "Qadoqlash", "dona", "Preform Plast MChJ", 790],
  ["PET preforma 85g (5L)", "Qadoqlash", "dona", "Preform Plast MChJ", 1650],
  ["Qopqoq 28mm", "Qadoqlash", "dona", "Qopqoq Invest MChJ", 95],
  ["Qopqoq 48mm (5L)", "Qadoqlash", "dona", "Qopqoq Invest MChJ", 260],
  ["Etiketka Zilol", "Qadoqlash", "dona", "Etiketka Print MChJ", 55],
  ["Etiketka Bahor", "Qadoqlash", "dona", "Etiketka Print MChJ", 70],
  ["Etiketka Toza Suv", "Qadoqlash", "dona", "Etiketka Print MChJ", 40],
  ["Termo plyonka", "Qadoqlash", "kg", "Karton Box Servis", 21000],
  ["Karton quti (Tetra 1L x12)", "Qadoqlash", "dona", "Karton Box Servis", 2300],
  ["Shakar", "Oziq-ovqat xom ashyosi", "kg", "Shakar Savdo MChJ", 11500],
  ["Cola konsentrati", "Oziq-ovqat xom ashyosi", "kg", "Anadolu Concentrate", 185000],
  ["Apelsin konsentrati", "Oziq-ovqat xom ashyosi", "kg", "Anadolu Concentrate", 32000],
  ["Olma konsentrati", "Oziq-ovqat xom ashyosi", "kg", "Anadolu Concentrate", 24000],
  ["Shaftoli pyuresi", "Oziq-ovqat xom ashyosi", "kg", "Anadolu Concentrate", 21000],
  ["Limon kislotasi", "Kimyoviy moddalar", "kg", "Kimyo Reagent MChJ", 26000],
  ["Natriy benzoat", "Kimyoviy moddalar", "kg", "Kimyo Reagent MChJ", 34000],
  ["CO2 gazi", "Kimyoviy moddalar", "kg", "Uzbek CO2 Gaz", 4200],
]

// Products: [name, type, subcategory, brand, unit, pieces per blok, Ulgurji price, Chakana price, Diler price, barcode]
export const PRODUCTS = [
  ["Zilol Cola 0,5L", "Gazli ichimliklar", "Cola", "Zilol", 12, 4200, 5000, 3900, "4780012000011"],
  ["Zilol Cola 1L", "Gazli ichimliklar", "Cola", "Zilol", 6, 6800, 8000, 6400, "4780012000028"],
  ["Zilol Cola 1,5L", "Gazli ichimliklar", "Cola", "Zilol", 6, 8900, 10500, 8400, "4780012000035"],
  ["Zilol Apelsin 0,5L", "Gazli ichimliklar", "Mevali gazli", "Zilol", 12, 4000, 4800, 3700, "4780012000042"],
  ["Zilol Apelsin 1,5L", "Gazli ichimliklar", "Mevali gazli", "Zilol", 6, 8500, 10000, 8000, "4780012000059"],
  ["Zilol Limon 0,5L", "Gazli ichimliklar", "Mevali gazli", "Zilol", 12, 4000, 4800, 3700, "4780012000066"],
  ["Zilol Limon 1,5L", "Gazli ichimliklar", "Mevali gazli", "Zilol", 6, 8500, 10000, 8000, "4780012000073"],
  ["Bahor Olma nektari 1L", "Sharbatlar", "Nektar", "Bahor", 12, 11500, 13500, 10900, "4780012000080"],
  ["Bahor Apelsin nektari 1L", "Sharbatlar", "Nektar", "Bahor", 12, 12500, 14500, 11800, "4780012000097"],
  ["Bahor Shaftoli nektari 1L", "Sharbatlar", "Nektar", "Bahor", 12, 12000, 14000, 11300, "4780012000103"],
  ["Bahor Olma sharbati 100% 1L", "Sharbatlar", "Sharbat 100%", "Bahor", 12, 16500, 19000, 15600, "4780012000110"],
  ["Toza Suv gazsiz 0,5L", "Ichimlik suvi", "Gazsiz suv", "Toza Suv", 12, 1900, 2500, 1750, "4780012000127"],
  ["Toza Suv gazsiz 1,5L", "Ichimlik suvi", "Gazsiz suv", "Toza Suv", 6, 3200, 4000, 3000, "4780012000134"],
  ["Toza Suv gazli 0,5L", "Ichimlik suvi", "Gazli suv", "Toza Suv", 12, 2100, 2700, 1950, "4780012000141"],
  ["Toza Suv gazli 1,5L", "Ichimlik suvi", "Gazli suv", "Toza Suv", 6, 3500, 4300, 3300, "4780012000158"],
  ["Toza Suv 5L", "Ichimlik suvi", "Gazsiz suv", "Toza Suv", 2, 7500, 9000, 7000, "4780012000165"],
]

// Job positions with headcount and monthly salary (SUM) — 100 people in total.
export const JOBS = [
  { name: "Direktor", count: 1, salary: 25_000_000, branch: "main", access: "Rahbariyat", login: true },
  { name: "Bosh hisobchi", count: 1, salary: 15_000_000, branch: "main", access: "Hisobchi", login: true },
  { name: "Hisobchi", count: 2, salary: 8_000_000, branch: "both", access: "Hisobchi", login: true },
  { name: "Kassir", count: 2, salary: 6_000_000, branch: "both", access: "Kassir", login: true },
  { name: "Ishlab chiqarish boshlig'i", count: 1, salary: 14_000_000, branch: "main", access: "Ishlab chiqarish", login: true },
  { name: "Texnolog", count: 2, salary: 10_000_000, branch: "main", access: "Ishlab chiqarish", login: true },
  { name: "Smena boshlig'i", count: 3, salary: 8_500_000, branch: "main", access: "Ishlab chiqarish", login: true },
  { name: "Liniya operatori", count: 30, salary: 5_500_000, branch: "main" },
  { name: "Qadoqlovchi", count: 15, salary: 4_500_000, branch: "main" },
  { name: "Omborchi", count: 3, salary: 7_000_000, branch: "both", access: "Omborchi", login: true },
  { name: "Yuk ortuvchi", count: 8, salary: 4_200_000, branch: "both" },
  { name: "Haydovchi-yetkazib beruvchi", count: 8, salary: 6_000_000, branch: "both", access: "Yetkazib beruvchi", login: true },
  { name: "Savdo agenti", count: 10, salary: 4_000_000, branch: "both", access: "Savdo agenti", login: true },
  { name: "Supervayzer", count: 2, salary: 9_000_000, branch: "both", access: "Supervayzer", login: true },
  { name: "Ta'minotchi", count: 2, salary: 7_500_000, branch: "main", access: "Ta'minot", login: true },
  { name: "Sifat nazoratchisi", count: 3, salary: 6_500_000, branch: "main" },
  { name: "Mexanik-elektrik", count: 4, salary: 7_000_000, branch: "main" },
  { name: "Qorovul", count: 3, salary: 3_800_000, branch: "main" },
]

export const MALE_NAMES = [
  "Aziz", "Bekzod", "Dilshod", "Eldor", "Farrux", "G'ayrat", "Hasan", "Ibrohim", "Jasur", "Kamol", "Laziz", "Mansur",
  "Nodir", "Otabek", "Po'lat", "Rustam", "Sardor", "Temur", "Ulug'bek", "Vohid", "Xurshid", "Yusuf", "Zafar", "Sherzod",
  "Shoxrux", "Javlon", "Sanjar", "Botir", "Akmal", "Islom", "Jamshid", "Muhammad", "Abdulla", "Komil", "Sarvar", "Doniyor",
]
export const FEMALE_NAMES = [
  "Dilnoza", "Gulnora", "Malika", "Nigora", "Shahlo", "Zarina", "Madina", "Feruza", "Sevara", "Nilufar", "Kamola", "Mohira",
  "Barno", "Dildora", "Yulduz", "Munisa", "Sabina", "Nodira",
]
export const LAST_NAMES = [
  "Karimov", "Rahimov", "Toshmatov", "Yusupov", "Abdullayev", "Ergashev", "Nazarov", "Qodirov", "Sobirov", "Xolmatov",
  "Mirzayev", "Usmonov", "Aliyev", "Hamidov", "Saidov", "Jo'rayev", "Islomov", "Rasulov", "Murodov", "Tursunov",
  "Normatov", "Ismoilov", "Qosimov", "Valiyev", "Bozorov", "Haydarov", "Fayzullayev", "Shukurov", "Olimov", "Zokirov",
]

export const SHOP_WORDS = ["Baraka", "Oila", "Nur", "Diyor", "Sharq", "Lazzat", "Mega", "Asl", "Doston", "Orzu", "Bahor", "Farovon", "Yulduz", "Saxovat", "Ziyo", "Kamalak"]
export const STREETS = ["Bunyodkor", "Qatortol", "Chilonzor", "Amir Temur", "Shota Rustaveli", "Bog'ishamol", "Farg'ona yo'li", "Mustaqillik", "Registon", "Dagbitskaya"]
