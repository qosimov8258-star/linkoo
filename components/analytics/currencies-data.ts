export type Currency = {
  id: number
  name: string
  code: string
  rate: number
  isBase: boolean
  createdDate: string
  /** Raw "YYYY-MM-DD HH:MM:SS" of the latest rate change ("Дата обновления"). */
  rateDate: string
}

/** One row of "История обновления курса". */
export type CurrencyRate = { id: number; currencyId: number; rate: number; createdAt: string }

/** One row of the "Индивидуальный" tab. */
export type IndividualRate = { id: number; name: string; rate: number; beginDate: string; endDate: string; createdAt: string }
