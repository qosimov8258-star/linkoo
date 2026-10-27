import "server-only"

import { NextResponse } from "next/server"

import { fieldErrorResponse } from "@/lib/field-activity/errors"
import { LocationLockError } from "@/lib/tracking-location-locks"
import { TrackingRouteError } from "@/lib/tracking-route"

// Request plumbing of /api/tracking/** (the routes export only their handlers).

/** Runs a handler; known refusals and busy-database errors become their JSON answers. */
export async function trackingRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    if (error instanceof TrackingRouteError) {
      return NextResponse.json({ error: error.message, ...(error.field ? { field: error.field } : {}) }, { status: error.status })
    }
    if (error instanceof LocationLockError) {
      return NextResponse.json({ error: error.message, field: "clientIds", clientId: error.clientId }, { status: 400 })
    }
    const response = fieldErrorResponse(error)
    if (response) return response
    throw error
  }
}
