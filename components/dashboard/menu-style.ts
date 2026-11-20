// Shared look of the top-bar mega menus (matches the reference app). As there, the 20px bottom gap belongs to the box
// (not to the columns), so the column dividers stop above it; the last row of a column has no rule; a hovered row is
// shaded across its whole width; the item text is bold Arial.
export const MENU_BOX =
  "mt-[7px] flex w-max max-w-[calc(100vw-1rem)] overflow-hidden rounded-[12px] bg-white pb-5 font-sans text-[#333] shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.24)]"
export const MENU_COLUMN = "min-w-0 px-5 pb-0 pt-5 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-[#f1f1f1]"
export const MENU_HEADING = "mb-[10px] ml-[10px] text-[13px] font-bold leading-4 text-[#1E4A9A]"
export const MENU_ITEM = "border-b border-[#f1f1f1] py-[5px] pl-[5px] last:border-b-0 hover:bg-[#F2F4F7]"
export const MENU_LINK =
  "block w-full p-[5px] text-left font-[Arial,Helvetica,sans-serif] text-[13px] font-bold leading-6 text-[#333]"
