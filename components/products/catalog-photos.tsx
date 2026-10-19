"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react"

import { CashModal, PrimaryButton } from "@/components/analytics/cash-management-shared"
import { catalogMutate, errorText, imageUrl } from "@/components/products/catalog-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { CATALOG_API, type CatalogImage, type CatalogKind } from "@/lib/products-types"

// Demo ProductAddPhotoDialog (module 2223: "Добавить фото", Изображения, "Основное фото")
// and the slideshow (module 1619: ‹ ›, "Сделать основным", "Удалить").

/** Picture → JPEG data URL, longest side ≤ 1600 px. */
async function resizeImage(file: File, max = 1600): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image()
      element.onload = () => resolve(element)
      element.onerror = reject
      element.src = url
    })
    const scale = Math.min(1, max / Math.max(image.width, image.height, 1))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function AddPhotoDialog({ kind, itemId, onClose, onSaved }: { kind: CatalogKind; itemId: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [primary, setPrimary] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  const save = async () => {
    if (!files.length) return setError(t("Выберите изображение"))
    setBusy(true)
    setError("")
    for (const [index, file] of files.entries()) {
      const data = await resizeImage(file).catch(() => "")
      if (!data) {
        setBusy(false)
        return setError(t("Неверный формат изображения"))
      }
      const result = await catalogMutate("POST", `${CATALOG_API[kind]}/${itemId}/images`, { image: data, isPrimary: primary && index === 0 })
      if (!result.ok) {
        setBusy(false)
        return setError(errorText(result, t))
      }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <CashModal
      title={t("Добавить фото")}
      onClose={onClose}
      size="md"
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <PrimaryButton busy={busy} onClick={() => void save()}>
            {t("Сохранить")}
          </PrimaryButton>
        </>
      }
    >
      <p className="mb-2 text-[13px] text-[#586174]">{t("Изображения")}</p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex min-h-[160px] w-full flex-wrap items-center justify-center gap-2 rounded-md border-2 border-dashed border-[#dbe0e8] p-3 text-[#9aa3b6] hover:border-[#4f71dc]"
      >
        {previews.length ? (
          // eslint-disable-next-line @next/next/no-img-element
          previews.map((src) => <img key={src} src={src} alt="" className="h-24 w-24 rounded object-cover" />)
        ) : (
          <span className="flex flex-col items-center gap-2">
            <ImagePlus className="h-8 w-8" />
            {t("Добавьте файл или нажмите для выбора")}
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(event) => {
          setFiles([...(event.target.files ?? [])].slice(0, 10))
          event.target.value = ""
        }}
      />
      <label className="mt-3 flex items-center gap-2 text-[14px]">
        <input type="checkbox" checked={primary} onChange={(event) => setPrimary(event.target.checked)} className="h-4 w-4 accent-[rgb(79,113,220)]" />
        {t("Основное фото")}
      </label>
    </CashModal>
  )
}

export function SlideshowDialog({
  kind,
  itemId,
  images,
  start,
  canEdit,
  onClose,
  onChanged,
  notify,
}: {
  kind: CatalogKind
  itemId: number
  images: CatalogImage[]
  start: number
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t } = useLanguage()
  const [index, setIndex] = useState(Math.min(start, Math.max(0, images.length - 1)))
  const [busy, setBusy] = useState(false)
  const image = images[index]
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      if (event.key === "ArrowLeft") setIndex((value) => (value - 1 + images.length) % images.length)
      if (event.key === "ArrowRight") setIndex((value) => (value + 1) % images.length)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [images.length, onClose])
  if (!image) return null

  const act = async (method: "PUT" | "DELETE") => {
    setBusy(true)
    const result = await catalogMutate(method, `${CATALOG_API[kind]}/${itemId}/images/${image.id}`)
    setBusy(false)
    if (!result.ok) return notify(errorText(result, t), true)
    if (method === "DELETE") {
      notify(t("Изображение успешно удалено"))
      onClose()
    }
    onChanged()
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/85" onMouseDown={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white" onMouseDown={(event) => event.stopPropagation()}>
        <span className="text-[14px]">
          {index + 1} / {images.length}
        </span>
        <div className="flex items-center gap-2">
          {canEdit && !image.isPrimary && (
            <button type="button" disabled={busy} onClick={() => void act("PUT")} className="rounded-sm bg-[#4f71dc] px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50">
              {t("Сделать основным")}
            </button>
          )}
          {canEdit && (
            <button type="button" disabled={busy} onClick={() => void act("DELETE")} className="rounded-sm bg-[#e57373] px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50">
              {t("Удалить")}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="p-1">
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center p-4" onMouseDown={(event) => event.stopPropagation()}>
        {images.length > 1 && (
          <button
            type="button"
            onClick={() => setIndex((index - 1 + images.length) % images.length)}
            aria-label={t("Назад")}
            className="absolute left-3 rounded-full bg-white/20 p-2 text-white"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(kind, itemId, image.id)} alt="" className="max-h-[80vh] max-w-full object-contain" />
        {images.length > 1 && (
          <button type="button" onClick={() => setIndex((index + 1) % images.length)} aria-label={t("Вперед")} className="absolute right-3 rounded-full bg-white/20 p-2 text-white">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>
  )
}
