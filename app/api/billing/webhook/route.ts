import { NextResponse } from "next/server"

import { BillingError, handleBachsWebhook } from "@/lib/billing/bachs"

/** Called by Bachs, not the browser. A 5xx answer makes Bachs send the event again. */
export async function POST(request: Request) {
  try {
    await handleBachsWebhook(await request.text(), request.headers)
    return NextResponse.json({ received: true })
  } catch (cause) {
    if (cause instanceof BillingError) return new NextResponse(cause.message, { status: cause.status })
    console.error("Handling a Bachs webhook failed", cause)
    return new NextResponse("The webhook failed.", { status: 500 })
  }
}
