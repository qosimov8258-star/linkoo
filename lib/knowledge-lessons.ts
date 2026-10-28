import "server-only"

import seed from "@/lib/seed/knowledge-lessons.json"

// "База знаний" of the settings drawer (reference #/about): the product's user guide,
// a static copy of the lesson categories / lessons the reference loads from its billing service.

type Seed = { categories: { id: number; title: string; lessons: number[] }[]; lessons: Record<string, { title: string; content: string }> }
const data = seed as Seed

export type LessonCategory = { id: number; title: string; lessons: { id: number; title: string }[] }

export function listLessonCategories(): LessonCategory[] {
  return data.categories
    .map((category) => ({
      id: category.id,
      title: category.title,
      lessons: category.lessons.flatMap((id) => (data.lessons[String(id)] ? [{ id, title: data.lessons[String(id)].title }] : [])),
    }))
    .filter((category) => category.lessons.length > 0)
}

export function getLesson(id: number): { id: number; title: string; content: string } | null {
  const lesson = data.lessons[String(id)]
  return lesson ? { id, title: lesson.title, content: lesson.content } : null
}
