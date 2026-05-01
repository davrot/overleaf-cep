// @ts-check

/**
 * This script creates custom Prices in Stripe from a CSV file.
 * It does not create products; each row must include an existing Stripe productId.
 *
 * Usage:
 * node scripts/stripe/create_custom_prices_from_csv.mjs -f <file> --region <us|uk> --version <v> [options]
 *
 * Options:
 * -f           Path to the prices CSV file.
 * --region     Stripe region (us or uk).
 * --version    Version string for the lookup_key (e.g., 'v1', 'jan2026').
 * --commit     Apply changes to Stripe (default is dry-run).
 *
 * CSV Format:
 * planCode,productId,productName,priceDescription,interval,USD,GBP,EUR
 * essentials,prod_123,Essentials Monthly,"Historical custom price",month,21,17,19
 * essentials-annual,prod_456,Essentials Annual,"Historical custom price",year,199,159,179
 */

import minimist from 'minimist'
import fs from 'node:fs'
// https://github.com/import-js/eslint-plugin-import/issues/1810
// eslint-disable-next-line import/no-unresolved
import * as csv from 'csv/sync'
import { scriptRunner } from '../lib/ScriptRunner.mjs'
import { getRegionClient } from '../../modules/subscriptions/app/src/StripeClient.mjs'
import { z } from '@overleaf/validation-tools'
import { convertToMinorUnits, rateLimitSleep } from './helpers.mjs'

/**
 * @typedef {object} PriceRecord
 * @property {string} planCode
 * @property {string} productId - Optional expected Stripe Product ID to validate against
 * @property {string} productName - Optional, can be derived from planCode if not provided
 * @property {string} priceDescription - Optional
 * @property {string} interval - 'month' or 'year'
 * @property {Record<string, string | number>} currencies - Dynamic currency columns
 */

/**
 * @typedef {import('stripe').Stripe} Stripe
 * @typedef {import('stripe').Stripe.Price} Price
 * @typedef {import('stripe').Stripe.PriceCreateParams} PriceCreateParams
 * @typedef {import('stripe').Stripe.Product} Product
 */

const paramsSchema = z.object({
  f: z.string(),
  region: z.enum(['us', 'uk']),
  version: z.string(),
  commit: z.boolean().default(false),
})

/**
 * @param {import('stripe').Stripe} stripe
 * @returns {Promise<Record<string, Price>>}
 */
async function getExistingPrices(stripe) {
  /** @type {Record<string, Price>} */
  const pricesByLookupKey = {}
  let startingAfter

  do {
    /** @type {any} */
    const response = await stripe.prices.list({
      limit: 100,
      starting_after: startingAfter,
    })
    for (const price of response.data) {
      if (price.lookup_key) {
        pricesByLookupKey[price.lookup_key] = price
      }
    }
    startingAfter = response.has_more
      ? response.data[response.data.length - 1].id
      : undefined
  } while (startingAfter)

  return pricesByLookupKey
}

/**
 * @param {import('stripe').Stripe} stripe
 * @return {Promise<Record<string, Product>>}
 */
async function getExistingProducts(stripe) {
  /** @type {Record<string, Product>} */
  const productsById = {}
  let startingAfter

  do {
    /** @type {any} */
    const response = await stripe.products.list({
      limit: 100,
      starting_after: startingAfter,
    })
    for (const product of response.data) {
      productsById[product.metadata.planCode] = product
    }
    startingAfter = response.has_more
      ? response.data[response.data.length - 1].id
      : undefined
  } while (startingAfter)

  return productsById
}

/**
 * @param {any} trackProgress
 */
