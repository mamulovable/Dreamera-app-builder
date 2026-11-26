import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { and, eq, ne } from "drizzle-orm"

import { billingPayments, creditTransactions, db, users } from "@/db"
import { endProPlan, grantMonthlyCredits } from "@/lib/billing/credits"

// Bachs hosted checkout for the Pro subscription.
// https://docs.bachs.io/build/use-cases/saas-subscriptions
// Money sent to Bachs is a decimal string. Access follows subscription webhooks, not the redirect.

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

const ACCESS_STATUSES = new Set(["trialing", "active", "past_due"])

type CheckoutSession = {
  checkout_id?: string
  checkout_url?: string
  status?: string
  payment_status?: string | null
  amount?: string
  currency?: string
  metadata?: Record<string, unknown>
  charge?: {
    subscription_id?: string | null
    invoice?: { invoice_id?: string; period_end?: string; subscription_id?: string | null } | null
  } | null
}

type SubscriptionPayload = {
  id?: string
  subscription_id?: string
  product_id?: string
  status?: string
  amount?: string
  currency?: string
  current_period_end?: string | null
  cancel_at_period_end?: boolean
  metadata?: Record<string, unknown>
  customer?: { customer_id?: string; id?: string; email?: string; name?: string } | null
  product?: { id?: string } | null
}

type InvoicePayload = {
  invoice_id?: string
  period_end?: string
  metadata?: Record<string, unknown>
  customer?: { customer_id?: string; email?: string } | null
  subscription?: { subscription_id?: string } | null
}

type WebhookEvent = {
  id?: string
  type?: string
  created_at?: string
  data?: SubscriptionPayload & InvoicePayload & { checkout_id?: string }
}

function appUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!base) return undefined
  let url: URL
  try {
    url = new URL(path, base.endsWith("/") ? base : `${base}/`)
  } catch {
    return undefined
  }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local")
  const privateNet = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
  if (local || privateNet || (url.protocol !== "https:" && url.protocol !== "http:")) return undefined
  return url.toString()
}

function config() {
  const apiKey = process.env.BACHS_API_KEY?.trim()
  const webhookSecret = process.env.BACHS_WEBHOOK_SECRET?.trim()
  const productId = process.env.BACHS_PRO_PRODUCT_ID?.trim()
  if (!apiKey || !productId) throw new BillingError("Payments aren't set up on this server yet.", 503)
  const configured = process.env.BACHS_API_URL?.trim().replace(/\/$/, "")
  const baseUrl = configured || (apiKey.startsWith("sk_live_") ? "https://api.bachs.io" : "https://sandbox-api.bachs.io")
  if (!apiKey.startsWith("sk_live_") && !apiKey.startsWith("sk_sandbox_") && !configured) {
    throw new BillingError("Payments aren't set up on this server yet.", 503)
  }
  return { apiKey, webhookSecret, productId, baseUrl }
}

