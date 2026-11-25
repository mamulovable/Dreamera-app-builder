/** Fixed admin conversion from USD app cost into Nigerian naira. */
export const NGN_PER_USD = 1500

export type ModelTokenPrice = { input: number; output: number }

/** Model id → USD per 1 million input and output tokens. */
export type ModelPriceBook = Record<string, ModelTokenPrice>

export type ModelTokenUsage = {
  model: string
  inputTokens: number
  outputTokens: number
}

function priceFor(model: string, prices: ModelPriceBook, fallback: ModelTokenPrice): ModelTokenPrice {
  return prices[model] ?? fallback
}

/** Build cost from each model's own tokens and price, then app cost at twice that. */
export function appBuildCostFromModels(
  byModel: ModelTokenUsage[],
  prices: ModelPriceBook,
  fallback: ModelTokenPrice = { input: 0, output: 0 }
) {
  let build = 0
  for (const row of byModel) {
    const price = priceFor(row.model, prices, fallback)
    build +=
      (row.inputTokens / 1_000_000) * price.input + (row.outputTokens / 1_000_000) * price.output
  }
  const app = build * 2
  return { build, app, appNgn: app * NGN_PER_USD }
}

/** Flat-rate helper when tokens are not split by model. Prefer appBuildCostFromModels. */
export function appBuildCost(
  inputTokens: number,
  outputTokens: number,
  inputPricePerMillion: number,
  outputPricePerMillion: number
) {
  return appBuildCostFromModels(
    [{ model: "_", inputTokens, outputTokens }],
    {},
    { input: inputPricePerMillion, output: outputPricePerMillion }
  )
}

/** USD with enough decimals that a small build does not round to $0.00. */
export function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount)
}

/** App cost in naira at the fixed admin rate. */
export function formatNgn(amountUsd: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountUsd * NGN_PER_USD)
}
