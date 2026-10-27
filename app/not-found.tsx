import type { Metadata } from "next"

import { NotFoundContent, notFoundMetadata } from "@/components/not-found-content"

// Unknown URLs render here, inside the root layout with its menu, in the user's language instead of
// Next's English default.
export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata()
}

export default function NotFound() {
  return <NotFoundContent />
}
