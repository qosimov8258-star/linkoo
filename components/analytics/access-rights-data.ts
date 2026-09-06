export type Permission = { id: number; category: string; type: string; label: string; code: string }

export type Capability = { id: number; name: string; permissionIds: number[] }

export type AccessRight = { id: number; name: string; capabilityIds: number[] }