/** HMAC-SHA256 of `{timestamp}.{rawBody}`, matching `X-Bachs-Signature-V2`. */
export function verifyBachsSignature(header: string | null, rawBody: string, secret: string, toleranceSeconds = 300) {
  if (!header || !secret) return false
  const parts = header.split(",").map((part) => {
    const index = part.indexOf("=")
    return index === -1 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()]
  })
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1])
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  return parts.some(([key, signature]) => {
    const given = signature.toLowerCase()
    if (key !== "v1" || given.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  })
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function decimalToMinor(amount: string | undefined) {
  if (!amount || !/^\d+(\.\d+)?$/.test(amount)) return 0
  const [whole, fraction = ""] = amount.split(".")
  const minor = Number(whole) * 100 + Number((fraction + "00").slice(0, 2))
  return Number.isSafeInteger(minor) ? minor : 0
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function bachsFetch<T>(path: string, init?: { method?: string; body?: string; idempotencyKey?: string }): Promise<T> {
  const { apiKey, baseUrl } = config()
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init?.body,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (cause) {
    console.error("Bachs request failed", path, cause)
    throw new BillingError("We couldn't reach our payment provider. Please try again.", 502)
  }
  const payload = (await response.json().catch(() => null)) as (T & { error_code?: string }) | null
  if (!response.ok || !payload) {
    console.error("Bachs request failed", path, response.status, payload?.error_code)
    throw new BillingError("We couldn't reach our payment provider. Please try again.", 502)
  }
  return payload
}

async function loadUser(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  return user
}

function customerIdOf(customer: SubscriptionPayload["customer"]) {
  return customer?.customer_id || customer?.id || ""
}

function subscriptionFrom(payload: SubscriptionPayload) {
  return {
    subscriptionId: payload.subscription_id || payload.id || "",
    customerId: customerIdOf(payload.customer),
    email: payload.customer?.email || "",
    productId: payload.product_id || payload.product?.id || "",
    status: payload.status || "",
    currentPeriodEnd: payload.current_period_end ?? null,
    cancelAtPeriodEnd: payload.cancel_at_period_end === true,
    metadata: payload.metadata ?? {},
    amount: payload.amount,
    currency: payload.currency,
  }
}

async function findUser(hints: { userId?: string; customerId?: string; subscriptionId?: string; email?: string }) {
  if (hints.userId && /^\d+$/.test(hints.userId)) {
    const user = await loadUser(Number(hints.userId))
    if (user) return user
  }
  if (hints.subscriptionId) {
    const [user] = await db.select().from(users).where(eq(users.stripeSubscriptionId, hints.subscriptionId))
    if (user) return user
  }
  if (hints.customerId) {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, hints.customerId))
    if (user) return user
  }
  if (hints.email) {
    const [user] = await db.select().from(users).where(eq(users.email, hints.email))
    if (user) return user
  }
  return null
}

/** Saves the subscription Bachs sent. A repeated or older event changes nothing. */
async function applySubscription(payload: SubscriptionPayload, eventAt: Date) {
  const state = subscriptionFrom(payload)
  if (!state.subscriptionId) return
  const { productId } = config()
  if (state.productId && state.productId !== productId) {
    console.error("Bachs subscription is for a different product", state.subscriptionId)
    return
  }
  const user = await findUser({
    userId: asString(state.metadata.user_id),
    customerId: state.customerId,
    subscriptionId: state.subscriptionId,
    email: state.email,
  })
  if (!user) {
    console.error("Bachs subscription has no user", state.subscriptionId)
    return
  }

  const keepsAccess = ACCESS_STATUSES.has(state.status)
  const periodEnd = parseDate(state.currentPeriodEnd)
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(users).where(eq(users.id, user.id)).for("update")
    if (!locked) return
    if (locked.billingSyncedAt && locked.billingSyncedAt > eventAt) return

    if (keepsAccess) {
      await tx
        .update(users)
        .set({
          plan: "pro",
          currentPeriodEnd: periodEnd ?? locked.currentPeriodEnd,
          cancelAtPeriodEnd: state.cancelAtPeriodEnd,
          stripeCustomerId: state.customerId || locked.stripeCustomerId,
          stripeSubscriptionId: state.subscriptionId,
          billingSyncedAt: eventAt,
        })
        .where(eq(users.id, locked.id))
      return
    }

    const removed = locked.monthlyCredits
    await tx
      .update(users)
      .set({
        plan: "free",
        monthlyCredits: 0,
        stripeSubscriptionId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        stripeCustomerId: state.customerId || locked.stripeCustomerId,
        billingSyncedAt: eventAt,
      })
      .where(eq(users.id, locked.id))
    if (removed === 0) return
    await tx
      .insert(creditTransactions)
      .values({
        userId: locked.id,
        amount: -removed,
        balanceAfter: locked.credits,
        reason: "plan-ended",
        reference: `bachs:ended:${state.subscriptionId}`,
      })
      .onConflictDoNothing()
  })

  const checkoutId = asString(state.metadata.checkout_id)
  if (keepsAccess && checkoutId) {
    await db
      .update(billingPayments)
      .set({
        status: "success",
        orderNo: state.subscriptionId,
        paidAt: eventAt,
        ...(state.amount ? { amount: decimalToMinor(state.amount) } : {}),
        ...(state.currency ? { currency: state.currency.toUpperCase() } : {}),
      })
      .where(eq(billingPayments.reference, checkoutId))
  }
}

