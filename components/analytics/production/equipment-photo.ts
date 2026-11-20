// The photo of a machine (Этапы производства → Оборудование, Настройки → «Оборудования»).
//
// Linko's photo zone takes JPEG and PNG only (accept="image/jpeg, image/png") and uploads the file. Mezon sends the
// picture inside the JSON of the save, and the API takes at most 2 MB per request (proxy.ts), which a photo of about
// 1.5 MB already exceeds once it is base64 text. So a picture is sent as it is while it fits, and otherwise scaled
// down (longest side ≤ 1600 px) and re-encoded until it does: any camera photo can be saved.

/** The file types the photo zone takes (the file input's `accept`). */
export const EQUIPMENT_PHOTO_ACCEPT = "image/jpeg, image/png"

const TYPES = new Set(["image/jpeg", "image/png"])
const MAX_SIDE = 1600
/** The data URL a save may carry: well under the 2 MB request limit, with room for the rest of the JSON. */
const MAX_DATA_URL = 1_400_000

/** A refused photo; the message is a Russian i18n key. */
export class EquipmentPhotoError extends Error {}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new EquipmentPhotoError("Не удалось прочитать файл"))
    reader.readAsDataURL(file)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new EquipmentPhotoError("Неверный формат изображения"))
    image.src = url
  })
}

/** The picked or dropped file as the data URL to save (see the header); refuses other types at once. */
export async function readEquipmentPhoto(file: File): Promise<string> {
  if (!TYPES.has(file.type)) throw new EquipmentPhotoError("Неверный формат изображения")
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    const longest = Math.max(width, height, 1)
    if (longest <= MAX_SIDE) {
      const original = await readDataUrl(file)
      if (original.length <= MAX_DATA_URL) return original
    }
    // A PNG may be transparent: WebP keeps that (a browser without WebP gives PNG, still accepted by the API).
    const type = file.type === "image/png" ? "image/webp" : "image/jpeg"
    let side = Math.min(MAX_SIDE, longest)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const scale = side / longest
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext("2d")
      if (!context) break
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL(type, 0.85)
      if (data.length <= MAX_DATA_URL) return data
      side = Math.round(side * 0.75)
    }
    throw new EquipmentPhotoError("Изображение слишком большое")
  } finally {
    URL.revokeObjectURL(url)
  }
}
