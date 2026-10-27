import "server-only"

import { NextResponse } from "next/server"

import { dbErrorResponse } from "@/lib/db-errors"

// Refusals of the field activity API. Messages are Russian i18n keys
// (personnel/i18n/field.json); `code` is a stable machine-readable reason for the mobile app.

export const FIELD_MESSAGES = {
  noEmployee: "Учетная запись не привязана к сотруднику",
  employeeNotFound: "Сотрудник не найден",
  clientNotFound: "Клиент не найден",
  orderNotFound: "Заказ не найден",
  orderOfOtherClient: "Заказ другого клиента",
  refusalTypeNotFound: "Тип отказа не найден",
  refusalReasonRequired: "Укажите тип отказа или комментарий",
  reportPhotosRequired: "Добавьте хотя бы одно фото",
  photoNotFound: "Фото не найдено",
  photoTaken: "Фото уже прикреплено",
  photoType: "Допустимы только фото JPEG, PNG или WebP",
  photoTooLarge: "Фото больше 1,5 МБ",
  photoEmpty: "Пустой файл",
  visitNotFound: "Визит не найден",
  visitOpen: "Сначала завершите текущий визит",
  visitFinished: "Визит уже завершен",
  visitKeyTaken: "Ключ уже использован для другого визита",
  finishBeforeStart: "Время завершения раньше начала визита",
  visitTooLong: "Визит не может длиться больше 24 часов",
  coordinatesRequired: "Для этого сотрудника обязательны координаты",
  coordinatesPair: "Укажите широту и долготу вместе",
  badCoordinates: "Неверные координаты",
  futureTime: "Время не может быть в будущем",
  tooOld: "Данные старше 31 дня не принимаются",
  badKey: "Неверный ключ",
  refusalRequired: "Укажите отказ",
  reportRequired: "Укажите фото отчет",
  badRange: "Дата начала позже даты окончания",
  rangeTooLong: "Период не может быть больше 366 дней",
  badTime: "Неверное время",
  weekdaysRequired: "Выберите дни недели",
  employeeInactive: "Сотрудник неактивен",
  notPlanned: "Клиент не в маршруте сотрудника",
} as const

export class FieldError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra: { field?: string; code?: string; [key: string]: unknown } = {},
  ) {
    super(message)
    this.name = "FieldError"
  }
}

/** JSON answer of a FieldError or a busy database; null for anything else (rethrow it). */
export function fieldErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof FieldError) return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
  return dbErrorResponse(error)
}
