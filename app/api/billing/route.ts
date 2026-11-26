import { NextResponse } from "next/server"

import { BillingError, confirmCheckout, createCheckoutUrl, manageBillingUrl, setDowngrade } from "@/lib/billing/bachs"
import { getCurrentUser } from "@/lib/session"

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Changes the signed-in person's plan. `upgrade` answers with the Bachs checkout,
 * or the customer portal when they already subscribe. `confirm` reads a checkout
 * they just came back from. `downgrade` schedules the end of Pro. `keep-pro`
 * takes that back, or opens the portal when Bachs is the one canceling.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)

  const body = (await request.json().catch(() => null)) as { action?: unknown; reference?: unknown } | null
  try {
    switch (body?.action) {
      case "upgrade":
        return NextResponse.json({ url: await createCheckoutUrl(user.id) })
      case "manage":
        return NextResponse.json({ url: await manageBillingUrl(user.id) })
      case "confirm":
        if (typeof body.reference !== "string") return error("Invalid request.", 400)
        return NextResponse.json(await confirmCheckout(user.id, body.reference))
      case "downgrade":
        return NextResponse.json({ ok: true, ...(await setDowngrade(user.id, true)) })
      case "keep-pro":
        return NextResponse.json({ ok: true, ...(await setDowngrade(user.id, false)) })
      default:
        return error("Invalid request.", 400)
    }
  } catch (cause) {
    if (cause instanceof BillingError) return error(cause.message, cause.status)
    console.error("Changing a plan failed", cause)
    return error("We couldn't reach our payment provider. Please try again.", 502)
  }
}
