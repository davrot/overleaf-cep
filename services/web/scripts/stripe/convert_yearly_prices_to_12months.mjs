#!/usr/bin/env node

// @ts-check

/**
 * Convert yearly Stripe prices for a product to 12-month prices.
 *
 * For each recurring yearly price on the target product:
 * 1) Create a replacement recurring price with interval=month and interval_count=12
 * 2) Archive (set active=false) the original yearly price
 *
 * Note: Stripe Prices cannot be hard-deleted. Archiving is the supported replacement.
 *
 * Usage:
 * node scripts/stripe/convert_yearly_prices_to_12months.mjs --region <us|uk> --productId <prod_...> [--commit]
 *
 * Options:
 * --region       Required. Stripe region (us or uk)
 * --productId    Required. Stripe product id
 * --commit       Apply changes. Default is dry-run.
 */

import minimist from 'minimist'
import { z } from '@overleaf/validation-tools'
import { scriptRunner } from '../lib/ScriptRunner.mjs'
import { getRegionClient } from '../../modules/subscriptions/app/src/StripeClient.mjs'
import { rateLimitSleep } from './helpers.mjs'

/**
 * @typedef {import('stripe').Stripe} Stripe
 * @typedef {import('stripe').Stripe.Price} Price
 * @typedef {import('stripe').Stripe.PriceCreateParams} PriceCreateParams
 */

const paramsSchema = z.object({
  region: z.enum(['us', 'uk']),
  productId: z.string(),
  commit: z.boolean().default(false),
})

const ARCHIVED_PREFIX = '[ARCHIVED]'

/**
 * @param {Stripe} stripe
 * @param {string} priceId
 * @returns {Promise<boolean>}
 */
async function getHasActiveSubscriptions(stripe, priceId) {
  const activeStatuses = [
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'paused',
    'incomplete',
  ]

  let hasMore = true
  let startingAfter

  while (hasMore) {
    /** @type {{price: string, limit: number, starting_after?: string}} */
    const params = {
      price: priceId,
      limit: 100,
    }

    if (startingAfter) {
      params.starting_after = startingAfter
    }

    const subscriptions = await stripe.subscriptions.list(params)
    await rateLimitSleep()

    if (
      subscriptions.data.some(subscription =>
        activeStatuses.includes(subscription.status)
      )
    ) {
      return true
    }

    hasMore = subscriptions.has_more
    if (hasMore && subscriptions.data.length > 0) {
      startingAfter = subscriptions.data[subscriptions.data.length - 1].id
    }
  }

  return false
}

/**
 * @param {Stripe} stripe
 * @param {string} productId
 * @returns {Promise<Price[]>}
 */
async function getAllProductPrices(stripe, productId) {
  /** @type {Record<string, Price>} */
  const pricesById = {}

  for (const active of [true, false]) {
    let startingAfter

    do {
      /** @type {any} */
      const response = await stripe.prices.list({
        product: productId,
        active,
        limit: 100,
        starting_after: startingAfter,
      })

      for (const price of response.data) {
        pricesById[price.id] = price
      }

      startingAfter = response.has_more
        ? response.data[response.data.length - 1].id
        : undefined
    } while (startingAfter)
  }

  return Object.values(pricesById)
}

/**
 * Check if there is an active 12-month price that is equivalent to the yearly price (same currency, unit_amount, nickname, and lookup_key).
 * This is mostly a redundant safety check since for this one-off script there won't be any duplicates.
 * @param {Price} yearlyPrice
 * @param {Price[]} productPrices
 * @returns {boolean}
 */
function hasEquivalent12MonthPrice(yearlyPrice, productPrices) {
  return productPrices.some(candidate => {
    return (
      candidate.active &&
      candidate.id !== yearlyPrice.id &&
      candidate.recurring?.interval === 'month' &&
      candidate.recurring?.interval_count === 12 &&
      candidate.currency === yearlyPrice.currency &&
      candidate.unit_amount === yearlyPrice.unit_amount &&
      candidate.nickname === yearlyPrice.nickname &&
      candidate.lookup_key === yearlyPrice.lookup_key
    )
  })
}

/**
 * @param {Price} yearlyPrice
 * @returns {PriceCreateParams}
 */
function build12MonthPriceParams(yearlyPrice) {
  if (typeof yearlyPrice.product !== 'string') {
    throw new Error(
      `Price ${yearlyPrice.id} has an expanded product. Please rerun without expanded product objects.`
    )
  }

  if (typeof yearlyPrice.unit_amount !== 'number') {
    throw new Error(
      `Price ${yearlyPrice.id} does not have unit_amount. Only per-unit prices are supported by this script.`
    )
  }

  /** @type {PriceCreateParams} */
  const params = {
    product: yearlyPrice.product,
    currency: yearlyPrice.currency,
    unit_amount: yearlyPrice.unit_amount,
    billing_scheme: yearlyPrice.billing_scheme,
    recurring: {
      interval: 'month',
      interval_count: 12,
    },
    active: yearlyPrice.active,
    metadata: yearlyPrice.metadata,
    nickname: yearlyPrice.nickname || undefined,
    tax_behavior: yearlyPrice.tax_behavior || undefined,
  }

  if (yearlyPrice.lookup_key) {
    params.lookup_key = yearlyPrice.lookup_key
    params.transfer_lookup_key = true
  }

  return params
}

/**
 * @param {Price[]} activeYearlyPrices
 * @param {Price[]} allProductPrices
 * @param {Stripe} stripe
 * @param {boolean} commit
 * @param {(msg: string) => Promise<void>} trackProgress
 */