async function applyInvoicePaid(invoice: InvoicePayload) {
  const invoiceId = invoice.invoice_id
  if (!invoiceId) return
  const subscriptionId = invoice.subscription?.subscription_id || ""
  let payload: SubscriptionPayload | null = null
  if (subscriptionId) {
    payload = await bachsFetch<SubscriptionPayload>(`/v1/subscriptions/${subscriptionId}`)
  }
  const state = payload ? subscriptionFrom(payload) : null
  const user = await findUser({
    userId: asString(invoice.metadata?.user_id) || asString(state?.metadata.user_id),
    customerId: invoice.customer?.customer_id || state?.customerId,
    subscriptionId,
    email: invoice.customer?.email || state?.email,
  })
  if (!user) {
    console.error("Bachs invoice has no user", invoiceId)
    return
  }
  if (state?.productId && state.productId !== config().productId) {
    console.error("Bachs invoice is for a different product", invoiceId)
    return
  }
  await grantMonthlyCredits(user.id, `bachs:${invoiceId}`)
  if (payload) await applySubscription(payload, new Date())
}

async function portalUrl(customerId: string) {
  const session = await bachsFetch<{ url?: string }>(`/v1/customers/${customerId}/portal-sessions`, {
    method: "POST",
    idempotencyKey: `portal-${customerId}-${Date.now().toString(36)}`,
  })
  if (!session.url) throw new BillingError("We couldn't open billing. Please try again.", 502)
  return session.url
}

/** Where to send someone to subscribe, or to the portal when they already do. */
export async function createCheckoutUrl(userId: number) {
  const user = await loadUser(userId)
  if (!user) throw new BillingError("Please sign in to continue.", 401)
  if (user.plan === "pro" && user.stripeCustomerId?.startsWith("cust_") && user.stripeSubscriptionId?.startsWith("sub_")) {
    return portalUrl(user.stripeCustomerId)
  }
  const { productId } = config()
  const reference = `pro_${user.id}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`
  const name = user.name?.trim()
  const customer = user.stripeCustomerId?.startsWith("cust_")
    ? { customer_id: user.stripeCustomerId }
    : { email: user.email, ...(name ? { name } : {}) }
  const successUrl = appUrl("/pricing")
  const cancelUrl = appUrl("/pricing?checkout=cancel")
  const checkout = await bachsFetch<CheckoutSession>("/v1/checkout-sessions", {
    method: "POST",
    idempotencyKey: reference,
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer,
      billing_currency: "USD",
      metadata: { user_id: String(user.id) },
      reference,
      ...(successUrl ? { success_url: successUrl } : {}),
      ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
    }),
  })
  if (!checkout.checkout_url || !checkout.checkout_id) {
    console.error("Bachs checkout was not created")
    throw new BillingError("We couldn't open the checkout. Please try again.", 502)
  }
  await db
    .insert(billingPayments)
    .values({
      userId: user.id,
      reference: checkout.checkout_id,
      amount: decimalToMinor(checkout.amount),
      currency: (checkout.currency || "USD").toUpperCase(),
      status: "pending",
    })
    .onConflictDoNothing()
  return checkout.checkout_url
}

/** Opens the customer portal when Bachs already knows this person, otherwise starts checkout. */
export async function manageBillingUrl(userId: number) {
  const user = await loadUser(userId)
  if (!user) throw new BillingError("Please sign in to continue.", 401)
  if (user.stripeCustomerId?.startsWith("cust_")) return portalUrl(user.stripeCustomerId)
  return createCheckoutUrl(userId)
}