export async function main(trackProgress) {
  const args = minimist(process.argv.slice(2), {
    boolean: ['commit'],
    string: ['region', 'f', 'version'],
  })

  const parseResult = paramsSchema.safeParse(args)
  if (!parseResult.success) {
    throw new Error(`Invalid parameters: ${parseResult.error.message}`)
  }

  const { f: inputFile, region, version, commit } = parseResult.data
  const mode = commit ? 'COMMIT MODE' : 'DRY RUN MODE'

  const log = (message = '') =>
    trackProgress(mode === 'DRY RUN MODE' ? `[DRY RUN] ${message}` : message)

  await log(`Starting creation script in ${mode} for region: ${region}`)
  const stripe = getRegionClient(region).stripe

  // Load and Parse CSV
  const content = fs.readFileSync(inputFile, 'utf-8')
  /** @type {PriceRecord[]} */
  const records = csv.parse(content, { columns: true, skip_empty_lines: true })

  if (records.length === 0) {
    throw new Error('CSV file is empty or invalid.')
  }

  // Identify currency columns (everything except the known non-currency columns)
  const nonCurrencyKeys = new Set([
    'planCode',
    'productId',
    'productName',
    'priceDescription',
    'interval',
  ])
  const currencyKeys = Object.keys(records[0]).filter(
    k => !nonCurrencyKeys.has(k)
  )

  // Cache existing data to minimize API calls and prevent duplicates
  await log('Fetching existing Stripe data...')
  const existingPrices = await getExistingPrices(stripe)
  const existingProducts = await getExistingProducts(stripe)
  /** @type {Record<string, Product>} */
  const existingProductsById = {}
  for (const product of Object.values(existingProducts)) {
    existingProductsById[product.id] = product
  }

  const summary = {
    productsCreated: 0,
    pricesCreated: 0,
    skipped: 0,
    invalidRows: 0,
    errors: 0,
  }

  let rowNumber = 0 // For logging purposes, starting after header
  for (const /** @type {PriceRecord} */ record of records) {
    ++rowNumber
    const { planCode, productId, priceDescription, interval } = record
    const expectedProductId = String(productId || '').trim()

    if (!planCode) {
      await log(`✗ No plan code in row ${rowNumber}`)
      ++summary.invalidRows
      continue
    }
    if (interval !== 'month' && interval !== 'year') {
      await log(
        `✗ Invalid interval '${interval}' on row ${rowNumber}. Must be either 'month' or 'year'.`
      )
      ++summary.invalidRows
      continue
    }

    // If productId is provided, treat it as an assertion that the product already
    // exists and matches the planCode mapping. Skip the row before product-create.
    if (expectedProductId) {
      const existingProduct = existingProducts[planCode]
      if (!existingProduct) {
        await log(
          `✗ CSV productId '${expectedProductId}' provided for plan '${planCode}', but no existing product was found for that planCode. Skipping row.`
        )
        summary.errors++
        continue
      }

      if (existingProduct.id !== expectedProductId) {
        await log(
          `✗ CSV productId '${expectedProductId}' does not match existing product id '${existingProduct.id}' for plan '${planCode}'. Skipping row.`
        )
        summary.errors++
        continue
      }
    }

    await log()
    await log(`--- Processing Plan: ${planCode} ---`)

    // 1. Validate required existing productId from CSV.
    const productIdForPrice = String(productId || '').trim()
    if (!productIdForPrice) {
      await log(`✗ No productId in row ${rowNumber}. Skipping row.`)
      summary.invalidRows++
      continue
    }

    if (!existingProductsById[productIdForPrice]) {
      await log(
        `✗ Product '${productIdForPrice}' from CSV row ${rowNumber} was not found in Stripe. Skipping row.`
      )
      summary.errors++
      continue
    }

    if (
      existingProducts[planCode]?.id &&
      existingProducts[planCode].id !== productIdForPrice
    ) {
      await log(
        `  ✗ productId mismatch for plan '${planCode}': CSV has '${productIdForPrice}', planCode resolves to '${existingProducts[planCode].id}'. Skipping row.`
      )
      summary.errors++
      continue
    }

    // 2. Handle Prices for each currency column
    for (const currency of currencyKeys) {
      const amountValue = parseFloat(/** @type {any} */ (record)[currency])
      if (isNaN(amountValue) || amountValue <= 0) continue

      const currencyLower = currency.toLowerCase()
      const unitAmount = convertToMinorUnits(amountValue, currencyLower)
      const lookupKeyInterval = interval === 'month' ? 'monthly' : 'annual'
      // For custom prices, lookup keys always include the minor-unit amount.
      const lookupKeyBase = `${planCode}_${lookupKeyInterval}_${version}_${currencyLower}`
      const lookupKey = `${lookupKeyBase}_${unitAmount}`

      if (existingPrices[lookupKey]) {
        await log(`  - Price '${lookupKey}' already exists. Skipping.`)
        summary.skipped++
        continue
      }

      /** @type {PriceCreateParams} */
      const priceParams = {
        product: productIdForPrice,
        currency: currencyLower,
        unit_amount: unitAmount,
        recurring: { interval },
        lookup_key: lookupKey,
        nickname: priceDescription || undefined,
      }

      if (commit) {
        try {
          await stripe.prices.create(priceParams)
          await rateLimitSleep()
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          await log(`  ✗ Error creating price ${lookupKey}: ${errorMessage}`)
          summary.errors++
          continue
        }
      }

      // Keep in-memory cache in sync so duplicates in the same run are skipped.
      existingPrices[lookupKey] = /** @type {any} */ ({
        lookup_key: lookupKey,
      })

      await log(
        `  ✓ Created price: ${lookupKey} (${amountValue} ${currencyLower.toUpperCase()})`
      )
      summary.pricesCreated++
    }
  }

  // Final Summary
  await log()
  await log('='.repeat(20))
  await log()
  await log('✨ FINAL SUMMARY ✨')
  await log(` ✅ Products created: ${summary.productsCreated}`)
  await log(` ✅ Prices created: ${summary.pricesCreated}`)
  await log(` ⏭️ Items skipped: ${summary.skipped}`)
  await log(` ⏭️ Invalid rows skipped: ${summary.invalidRows}`)
  await log(` ❌ Errors encountered: ${summary.errors}`)

  if (!commit) {
    await log('ℹ️  DRY RUN: No changes were applied to Stripe')
  }
  await log('🎉 Script completed!')
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
