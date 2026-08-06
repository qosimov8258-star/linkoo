"use client"

import Image from "next/image"
import { Search, X } from "lucide-react"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

const menu = [
  ["Персонал", "Подписки", "Сотрудники", "Смены", "Должности", "Права доступа", "Транспорт", "Сессия"],
  ["Финансы", "Валюты", "Кассы", "Категории приходов", "Категории расходов"],
  ["Продукты", "Типы продуктов", "Измерения", "Бренд", "Атрибуты", "Значение атрибута", "Продукты конкурентов"],
  ["Клиенты", "Типы клиентов", "Атрибуты", "Значение атрибута", "Категория магазина"],
  ["Конструкторы", "Конструктор документов", "Дашборды", "Настройка EXCEL заказов"],
  ["Поставщики", "Категории поставщиков"],
  ["Склад", "Склады", "Настройка чека", "Тип ячейки", "Ячейки"],
  ["Разное", "Прайс-листы", "Тип отказа", "Филиалы", "Оборудования", "Организация", "Объединение", "Ограничение времени", "Закрытия дня/месяца", "Интеграция", "Уведомления"],
]
type Dashboard = { id: number; name: string }

export function DashboardSettingsView() {
  const router = useRouter(); const [items,setItems]=useState<Dashboard[]>([]); const [query,setQuery]=useState(""); const [editing,setEditing]=useState<Dashboard|null>(null); const [name,setName]=useState(""); const [dialogOpen,setDialogOpen]=useState(false)
  const rows=useMemo(()=>items.filter(item=>item.name.toLowerCase().includes(query.toLowerCase())),[items,query])
  const openNew=()=>{setEditing(null);setName("");setDialogOpen(true)}; const save=()=>{if(!name.trim())return;if(editing)setItems(x=>x.map(i=>i.id===editing.id?{...i,name:name.trim()}:i));else setItems(x=>[...x,{id:Date.now(),name:name.trim()}]);setEditing(null);setName("");setDialogOpen(false)}
  const isDialog=dialogOpen
  return <main className="min-h-[calc(100vh-16px)] bg-white text-[#263246]"><div className="flex"><aside className="h-[calc(100vh-64px)] w-[280px] shrink-0 overflow-y-auto bg-[#f1f4f8] px-9 py-9">{menu.map(([title,...links])=><section key={title} className="mb-8"><h2 className="mb-3 font-bold">{title}</h2><div className="space-y-3 pl-8">{links.map(link=><button key={link} onClick={()=>{if(link==="Тип отказа")router.push("/analytics/refusal-types")}} className={`block text-left leading-4 hover:text-[#4868e8] ${link==="Дашборды"?"text-[#4868e8]":""}`}>{link}</button>)}</div></section>)}</aside><section className="min-w-0 flex-1"><div className="flex items-center justify-between px-5 py-6"><label className="relative w-[375px]"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4868e8]"/><Search className="absolute right-2 top-2 text-slate-300"/></label><button onClick={openNew} className="text-lg text-[#4868e8]">+ добавить дашборд</button></div><table className="w-full text-left"><thead className="bg-[#626b7e] text-white"><tr><th className="px-10 py-5">№</th><th className="px-5 py-5">Наименование</th><th className="px-5 py-5">Просмотреть</th><th className="px-5 py-5">Изменить</th><th className="px-5 py-5">Удалить</th></tr></thead><tbody>{rows.map((item,index)=><tr key={item.id} className="border-b"><td className="px-10 py-4">{index+1}</td><td className="px-5 py-4">{item.name}</td><td className="px-5 py-4"><button onClick={()=>router.push("/analytics/flexible-dashboard")} className="text-[#4868e8]">Просмотреть</button></td><td className="px-5 py-4"><button onClick={()=>{setEditing(item);setName(item.name)}} className="text-[#4868e8]">Изменить</button></td><td className="px-5 py-4"><button onClick={()=>setItems(x=>x.filter(i=>i.id!==item.id))} className="text-red-500">Удалить</button></td></tr>)}</tbody></table>{!rows.length&&<div className="flex h-[590px] flex-col items-center justify-center"><Image src="/robot-mascot.png" alt="Нет данных" width={160} height={160}/><p className="mt-5 text-[#657089]">По вашему запросу ничего не найдено</p></div>}</section></div>{isDialog&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><section role="dialog" className="w-[620px] bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-9 py-6"><h2 className="font-bold uppercase">{editing?"Изменить дашборд":"Создать дашборд"}</h2><button onClick={()=>{setEditing(null);setName("")}}><X/></button></header><div className="px-9 py-16"><label className="block border-b pb-2 font-semibold">Наименование <span className="text-red-500">*</span><input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} className="mt-4 block w-full outline-none"/></label></div><footer className="flex justify-end border-t px-9 py-5"><button disabled={!name.trim()} onClick={save} className="rounded bg-[#6ccd8b] px-5 py-3 font-bold text-white disabled:opacity-40">СОХРАНИТЬ</button></footer></section></div>}</main>
}
