const path = require('path')

// Returns the cache subdirectory name for the current Cypress CT variant,
// or null when CYPRESS_RESULTS is not set.
// Throws if the derived basename is unsafe to prevent path traversal or
// absolute-path escapes.
function cypressCacheVariant() {
  if (!process.env.CYPRESS_RESULTS) return null
  const variant = path.basename(process.env.CYPRESS_RESULTS)
  if (
    !variant ||
    variant === '.' ||
    variant === '..' ||
    path.isAbsolute(variant)
  ) {
    throw new Error(
      `CYPRESS_RESULTS must resolve to a safe basename; got "${process.env.CYPRESS_RESULTS}"`
    )
  }
  return variant
}

module.exports = cypressCacheVariant
