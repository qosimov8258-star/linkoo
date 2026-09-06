export type TaskStatus = "in_progress" | "fulfilled" | "closed"

export type Task = {
  id: number
  responsible: string
  date: string
  store: string
  description: string
  status: TaskStatus
}

export const taskResponsibles = ["Admin Ritm", "Samandar Abdurahmonov", "Temur Raupov", "Fozil Agent"]
export const taskStores = ["Markus Vitinha", "Usman Dembele", "Ashraf Hakimi", "Doston market"]
export const taskStatusLabels: Record<TaskStatus, string> = { in_progress: "В процессе", fulfilled: "Выполнено", closed: "Завершенный" }

export function todayTaskLabel() {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date()).replace(".", "")
}
