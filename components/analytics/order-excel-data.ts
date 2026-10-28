// "Настройка EXCEL заказов" (demo #/order-excel-settings/, API saas/excel_code/): per Excel
// export layout (Накладные по заказам, …) which of its numbered columns are switched on.

export const ORDER_EXCEL_API = "/api/order-excel-settings"

export type OrderExcelCode = { code: string; isActive: boolean }
export type OrderExcelSetting = { id: number; name: string; key: string; codes: OrderExcelCode[] }
export type OrderExcelListResult = { count: number; results: OrderExcelSetting[] }