/** Reads the checkout from Bachs and applies it. Safe to call more than once. The redirect alone is not trusted. */
export async function confirmCheckout(userId: number, checkoutId: string) {
  if (!/^chk_[A-Za-z0-9_-]+$/.test(checkoutId)) return { status: "unknown" as const }
  const session = await bachsFetch<CheckoutSession>(`/v1/checkout-sessions/${checkoutId}`)
  if (asString(session.metadata?.user_id) !== String(userId)) return { status: "unknown" as const }

  const terminal = session.status === "expired" || session.status === "cancelled" || session.payment_status === "canceled"
  if (terminal) {
    await db
      .update(billingPayments)
      .set({ status: "failed" })
      .where(and(eq(billingPayments.reference, checkoutId), ne(billingPayments.status, "success")))
    return { status: "failed" as const }
  }

  const paid = session.status === "completed" || session.payment_status === "succeeded"
  if (!paid) return { status: "pending" as const }

  const subscriptionId = session.charge?.subscription_id || session.charge?.invoice?.subscription_id
  if (subscriptionId) {
    const subscription = await bachsFetch<SubscriptionPayload>(`/v1/subscriptions/${subscriptionId}`)
    await applySubscription(subscription, new Date())
  }
  const [user] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId))
  if (user?.plan !== "pro") return { status: "pending" as const }
  if (subscriptionId) {
    await db
      .update(billingPayments)
      .set({ status: "success", orderNo: subscriptionId, paidAt: new Date() })
      .where(eq(billingPayments.reference, checkoutId))
  }
  const invoiceId = session.charge?.invoice?.invoice_id
  if (invoiceId) await grantMonthlyCredits(userId, `bachs:${invoiceId}`)
  return { status: "success" as const }
}

/**
 * Checks that a delivery really is from Bachs, then updates the subscription or the month's credits.
 * A 5xx answer makes Bachs send the event again. A bad signature is not retried.
 */
export async function handleBachsWebhook(raw: string, headers: Headers) {
  const { webhookSecret } = config()
  if (!webhookSecret) throw new BillingError("Payments aren't set up on this server yet.", 503)
  const signature = headers.get("x-bachs-signature-v2")
  if (!verifyBachsSignature(signature, raw, webhookSecret)) throw new BillingError("Bad signature.", 400)

  let event: WebhookEvent
  try {
    event = JSON.parse(raw) as WebhookEvent
  } catch {
    throw new BillingError("Invalid callback.", 400)
  }
  const eventAt = parseDate(event.created_at) ?? new Date()
  const data = event.data
  if (!data) return

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(data, eventAt)
      return
    case "invoice.paid":
      await applyInvoicePaid(data)
      return
    case "invoice.payment_failed":
      console.error("Bachs renewal payment failed", data.invoice_id, data.subscription?.subscription_id)
      return
    case "checkout.expired":
      if (data.checkout_id) {
        await db
          .update(billingPayments)
          .set({ status: "failed" })
          .where(and(eq(billingPayments.reference, data.checkout_id), ne(billingPayments.status, "success")))
      }
      return
    default:
      return
  }
}

/**
 * Schedules Pro to end with Bachs when the paid period is over, or takes that back.
 * Undoing a scheduled cancellation is done in the customer portal. Bachs has no resume call.
 */
export async function setDowngrade(userId: number, cancelAtPeriodEnd: boolean) {
  const user = await loadUser(userId)
  if (!user) throw new BillingError("Please sign in to continue.", 401)
  if (user.plan !== "pro") throw new BillingError("You're already on Free.", 409)

  if (user.stripeSubscriptionId?.startsWith("sub_")) {
    if (!cancelAtPeriodEnd) {
      if (!user.stripeCustomerId?.startsWith("cust_")) {
        throw new BillingError("We couldn't open billing. Please try again.", 502)
      }
      return { url: await portalUrl(user.stripeCustomerId) }
    }
    const subscription = await bachsFetch<SubscriptionPayload>(`/v1/subscriptions/${user.stripeSubscriptionId}`, {
      method: "DELETE",
      body: JSON.stringify({ cancel_at_period_end: true, reason: "Customer requested" }),
    })
    await applySubscription(subscription, new Date())
    return {}
  }

  if (user.currentPeriodEnd && user.currentPeriodEnd.getTime() <= Date.now()) {
    await endProPlan(user.id, `ended:period:${user.currentPeriodEnd.toISOString()}`)
    return {}
  }
  await db.update(users).set({ cancelAtPeriodEnd }).where(eq(users.id, user.id))
  return {}
}
