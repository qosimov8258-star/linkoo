"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

type Category = { id: number; title: string; lessons: { id: number; title: string }[] }
type Lesson = { id: number; title: string; content: string }

/** "База знаний" of the gear drawer (reference #/about): lesson list on the left, the chosen lesson on the right. */
export function AboutView() {
  const { t } = useLanguage()
  const [categories, setCategories] = useState<Category[]>([])
  const [lessonId, setLessonId] = useState<number | null>(null)
  const [lesson, setLesson] = useState<Lesson | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/knowledge-lessons", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Category[]) => {
        if (cancelled) return
        setCategories(data)
        setLessonId((current) => current ?? data[0]?.lessons[0]?.id ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (lessonId === null) return
    const controller = new AbortController()
    fetch(`/api/knowledge-lessons/${lessonId}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Lesson | null) => setLesson(data))
      .catch(() => {})
    return () => controller.abort()
  }, [lessonId])

  return (
    <main className="min-h-[calc(100vh-50px)] bg-white">
      <div className="flex min-h-[calc(100vh-50px)]">
        <aside className="hidden w-[225px] shrink-0 bg-[#f2f5f8] pb-6 pt-[30px] text-[13px] text-[#333] lg:block">
          {categories.map((category) => (
            <ul key={category.id} className="mx-[30px] mb-[20px] leading-[16.25px]">
              <li className="font-bold">{category.title}</li>
              {category.lessons.map((item) => (
                <li key={item.id} className="pl-[20px] pt-[10px] last:pb-[10px]">
                  <button type="button" onClick={() => { setLessonId(item.id); window.scrollTo({ top: 0 }) }} className="block py-px text-left leading-[15.2px] hover:text-[#4f71dc]">
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </aside>
        <section className="min-w-0 flex-1 px-[30px] pb-[40px] pt-[9px]">
          <div className="border-t border-[#e6e6e6]" />
          {lesson ? (
            <>
              <h2 className="mt-[15px] text-[19.5px] font-bold leading-6 text-[#333]">{lesson.title}</h2>
              {/* The lessons are a static, sanitised copy of the product guide. */}
              <div className="lesson-content mt-[30px] text-[13px] leading-[16.25px] text-[#333] [&_img]:max-w-full [&_p]:m-0 [&_strong]:font-bold" dangerouslySetInnerHTML={{ __html: lesson.content }} />
            </>
          ) : (
            <p className="mt-[30px] text-[#999]">{t("Загрузка...")}</p>
          )}
        </section>
      </div>
    </main>
  )
}
