/** `tags`: Linko's permission tags (Мобильный, Десктоп, Общее, CONFIGURATION), the «Тип» filter of the capability dialog. */
export type Permission = { id: number; category: string; type: string; label: string; code: string; categories: string[]; tags: string[] }

export type Capability = { id: number; name: string; permissionIds: number[] }

export type AccessRight = { id: number; name: string; capabilityIds: number[] }
