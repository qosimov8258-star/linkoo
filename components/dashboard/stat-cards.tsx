const cards = [
  { title: "Продажи с 1 июля по 31 июля", value: "17,6 USD" },
  { title: "Оплаты с 1 июля по 31 июля", value: "12 050 000 SUM" },
  { title: "Возвраты с 1 июля по 31 июля", value: "20 000 SUM" },
  { title: "АКБ с 1 июля по 31 июля", value: "1" },
]

export function StatCards() {
  return (
    <div className="grid grid-cols-1 gap-6 px-6 pt-6 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className="min-h-[130px] rounded-lg bg-white px-6 py-5 shadow-sm"
        >
          <p className="text-[15px] text-slate-500">{card.title}</p>
          <p className="mt-3 text-3xl font-bold text-slate-800">{card.value}</p>
        </div>
      ))}
    </div>
  )
}
