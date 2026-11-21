import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { addMonths } from "date-fns"
import { and, eq, ne } from "drizzle-orm"

import { billingPayments, creditTransactions, db, users } from "@/db"
import { PRO_MONTHLY_CREDITS } from "@/lib/plans"
import { endProPlan } from "@/lib/billing/credits"

// Everything that depends on OPay Cashier stays in this file.
// https://documentation.opaycheckout.com/cashier-create.html

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

const CREATE_PATH = "/api/v1/international/cashier/create"
const STATUS_PATH = "/api/v1/international/cashier/status"

type CashierOrder = {
  reference?: string
  orderNo?: string
  cashierUrl?: string
  status?: string
  amount?: { total?: number; currency?: string }
  isVoided?: boolean
}

type OpayEnvelope<T> = { code?: string; message?: string; data?: T }

type CallbackPayload = {
  amount?: unknown
  currency?: unknown
  reference?: unknown
  refunded?: unknown
  status?: unknown
  timestamp?: unknown
  token?: unknown
  transactionId?: unknown
}

function appUrl(path: string) {
  return new URL(path, process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").toString()
}

function config() {
  const merchantId = process.env.OPAY_MERCHANT_ID?.trim()
  const publicKey = process.env.OPAY_PUBLIC_KEY?.trim()
  const secretKey = process.env.OPAY_SECRET_KEY?.trim()
  const amount = Number(process.env.OPAY_PRO_AMOUNT)
  const currency = (process.env.OPAY_CURRENCY || "NGN").trim().toUpperCase()
  const country = (process.env.OPAY_COUNTRY || "NG").trim().toUpperCase()
  const mode = (process.env.OPAY_MODE || (process.env.NODE_ENV === "production" ? "live" : "sandbox")).trim().toLowerCase()
  if (!merchantId || !publicKey || !secretKey || !Number.isInteger(amount) || amount <= 0) {
    throw new BillingError("Payments aren't set up on this server yet.", 503)
  }
  if (!/^[A-Z]{3}$/.test(currency) || !/^[A-Z]{2}$/.test(country)) {
    throw new BillingError("Payments aren't set up on this server yet.", 503)
  }
  const live = mode === "live" || mode === "production"
  return {
    merchantId,
    publicKey,
    secretKey,
    amount,
    currency,
    country,
    baseUrl: live ? "https://liveapi.opaycheckout.com" : "https://testapi.opaycheckout.com",
  }
}

/** Compact JSON with keys sorted at every level. OPay signs that exact string. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`
}

function hmacHex(algorithm: string, data: string, secret: string) {
  return createHmac(algorithm, secret).update(data).digest("hex")
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a.toLowerCase())
  const right = Buffer.from(b.toLowerCase())
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * HMAC-SHA3-512 of the callback fields, in the order OPay documents.
 * Refunded is the letter t or f, and a missing token is an empty string.
 */
export function callbackSignature(
  payload: {
    amount: string
    currency: string
    reference: string
    refunded: boolean
    status: string
    timestamp: string
    token: string
    transactionId: string
  },
  secret: string
) {
  const content =
    `{Amount:"${payload.amount}",Currency:"${payload.currency}",Reference:"${payload.reference}",` +
    `Refunded:${payload.refunded ? "t" : "f"},Status:"${payload.status}",Timestamp:"${payload.timestamp}",` +
    `Token:"${payload.token}",TransactionID:"${payload.transactionId}"}`
  return hmacHex("sha3-512", content, secret)
}

function asString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

function asRefunded(value: unknown) {
  return value === true || value === "true" || value === "t"
}

async function opayPost<T>(path: string, body: string, authorization: string) {
  const { baseUrl, merchantId } = config()
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${authorization}`,
        MerchantId: merchantId,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (cause) {
    console.error("OPay request failed", path, cause)
    throw new BillingError("We couldn't reach our payment provider. Please try again.", 502)
  }
  const payload = (await response.json().catch(() => null)) as OpayEnvelope<T> | null
  if (!response.ok || !payload) {
    console.error("OPay request failed", path, response.status, payload?.code, payload?.message)
    throw new BillingError("We couldn't reach our payment provider. Please try again.", 502)
  }
  return payload
}

async function loadUser(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  return user
}

/** Where to send someone to pay for a month of Pro. Paying again extends the current period. */
export async function createCheckoutUrl(userId: number) {
  const user = await loadUser(userId)
  if (!user) throw new BillingError("Please sign in to continue.", 401)
  const { publicKey, amount, currency, country } = config()
  const reference = `pro${user.id}${Date.now().toString(36)}${randomBytes(4).toString("hex")}`
  const returnUrl = appUrl(`/pricing?checkout=success&reference=${encodeURIComponent(reference)}`)
  const body = canonicalJson({
    country,
    reference,
    amount: { total: amount, currency },
    returnUrl,
    callbackUrl: appUrl("/api/billing/webhook"),
    cancelUrl: appUrl("/pricing?checkout=cancel"),
    displayName: "Dreamera",
    customerVisitSource: "BROWSER",
    evokeOpay: true,
    expireAt: 30,
    userInfo: {
      userEmail: user.email,
      userId: String(user.id),
      userName: user.name || user.email,
    },
    product: {
      name: "Dreamera Pro",
      description: "One month of the Pro plan",
    },
  })

  await db.insert(billingPayments).values({ userId: user.id, reference, amount, currency, status: "pending" })
  let result: OpayEnvelope<CashierOrder>
  try {
    result = await opayPost<CashierOrder>(CREATE_PATH, body, publicKey)
  } catch (cause) {
    await db.delete(billingPayments).where(eq(billingPayments.reference, reference))
    throw cause
  }
  const cashierUrl = result.data?.cashierUrl
  if (result.code !== "00000" || !cashierUrl) {
    await db.delete(billingPayments).where(eq(billingPayments.reference, reference))
    console.error("OPay checkout was not created", result.code, result.message)
    throw new BillingError("We couldn't open the checkout. Please try again.", 502)
  }
  if (result.data?.orderNo) {
    await db.update(billingPayments).set({ orderNo: result.data.orderNo }).where(eq(billingPayments.reference, reference))
  }
  return cashierUrl
}

/** Asks OPay what happened to a payment, then applies it. Safe to call more than once. */
export async function confirmCheckout(userId: number, reference: string) {
  if (!/^[A-Za-z0-9]{8,64}$/.test(reference)) return { status: "unknown" as const }
  const [payment] = await db
    .select()
    .from(billingPayments)
    .where(and(eq(billingPayments.reference, reference), eq(billingPayments.userId, userId)))
  if (!payment) return { status: "unknown" as const }
  if (payment.status === "success") return { status: "success" as const }
  const order = await queryStatus(reference)
  await applyStatus(reference, order)
  const [next] = await db.select({ status: billingPayments.status }).from(billingPayments).where(eq(billingPayments.reference, reference))
  if (next?.status === "success") return { status: "success" as const }
  if (next?.status === "failed") return { status: "failed" as const }
  return { status: "pending" as const }
}

async function queryStatus(reference: string) {
  const { secretKey, country } = config()
  const body = canonicalJson({ country, reference })
  const signature = hmacHex("sha512", body, secretKey)
  const result = await opayPost<CashierOrder>(STATUS_PATH, body, signature)
  if (result.code !== "00000" || !result.data) {
    console.error("OPay status check failed", reference, result.code, result.message)
    throw new BillingError("We couldn't confirm the payment. Please try again.", 502)
  }
  return result.data
}

async function applyStatus(reference: string, order: CashierOrder) {
  const [payment] = await db.select().from(billingPayments).where(eq(billingPayments.reference, reference))
  if (!payment || payment.status === "success") return

  const status = order.status?.toUpperCase()
  const paid = status === "SUCCESS" && order.isVoided !== true
  const paidAmount = Number(order.amount?.total)
  const amountMatches = paidAmount === payment.amount && order.amount?.currency?.toUpperCase() === payment.currency
  if (paid && !amountMatches) {
    console.error("OPay payment amount did not match", reference, order.amount, payment.amount, payment.currency)
    throw new BillingError("The payment could not be confirmed.", 502)
  }
  if (paid) {
    await applyPaidPayment(reference, order.orderNo ?? null)
    return
  }
  if (status === "FAIL" || status === "CLOSE") {
    await db
      .update(billingPayments)
      .set({ status: "failed", orderNo: order.orderNo ?? payment.orderNo })
      .where(and(eq(billingPayments.reference, reference), ne(billingPayments.status, "success")))
  }
}

/** Gives the payer one more month of Pro and this month's credits. A repeated call changes nothing. */
async function applyPaidPayment(reference: string, orderNo: string | null) {
  await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(billingPayments).where(eq(billingPayments.reference, reference)).for("update")
    if (!payment || payment.status === "success") return
    const [user] = await tx.select().from(users).where(eq(users.id, payment.userId)).for("update")
    if (!user) return

    const now = new Date()
    const openPeriod = user.plan === "pro" && user.currentPeriodEnd && user.currentPeriodEnd > now ? user.currentPeriodEnd : now
    const periodEnd = addMonths(openPeriod, 1)
    await tx
      .update(users)
      .set({ plan: "pro", currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false })
      .where(eq(users.id, user.id))

    const saved = await tx
      .insert(creditTransactions)
      .values({
        userId: user.id,
        amount: PRO_MONTHLY_CREDITS - user.monthlyCredits,
        balanceAfter: user.credits + PRO_MONTHLY_CREDITS,
        reason: "renewal",
        reference: `opay:${payment.reference}`,
      })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id })
    if (saved.length > 0) {
      await tx.update(users).set({ monthlyCredits: PRO_MONTHLY_CREDITS }).where(eq(users.id, user.id))
    }
    await tx
      .update(billingPayments)
      .set({ status: "success", orderNo: orderNo ?? payment.orderNo, paidAt: now })
      .where(eq(billingPayments.id, payment.id))
  })
}

/**
 * Checks that a callback really is from OPay, then reads the payment again from OPay.
 * A non-2xx answer makes OPay send the callback again.
 */
export async function handleOpayWebhook(raw: string) {
  const { secretKey } = config()
  let body: { payload?: CallbackPayload; sha512?: unknown }
  try {
    body = JSON.parse(raw) as { payload?: CallbackPayload; sha512?: unknown }
  } catch {
    throw new BillingError("Invalid callback.", 400)
  }
  const payload = body.payload
  const fields = {
    amount: asString(payload?.amount),
    currency: asString(payload?.currency),
    reference: asString(payload?.reference),
    refunded: asRefunded(payload?.refunded),
    status: asString(payload?.status),
    timestamp: asString(payload?.timestamp),
    token: asString(payload?.token),
    transactionId: asString(payload?.transactionId),
  }
  if (!fields.reference || !fields.status || !fields.amount || typeof body.sha512 !== "string") {
    throw new BillingError("Invalid callback.", 400)
  }
  const expected = callbackSignature(fields, secretKey)
  if (!safeEqual(expected, body.sha512)) throw new BillingError("Bad signature.", 400)
  if (fields.refunded) {
    console.error("OPay reported a refund", fields.reference)
    return
  }

  const [payment] = await db.select().from(billingPayments).where(eq(billingPayments.reference, fields.reference))
  if (!payment) {
    console.error("OPay callback has no payment", fields.reference)
    return
  }
  if (payment.status === "success") return
  await applyStatus(fields.reference, await queryStatus(fields.reference))
}

/** Marks Pro to end when the paid month is over, or takes that back. Nothing is charged either way. */
export async function setDowngrade(userId: number, cancelAtPeriodEnd: boolean) {
  const user = await loadUser(userId)
  if (!user) throw new BillingError("Please sign in to continue.", 401)
  if (user.plan !== "pro") throw new BillingError("You're already on Free.", 409)
  if (user.currentPeriodEnd && user.currentPeriodEnd.getTime() <= Date.now()) {
    await endProPlan(user.id, `ended:period:${user.currentPeriodEnd.toISOString()}`)
    return
  }
  await db.update(users).set({ cancelAtPeriodEnd }).where(eq(users.id, user.id))
}
