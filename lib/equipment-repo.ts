import "server-only"

import { getProductionDb } from "@/lib/production-schema"
import {
  createEquipment as createStageEquipment,
  deleteEquipment as deleteStageEquipment,
  getEquipment as getStageEquipment,
  listEquipment as listStageEquipment,
  updateEquipment as updateStageEquipment,
  type ProductionEquipment,
} from "@/lib/production-stages-repo"

// Настройки → «Оборудования» (Linko #/equipment: Id | Наименование | Производство). Linko's settings page and
// the stage tab «Оборудование» read and write one list (manufacture/equipment/), so this is a view of the
// production equipment (lib/production-stages-repo.ts, table production_equipment): a machine added, renamed,
// moved or deleted here is the stage tab's machine, and the other way round. «Производство» is the stage; its
// options are the production stages themselves (Linko manufacture/manufacturing/).
// (The machines of the older separate `equipment` table were moved once, see lib/production-schema.ts.)

export type Equipment = { id: number; name: string; manufacturingId: number | null; manufacturing: string }
/** `photo`: where the picture is read (its URL), "" without one. */
export type EquipmentDetail = Equipment & { photo: string }
/** `photo` undefined keeps the stored picture, null / "" removes it, a data URL replaces it. */
export type EquipmentInput = { name: string; manufacturingId: number; photo: string | null | undefined }

export type Manufacturing = { id: number; name: string }

const toEquipment = (row: ProductionEquipment): Equipment => ({ id: row.id, name: row.name, manufacturingId: row.stageId, manufacturing: row.stageName })
const toDetail = (row: ProductionEquipment): EquipmentDetail => ({ ...toEquipment(row), photo: row.image })

/** Every stage's machines, newest first (as the stage tab lists them); `search` matches the name. */
export async function listEquipment(search = ""): Promise<Equipment[]> {
  const needle = search.trim().toLocaleLowerCase("ru")
  const rows = await listStageEquipment()
  return rows.filter((row) => !needle || row.name.toLocaleLowerCase("ru").includes(needle)).map(toEquipment)
}

export async function getEquipment(id: number): Promise<EquipmentDetail | null> {
  const row = await getStageEquipment(id)
  return row ? toDetail(row) : null
}

/** A new machine of the stage `manufacturingId` (Linko creates it «не работает»). */
export async function createEquipment(input: EquipmentInput): Promise<EquipmentDetail> {
  return toDetail(await createStageEquipment({ stageId: input.manufacturingId, name: input.name, image: input.photo ?? undefined }))
}

/** Name, stage (a move: refused while the machine is in use) and picture; the status stays. */
export async function updateEquipment(id: number, input: EquipmentInput): Promise<EquipmentDetail | null> {
  const row = await updateStageEquipment(id, { stageId: input.manufacturingId, name: input.name, image: input.photo === undefined ? undefined : (input.photo ?? "") })
  return row ? toDetail(row) : null
}

/** A machine in use stays: 409 «Удаление невозможно из-за связи с другими данными» with the usage list. */
export async function deleteEquipment(id: number): Promise<boolean> {
  return deleteStageEquipment(id)
}

/** The production stages, newest first (Linko manufacture/manufacturing/); `search` matches the name. */
export async function listManufacturings(search = ""): Promise<Manufacturing[]> {
  const db = await getProductionDb()
  const needle = search.trim().toLocaleLowerCase("ru")
  const rows = (await db.prepare("SELECT id, name FROM production_stages ORDER BY id DESC").all()) as Manufacturing[]
  return rows.filter((row) => !needle || row.name.toLocaleLowerCase("ru").includes(needle)).map((row) => ({ id: row.id, name: row.name }))
}
