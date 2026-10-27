export type PromoSeed = { id: number; name: string; start: string; end: string; type: string; active: boolean }

/** No promotion is stored yet (there is no promotions API): the list starts empty instead of
 * showing another company's demo promotions. */
export const PROMO_SEED: PromoSeed[] = []
