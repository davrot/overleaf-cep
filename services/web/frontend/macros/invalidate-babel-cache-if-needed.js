const fs = require('fs')
const Path = require('path')
const Settings = require('@overleaf/settings')
const cypressCacheVariant = require('./cypress-cache-variant')

module.exports = function invalidateBabelCacheIfNeeded() {
  // Use a unique subdirectory per Cypress CT variant to avoid parallel jobs
  // racing on the shared babel cache and state file.
  const suffix = cypressCacheVariant() ?? ''
  const cacheDir = Path.join(__dirname, '../../node_modules/.cache', suffix)
  const cachePath = Path.join(cacheDir, 'babel-loader')
  const statePath = Path.join(cacheDir, 'last-overleafModuleImports.json')
  let lastState = ''
  try {
    lastState = fs.readFileSync(statePath, { encoding: 'utf-8' })
  } catch (e) {}

  const newState = JSON.stringify(Settings.overleafModuleImports)
  if (lastState !== newState) {
    // eslint-disable-next-line no-console
    console.warn(
      'Detected change in overleafModuleImports, purging babel cache!'
    )
    // Gracefully handle cache mount in Server Pro build, only purge nested folder and keep .cache/ folder.
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.rmSync(cachePath, {
      recursive: true,
      force: true,
      maxRetries: 5,
    })
    fs.writeFileSync(statePath, newState)
  }
}
