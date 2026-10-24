import "server-only"

import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "@/lib/ref-records-repo"

// "Опросник": the list the reference shows (kind "survey" of the shared reference store, seeded in the reference order).

export type SurveyQuestion = {
  text: string
  type: string
  maxAnswers: string
  format: string
  orderNo: string
  required: boolean
  answers: string[]
}

export type SurveyFlags = { required: boolean; storeCheck: boolean; scoring: boolean; perfect: boolean }

export type Survey = {
  id: number
  name: string
  createdAt: string
  active: boolean
  organization: string
  storeType: string
  comment: string
  orderNo?: string
  flags?: SurveyFlags
  questions?: SurveyQuestion[]
}

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."]

function formatNow(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

export type SurveyInput = { name: string; active: boolean; organization: string; storeType: string; comment: string; orderNo: string; flags: SurveyFlags; questions: SurveyQuestion[] }

const str = (value: unknown) => (typeof value === "string" ? value : "")

function parseQuestions(value: unknown): SurveyQuestion[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const q = (item && typeof item === "object" ? item : {}) as Record<string, unknown>
    return {
      text: str(q.text),
      type: str(q.type),
      maxAnswers: str(q.maxAnswers),
      format: str(q.format),
      orderNo: str(q.orderNo),
      required: q.required === true,
      answers: Array.isArray(q.answers) ? q.answers.map(str) : [],
    }
  })
}

function parseFlags(value: unknown): SurveyFlags {
  const f = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  return { required: f.required === true, storeCheck: f.storeCheck === true, scoring: f.scoring === true, perfect: f.perfect === true }
}

export function parseSurveyInput(body: unknown): SurveyInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const active = typeof value.active === "boolean" ? value.active : true
  const organization = typeof value.organization === "string" ? value.organization : ""
  const storeType = typeof value.storeType === "string" ? value.storeType : ""
  const comment = typeof value.comment === "string" ? value.comment : ""
  return { name, active, organization, storeType, comment, orderNo: str(value.orderNo), flags: parseFlags(value.flags), questions: parseQuestions(value.questions) }
}

export async function listSurveys(): Promise<Survey[]> {
  return (await listRecords("survey")).map((record) => record.data as unknown as Survey)
}

export async function getSurvey(id: number): Promise<Survey | null> {
  const record = await getRecord("survey", String(id))
  return record ? (record.data as unknown as Survey) : null
}

export async function createSurvey(input: SurveyInput): Promise<Survey> {
  const record = await createRecord("survey", { ...input, createdAt: formatNow() })
  return record.data as unknown as Survey
}

export async function updateSurvey(id: number, input: SurveyInput): Promise<Survey | null> {
  const record = await updateRecord("survey", String(id), { ...input })
  return record ? (record.data as unknown as Survey) : null
}

export async function deleteSurvey(id: number): Promise<boolean> {
  return deleteRecord("survey", String(id))
}
