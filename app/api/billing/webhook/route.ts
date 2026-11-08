import { NextResponse } from "next/server"
import Stripe from "stripe"

import { handleStripeWebhook } from "@/lib/billing/stripe"

/** Called by Stripe, not the browser. An error answer makes Stripe send the event again. */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature")
  if (!signature) return new NextResponse("Missing signature.", { status: 400 })
  try {
    await handleStripeWebhook(await request.text(), signature)
    return NextResponse.json({ received: true })
  } catch (cause) {
    if (cause instanceof Stripe.errors.StripeSignatureVerificationError) return new NextResponse("Bad signature.", { status: 400 })
    console.error("Handling a Stripe webhook failed", cause)
    return new NextResponse("The webhook failed.", { status: 500 })
  }
}
