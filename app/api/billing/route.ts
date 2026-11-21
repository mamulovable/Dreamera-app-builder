import { NextResponse } from "next/server"

import { BillingError, confirmCheckout, createCheckoutUrl, setDowngrade } from "@/lib/billing/opay"
import { getCurrentUser } from "@/lib/session"

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Changes the signed-in person's plan. `upgrade` answers with the OPay Cashier
 * page. `confirm` checks a payment they just came back from. `downgrade` and
 * `keep-pro` apply straight away.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)

  const body = (await request.json().catch(() => null)) as { action?: unknown; reference?: unknown } | null
  try {
    switch (body?.action) {
      case "upgrade":
      case "manage":
        return NextResponse.json({ url: await createCheckoutUrl(user.id) })
      case "confirm":
        if (typeof body.reference !== "string") return error("Invalid request.", 400)
        return NextResponse.json(await confirmCheckout(user.id, body.reference))
      case "downgrade":
        await setDowngrade(user.id, true)
        return NextResponse.json({ ok: true })
      case "keep-pro":
        await setDowngrade(user.id, false)
        return NextResponse.json({ ok: true })
      default:
        return error("Invalid request.", 400)
    }
  } catch (cause) {
    if (cause instanceof BillingError) return error(cause.message, cause.status)
    console.error("Changing a plan failed", cause)
    return error("We couldn't reach our payment provider. Please try again.", 502)
  }
}
