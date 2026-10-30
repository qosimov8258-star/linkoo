// Shapes of "Поставщики" (/api/suppliers). Categories, branches and organizations of a supplier come from
// their own lists (/api/supplier-categories, /api/branches, /api/organizations), never from fixed names.

export type SupplierContact = { id: number; name: string; email: string; phone: string }
export type SupplierProduct = { id: number; product: string; qty: number; price: number; currency?: string }
export type Supplier = {
  id: number
  name: string
  category: string
  createdDate: string
  address: string
  branch: string
  organization: string
  contacts: SupplierContact[]
  products: SupplierProduct[]
}
