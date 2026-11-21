import { NextResponse } from "next/server"

import { BillingError, handleOpayWebhook } from "@/lib/billing/opay"

/** Called by OPay, not the browser. An error answer makes OPay send the callback again. */
export async function POST(request: Request) {
  try {
    await handleOpayWebhook(await request.text())
    return NextResponse.json({ received: true })
  } catch (cause) {
    if (cause instanceof BillingError) return new NextResponse(cause.message, { status: cause.status })
    console.error("Handling an OPay callback failed", cause)
    return new NextResponse("The webhook failed.", { status: 500 })
  }
}
