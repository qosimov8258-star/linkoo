// Russian i18n keys of the bug-report API refusals (the panel and the admin pages pass them through t()).

export const BUG_MESSAGES = {
  tooMany: "Слишком много сообщений об ошибке. Подождите минуту",
  notMultipart: "Неверный формат запроса",
  commentShort: "Комментарий слишком короткий",
  commentLong: "Комментарий слишком длинный",
  screenshotTooLarge: "Скриншот слишком большой",
  screenshotType: "Скриншот должен быть в формате JPEG, PNG или WebP",
  contextTooLarge: "Контекст слишком большой",
  notFound: "Сообщение об ошибке не найдено",
  /** feedback / clarify on a report that does not wait for that answer (any more). */
  notWaiting: "Это сообщение уже не ожидает ответа",
  answerRequired: "Введите ответ",
  answerLong: "Ответ слишком длинный",
  analysisRunning: "Анализ уже выполняется",
  badStatus: "Неверный статус",
} as const
