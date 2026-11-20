import "server-only"

import { z } from "zod"

import { SERIES_AUTO_TYPES } from "@/lib/client-returns-series-repo"
import { MAX_QTY } from "@/lib/orders-repo"

// Request schemas of the series routes of orders (messages are Russian i18n keys).

const MAX_ID = 2_147_483_647
const id = z.number({ error: "Неверный идентификатор" }).int({ error: "Неверный идентификатор" }).positive({ error: "Неверный идентификатор" }).max(MAX_ID, { error: "Неверный идентификатор" })

/** PUT /api/orders/[id]/series: the whole list of «Изменит серии» (it replaces the stored one). */
export const orderSeriesSetSchema = z.object({
  products: z
    .array(
      z.object({
        amount: z.number({ error: "Укажите количество" }).finite().gt(0, { error: "Количество должно быть больше 0" }).max(MAX_QTY, { error: "Количество слишком большое" }),
        orderItemId: id,
        seriesId: id,
      }),
    )
    .max(500, { error: "Слишком много позиций" }),
})

/** POST /api/orders/series/auto: «Авто распределение по сериям» of the open order or the ticked ones. */
export const orderSeriesAutoSchema = z.object({
  autoType: z.enum(SERIES_AUTO_TYPES as [string, ...string[]], { error: "Неверные данные" }),
  ids: z.array(id).min(1, { error: "Выберите заказ из списка" }).max(500, { error: "Слишком много заказов" }),
})
