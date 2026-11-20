// Shapes of "Поставщики" (/api/suppliers). Categories, branches and organizations of a supplier come from
// their own lists (/api/supplier-categories, /api/branches, /api/organizations), never from fixed names.

export type SupplierContact = { id: number; name: string; email: string; phone: string }
/** A line of «Добавить запас» (Linko's reserve_products): the product (its catalog id when known), its unit, the amount,
 * the cost and its currency, and whether the cost was «Указан вручную» (else the product's cost). */
export type SupplierProduct = { id: number; productId?: number | null; product: string; unit?: string; qty: number; price: number; currency?: string; manual?: boolean }
export type Supplier = {
  id: number
  name: string
  category: string
  createdDate: string
  /** The last change of the card (Linko's modified_date): its «Дата добавления». "YYYY-MM-DD HH:MM:SS". */
  modifiedDate: string
  address: string
  branch: string
  organization: string
  contacts: SupplierContact[]
  products: SupplierProduct[]
}
