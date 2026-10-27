export type RefusalRow = { id: number; date: string; agent: string; client: string; reason: string }

/** Visit refusals are not recorded yet (no agent app / visit source), so the
 * list is empty instead of showing another company's demo refusals. */
export const REFUSALS_SEED: RefusalRow[] = []
