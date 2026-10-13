"use client"
import { FileText, PlusCircle, Search, X } from "lucide-react"
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"

const initial: [number, string][] = []

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
}

export function ClientRestrictionsView(){
  const { t } = useLanguage();
  const[items,setItems]=useState(initial);const[q,setQ]=useState("");const[name,setName]=useState("");const[edit,setEdit]=useState<number|null>(null);const rows=useMemo(()=>items.filter(x=>x[1].toLowerCase().includes(q.toLowerCase())),[items,q]);
  useEffect(() => {
    let cancelled = false
    fetch("/api/client-restrictions")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить ограничения")
        return (await response.json()) as { id: number; name: string }[]
      })
      .then((data) => {
        if (!cancelled) setItems(data.map((item) => [item.id, item.name] as [number, string]))
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [])
  async function save() {
    if (!name.trim()) return
    try {
      if (edit !== null && edit !== -1) {
        const response = await fetch(`/api/client-restrictions/${edit}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as { id: number; name: string }
        setItems((x) => x.map((i) => (i[0] === edit ? [saved.id, saved.name] : i)))
      } else {
        const response = await fetch("/api/client-restrictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as { id: number; name: string }
        setItems((x) => [[saved.id, saved.name], ...x])
      }
      setName("")
      setEdit(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  function downloadTemplate() {
    downloadExcelTable("client-restrictions-template", [[t("Наименование")]])
  }
  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }
  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const excelRows = await readExcelRows(importFile)
      if (!excelRows.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(excelRows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? excelRows.slice(1) : excelRows
      const names: string[] = []
      for (const row of dataRows) {
        let value = ""
        if (hasHeader) {
          row.forEach((cell, index) => {
            if (fieldByIndex.get(index) === "name") value = cell
          })
        } else {
          value = row[0] ?? ""
        }
        if (!value.trim()) continue
        names.push(value.trim())
      }
      if (!names.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const created: [number, string][] = []
      let failed = 0
      for (const label of names) {
        try {
          const response = await fetch("/api/client-restrictions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: label }),
          })
          if (response.ok) {
            const saved = (await response.json()) as { id: number; name: string }
            created.push([saved.id, saved.name])
          } else {
            failed += 1
          }
        } catch {
          failed += 1
        }
      }
      if (created.length) setItems((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${names.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }
  return <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"><header className="mb-5 flex justify-between"><h1 className="text-2xl font-bold text-slate-600"><FavoritesButton className="text-[#4f71dc]" /> <span className="mx-2">|</span> {t("Ограничения по клиентам")}</h1><div className="flex items-center gap-3"><button onClick={()=>setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-5 py-3 font-semibold text-white hover:brightness-95"><FileText className="h-5 w-5"/>{t("Импорт с Excel")}</button><button onClick={()=>{setName("");setEdit(-1)}} className="rounded bg-[#71ce87] px-5 py-3 font-semibold text-white"><PlusCircle className="mr-2 inline h-5 w-5"/>{t("Добавить")}</button></div></header><section className="overflow-hidden rounded bg-white shadow"><div className="flex items-center px-5 py-3"><label className="relative w-60"><input value={q} onChange={e=>setQ(e.target.value)} placeholder={t("Поиск")} className="w-full border-b py-3 pr-10 outline-none"/><Search className="absolute right-2 top-3 text-slate-300"/></label><span className="ml-auto">25</span><span className="ml-10">1 - {rows.length} {t("из")} {rows.length}</span></div><table className="w-full text-left"><thead className="bg-[#5d6474] text-white"><tr><th className="px-9 py-5">№</th><th className="px-5 py-5">{t("Наименование")}</th></tr></thead><tbody>{rows.map(([id,label])=><tr key={id} className="border-b border-dashed border-slate-300 hover:bg-slate-50"><td className="px-12 py-5">{id}</td><td className="px-5 py-5"><button onClick={()=>{setEdit(id);setName(label)}} className="text-left hover:text-[#4f71dc]">{label}</button></td></tr>)}</tbody></table></section>{edit!==null&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"><div className="w-[560px] bg-white"><header className="flex justify-between border-b p-6"><b>{edit===-1?t("ДОБАВИТЬ ОГРАНИЧЕНИЕ"):t("ИЗМЕНИТЬ ОГРАНИЧЕНИЕ")}</b><button onClick={()=>setEdit(null)}><X/></button></header><div className="p-10"><label className="block border-b pb-2">{t("Наименование")} <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} className="mt-4 w-full outline-none"/></label></div><footer className="flex justify-end border-t p-5"><button onClick={save} className="rounded bg-[#71ce87] px-5 py-3 text-white">{t("СОХРАНИТЬ")}</button></footer></div></div>}
    {importOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="w-full max-w-md rounded bg-white">
          <header className="flex items-center justify-between border-b p-6">
            <b className="uppercase">{t("Импорт с Excel")}</b>
            <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
          </header>
          <div className="p-8">
            <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f71dc] hover:underline">1. {t("Скачать шаблон")}</button>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
            <button type="button" onClick={() => importInputRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f71dc] hover:text-[#4f71dc]">
              <FileText className="h-8 w-8" />
              {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
            </button>
          </div>
          <footer className="flex justify-end border-t p-5">
            <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#71ce87] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
              {importSaving ? t("Импорт...") : t("Сохранить")}
            </button>
          </footer>
        </div>
      </div>
    )}
  </main>
}