async function convertPrices(
  activeYearlyPrices,
  allProductPrices,
  stripe,
  commit,
  trackProgress
) {
  const summary = {
    yearlyFound: activeYearlyPrices.length,
    created: 0,
    archived: 0,
    skippedHasActiveSubscriptions: 0,
    skippedAlreadyConverted: 0,
    errors: 0,
  }

  for (const yearlyPrice of activeYearlyPrices) {
    try {
      await trackProgress(
        `Processing yearly price ${yearlyPrice.id} (${yearlyPrice.currency.toUpperCase()} ${yearlyPrice.unit_amount})`
      )

      const hasActiveSubscriptions = await getHasActiveSubscriptions(
        stripe,
        yearlyPrice.id
      )
      if (hasActiveSubscriptions) {
        await trackProgress(
          `  WARNING: Price ${yearlyPrice.id} has active subscriptions. Skipping conversion for this price.`
        )
        summary.skippedHasActiveSubscriptions++
        continue
      }

      const alreadyHasEquivalent = hasEquivalent12MonthPrice(
        yearlyPrice,
        allProductPrices
      )

      if (!alreadyHasEquivalent) {
        const params = build12MonthPriceParams(yearlyPrice)

        if (commit) {
          const newPrice = await stripe.prices.create(params)
          await rateLimitSleep()
          allProductPrices.push(newPrice)
          await trackProgress(
            `  Created 12-month price ${newPrice.id}${newPrice.lookup_key ? ` (lookup_key: ${newPrice.lookup_key})` : ''}`
          )
        } else {
          await trackProgress(
            `  [DRY RUN] Would create 12-month replacement price${yearlyPrice.lookup_key ? ` with lookup_key transfer (${yearlyPrice.lookup_key})` : ''}`
          )
        }

        summary.created++
      } else {
        await trackProgress(
          '  Found an equivalent 12-month price already. Skipping create step.'
        )
        summary.skippedAlreadyConverted++
      }

      if (commit) {
        const archivedNickname = yearlyPrice.nickname?.includes('[ARCHIVED]')
          ? yearlyPrice.nickname
          : yearlyPrice.nickname
            ? `${ARCHIVED_PREFIX} ${yearlyPrice.nickname}`
            : ARCHIVED_PREFIX

        await stripe.prices.update(yearlyPrice.id, {
          active: false,
          nickname: archivedNickname,
        })
        await rateLimitSleep()
        await trackProgress(`  Archived yearly price ${yearlyPrice.id}`)
      } else {
        await trackProgress(
          `  [DRY RUN] Would archive yearly price ${yearlyPrice.id} and prepend [ARCHIVED] to nickname`
        )
      }
      summary.archived++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await trackProgress(
        `  ERROR processing price ${yearlyPrice.id}: ${message}`
      )
      summary.errors++
    }
  }

  return summary
}

/**
 * @param {(msg: string) => Promise<void>} trackProgress
 */
export async function main(trackProgress) {
  const rawArgs = minimist(process.argv.slice(2), {
    boolean: ['commit'],
    string: ['region', 'productId', 'product-id', 'p'],
    alias: { p: 'productId' },
  })

  const parseResult = paramsSchema.safeParse({
    region: rawArgs.region,
    productId: rawArgs.productId || rawArgs['product-id'],
    commit: rawArgs.commit,
  })

  if (!parseResult.success) {
    throw new Error(`Invalid parameters: ${parseResult.error.message}`)
  }

  const { region, productId, commit } = parseResult.data
  const mode = commit ? 'COMMIT MODE' : 'DRY RUN MODE'

  await trackProgress(`Starting conversion in ${mode} for region: ${region}`)
  await trackProgress(`Target product: ${productId}`)
  await trackProgress(
    'Note: Stripe prices cannot be deleted. This script archives yearly prices after replacement.'
  )

  const stripe = getRegionClient(region).stripe

  const allProductPrices = await getAllProductPrices(stripe, productId)
  const activeYearlyPrices = allProductPrices.filter(
    price => price.active && price.recurring?.interval === 'year'
  )

  if (activeYearlyPrices.length === 0) {
    await trackProgress(
      'No active yearly recurring prices found for this product. Exiting.'
    )
    return
  }

  await trackProgress(
    `Found ${activeYearlyPrices.length} active yearly recurring price(s) to process.`
  )

  const summary = await convertPrices(
    activeYearlyPrices,
    allProductPrices,
    stripe,
    commit,
    trackProgress
  )

  await trackProgress('CONVERSION SUMMARY')
  await trackProgress(`Yearly prices found: ${summary.yearlyFound}`)
  await trackProgress(
    `12-month prices ${commit ? 'created' : 'to create'}: ${summary.created}`
  )
  await trackProgress(
    `Yearly prices ${commit ? 'archived' : 'to archive'}: ${summary.archived}`
  )
  await trackProgress(
    `Skipped (has active subscriptions): ${summary.skippedHasActiveSubscriptions}`
  )
  await trackProgress(
    `Create skipped (already converted): ${summary.skippedAlreadyConverted}`
  )
  await trackProgress(`Errors: ${summary.errors}`)

  if (!commit) {
    await trackProgress(
      'This was a dry run. Use --commit to perform create+archive operations.'
    )
  }

  await trackProgress(`Script completed in ${mode}`)
}

if (import.meta.main) {
  try {
    await scriptRunner(main)
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
