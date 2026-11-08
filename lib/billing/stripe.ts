import Stripe from "stripe"
import { eq } from "drizzle-orm"

import { db, users, type User } from "@/db"
import { endProPlan, grantMonthlyCredits } from "@/lib/billing/credits"

// Everything that depends on the payment provider stays in this file.

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

let client: Stripe | null = null

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !process.env.STRIPE_PRO_PRICE_ID) throw new BillingError("Payments aren't set up on this AppForge server yet.", 503)
  return (client ??= new Stripe(key))
}

function appUrl(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").toString()
}

async function loadUser(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  return user
}

async function ensureCustomer(user: User) {
  if (user.stripeCustomerId) return user.stripeCustomerId
  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: String(user.id) },
  })
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, user.id))
  return customer.id
}

/** Where to send someone to pay for Pro. */
export async function createCheckoutUrl(userId: number) {
  const user = await loadUser(userId)
  const api = stripe()
  if (user.plan === "pro") throw new BillingError("You're already on Pro.", 409)
  const session = await api.checkout.sessions.create({
    mode: "subscription",
    customer: await ensureCustomer(user),
    client_reference_id: String(user.id),
    line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: appUrl("/pricing?checkout=success"),
    cancel_url: appUrl("/pricing"),
  })
  if (!session.url) throw new BillingError("We couldn't open the checkout. Please try again.", 502)
  return session.url
}

/** Where someone can change their card and see their invoices. */
export async function createPortalUrl(userId: number) {
  const user = await loadUser(userId)
  const api = stripe()
  if (!user.stripeCustomerId) throw new BillingError("You don't have any billing details yet.", 409)
  const session = await api.billingPortal.sessions.create({ customer: user.stripeCustomerId, return_url: appUrl("/pricing") })
  return session.url
}

/** Downgrades at the end of the paid period, or takes that back. */
export async function setDowngrade(userId: number, cancelAtPeriodEnd: boolean) {
  const user = await loadUser(userId)
  const api = stripe()
  if (!user.stripeSubscriptionId) throw new BillingError("You don't have a subscription to change.", 409)
  await syncSubscription(await api.subscriptions.update(user.stripeSubscriptionId, { cancel_at_period_end: cancelAtPeriodEnd }))
}

function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null)
}

// past_due keeps Pro while Stripe retries the card, but no new credits come until an invoice is paid.
const PRO_STATUSES: Stripe.Subscription.Status[] = ["active", "trialing", "past_due"]
// Nothing was decided yet in `incomplete`, so that one changes nothing.
const ENDED_STATUSES: Stripe.Subscription.Status[] = ["canceled", "unpaid", "incomplete_expired", "paused"]

/** Makes the person's plan match their subscription, and returns who they are. */
async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = idOf(subscription.customer)
  if (!customerId) return null
  const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId))
  if (!user) {
    console.error(`Stripe subscription ${subscription.id} has no user for customer ${customerId}`)
    return null
  }

  if (PRO_STATUSES.includes(subscription.status)) {
    const periodEnd = subscription.items.data[0]?.current_period_end
    await db
      .update(users)
      .set({
        plan: "pro",
        stripeSubscriptionId: subscription.id,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      })
      .where(eq(users.id, user.id))
  } else if (ENDED_STATUSES.includes(subscription.status) && user.stripeSubscriptionId === subscription.id) {
    // Only their current subscription: an old one ending doesn't take Pro away.
    await endProPlan(user.id, `ended:${subscription.id}`)
  }
  return user
}

/**
 * Checks that a webhook really is from Stripe, and applies it. Events can arrive
 * late, out of order, or twice, so what they're about is read again from Stripe.
 */
export async function handleStripeWebhook(raw: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new BillingError("STRIPE_WEBHOOK_SECRET isn't set.", 503)
  const api = stripe()
  const event = api.webhooks.constructEvent(raw, signature, secret)

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(await api.subscriptions.retrieve(event.data.object.id))
      break
    case "invoice.paid": {
      const invoice = await api.invoices.retrieve(event.data.object.id!)
      // A change to the subscription bills too, and that isn't a new month.
      if (invoice.billing_reason !== "subscription_create" && invoice.billing_reason !== "subscription_cycle") break
      const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription)
      if (!subscriptionId) break
      const user = await syncSubscription(await api.subscriptions.retrieve(subscriptionId))
      if (user) await grantMonthlyCredits(user.id, `invoice:${invoice.id}`)
      break
    }
  }
}
