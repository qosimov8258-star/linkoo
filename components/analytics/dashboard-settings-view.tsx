"use client"

import { Eye, Trash2, X } from "lucide-react"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { ReportEmpty, ReportSearchField } from "@/components/ref/report-kit"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useLanguage } from "@/lib/i18n/language-context"

type Dashboard = { id: number; name: string }

export function DashboardSettingsView() {
  const { t } = useLanguage()
  const router = useRouter(); const [items,setItems]=useState<Dashboard[]>([]); const [query,setQuery]=useState(""); const [editing,setEditing]=useState<Dashboard|null>(null); const [name,setName]=useState(""); const [dialogOpen,setDialogOpen]=useState(false); const [saving,setSaving]=useState(false)
  useEffect(()=>{let cancelled=false;fetch("/api/custom-dashboards").then(async r=>{if(!r.ok)throw new Error("failed");return (await r.json()) as Dashboard[]}).then(data=>{if(!cancelled)setItems(data)}).catch(()=>{});return()=>{cancelled=true}},[])
  const rows=useMemo(()=>items.filter(item=>item.name.toLowerCase().includes(query.toLowerCase())),[items,query])
  const openNew=()=>{setEditing(null);setName("");setDialogOpen(true)}
  const save=async()=>{
    if(!name.trim())return
    setSaving(true)
    try{
      if(editing){
        const response=await fetch(`/api/custom-dashboards/${editing.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()})})
        if(!response.ok){window.alert(t("Не удалось сохранить дашборд"));return}
        const saved=(await response.json()) as Dashboard
        setItems(x=>x.map(i=>i.id===saved.id?saved:i))
      }else{
        const response=await fetch("/api/custom-dashboards",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()})})
        if(!response.ok){window.alert(t("Не удалось создать дашборд"));return}
        const saved=(await response.json()) as Dashboard
        setItems(x=>[...x,saved])
      }
      setEditing(null);setName("");setDialogOpen(false)
    }catch{
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }finally{
      setSaving(false)
    }
  }
  const remove=async(id:number)=>{
    try{
      const response=await fetch(`/api/custom-dashboards/${id}`,{method:"DELETE"})
      if(!response.ok)return
      setItems(x=>x.filter(i=>i.id!==id))
    }catch{
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  return (
    <CatalogPageLayout>
      <section className="min-w-0 flex-1">
        <div className="flex h-[60px] items-center justify-between px-[15px]">
          <ReportSearchField value={query} onChange={setQuery} width={300} />
          <button onClick={openNew} className="mr-[3px] text-[13px] text-[#4f71dc]">{t("+ добавить дашборд")}</button>
        </div>
        <table className="w-full table-fixed border-collapse text-left text-[13px]">
          <thead className="bg-[#5d6474] text-white">
            <tr className="h-[50px]"><th className="w-[130px] px-[30px] font-semibold">№</th><th className="px-[5px] font-semibold">{t("Наименование")}</th><th className="w-[178px] font-semibold">{t("Просмотреть")}</th><th className="w-[178px] font-semibold">{t("Изменить")}</th><th className="w-[178px] font-semibold">{t("Удалить")}</th></tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={item.id} className={`h-[50px] ${index % 2 ? "bg-white" : "bg-[#f2f5f8]"}`}>
                <td className="px-[30px]">{item.id}</td>
                <td className="px-[5px]">{item.name}</td>
                <td><button onClick={() => router.push("/analytics/flexible-dashboard")} className="flex h-[30px] w-[141px] items-center justify-center rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95"><Eye className="mr-2 h-4 w-4" />{t("Просмотреть")}</button></td>
                <td><button onClick={() => { setEditing(item); setName(item.name); setDialogOpen(true) }} className="flex h-[30px] w-[154px] items-center justify-center rounded-[3px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95">{t("Изменить статус")}</button></td>
                <td><button onClick={() => remove(item.id)} className="flex h-[30px] w-[109px] items-center justify-center rounded-[3px] bg-[#fa8072] text-[13px] font-semibold text-white hover:brightness-95"><Trash2 className="mr-2 h-4 w-4" />{t("Удалить")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <ReportEmpty className="pb-[40px] pt-[120px]" text="По вашему запросу ничего не найдено" />}
      </section>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <section role="dialog" className="w-[620px] bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-9 py-6"><h2 className="text-[15px] font-bold uppercase">{editing ? t("Изменить дашборд") : t("Создать дашборд")}</h2><button onClick={() => { setEditing(null); setName(""); setDialogOpen(false) }}><X /></button></header>
            <div className="px-9 py-16"><label className="block border-b pb-2 text-[13px] font-semibold">{t("Наименование")} <span className="text-red-500">*</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className="mt-4 block w-full outline-none" /></label></div>
            <footer className="flex justify-end border-t px-9 py-5"><button disabled={!name.trim() || saving} onClick={save} className="rounded-[3px] bg-[#71ce87] px-5 py-3 text-[13px] font-bold text-white disabled:opacity-40">{saving ? t("СОХРАНЕНИЕ...") : t("СОХРАНИТЬ")}</button></footer>
          </section>
        </div>
      )}
    </CatalogPageLayout>
  )
}
