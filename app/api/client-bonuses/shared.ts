import "server-only"

import { z } from "zod"

import { MAX_DB_ID } from "@/lib/strict-number"

// Shared fields of the /api/client-bonuses writers (not a route: App Router only serves route.ts files).

/** A record id: a positive int4 JSON number. */
export const recordId = z.number().int("Неверный идентификатор").min(1, "Неверный идентификатор").max(MAX_DB_ID, "Неверный идентификатор")

/** Balls of one score: a finite non-zero number within the app's money bound (negative takes balls away). */
export const ballValue = z
  .number()
  .refine((value) => Number.isFinite(value) && Math.abs(value) <= 1e13, "Слишком большое значение")
  .refine((value) => value !== 0, "Введите число больше нуля")
