/**
 * SiteSettings — admin-managed site configuration backed by MongoDB.
 *
 * One document per site
 * `{ _id: 'global', templates: {...}, zotero: {...}, externalUrl: {...},
 * signup: {...}, updatedAt }` in the `site_settings` collection.
 *
 * Semantics (BIB_ORCID_TEMPLATES_PLAN.md decision 3.0):
 *  - STORED value wins over environment; env values are SEEDS (used
 *    only while the stored document/field is missing).
 *  - Values are read PER REQUEST (the web app runs multiple workers —
 *    no process-local truth); a short TTL cache avoids hammering mongo
 *    while keeping admin saves visible across workers within a few
 *    seconds.
 *  - Secrets (e.g. the Zotero client secret) are stored ENCRYPTED
 *    (AES-256-GCM via ./SecretCipher.mjs — the same cipher file as the
 *    zotero & github-sync token ciphers), never returned in plaintext
 *    (masked via maskSecrets), and a stored value always beats the env
 *    value once set.
 *
 * NOTE: `coreSettings` (the resolved `@overleaf/settings` object) is
 * passed in at the call sites that hold it (routers/controllers) so this
 * feature does not import the settings singleton directly.
 */
import logger from '@overleaf/logger'
import { encryptText, decryptText } from './SecretCipher.mjs'

const SECTION_ID = 'global'
const CACHE_TTL_MS = 5_000

/**
 * Lazy collection access: importing the raw-connection hub at module
 * load time has side effects (Mongoose connect) that some test
 * environments do not tolerate; the server context always has it.
 */
async function getCollection() {
  try {
    // eslint-disable-next-line prefer-const
    let dbModule
    try {
      dbModule = await import('../../infrastructure/mongodb.mjs')
    } catch (err) {
      logger.warn({ err }, 'SiteSettings: raw db unavailable')
      return null
    }
    return dbModule.db.siteSettings
  } catch (err) {
    logger.warn({ err }, 'SiteSettings: site_settings collection unavailable')
    return null
  }
}

/** In-section field names that hold encrypted values. */
export const SECRET_FIELDS = {
  zotero: ['clientSecret'],
  // SSO providers (SSO multi-provider, 2026-08-29): stored (encrypted)
  // wins over the OVERLEAF_* env seed under the same key.
  'sso-saml': ['idpCert', 'privateKey', 'decryptionPvk'],
  'sso-oidc': ['clientSecret'],
  'sso-ldap': ['bindCredentials'],
}

let _cache = { at: 0, doc: undefined }
let _inflight = null

function now() {
  return Date.now()
}

function loadDoc() {
  if (now() - _cache.at < CACHE_TTL_MS && _cache.doc !== undefined) {
    return Promise.resolve(_cache.doc)
  }
  if (!_inflight) {
    _inflight = getCollection()
      .then(siteSettings =>
        siteSettings
          ? siteSettings.findOne({ _id: SECTION_ID })
          : Promise.resolve(null)
      )
      .then(doc => {
        _cache = { at: now(), doc: doc || null }
        _inflight = null
        return _cache.doc
      })
      .catch(err => {
        // Read failures degrade to env seeds; the failure is not cached.
        logger.warn({ err }, 'SiteSettings: load failed, using env seeds')
        _inflight = null
        return null
      })
  }
  return _inflight
}

export function invalidateCache() {
  _cache = { at: 0, doc: undefined }
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value))
}

/** Mask encrypted secret fields for read-only API/UI surfaces. */
export function maskSecrets(sectionName, sectionValue) {
  const out = cloneDeep(sectionValue || {})
  for (const field of SECRET_FIELDS[sectionName] || []) {
    const hasValue = typeof out[field] === 'string' && out[field].length > 0
    out[`${field}Set`] = hasValue
    out[field] = ''
  }
  return out
}

/** The manual's 12 example categories (+ 'all') — defaults & seed names. */
export const DEFAULT_TEMPLATE_CATEGORIES = [
  {
    key: 'academic-journal',
    name: 'Academic journals',
    description: 'Templates for writing academic journal articles.',
  },
  {
    key: 'book',
    name: 'Books',
    description: 'Templates for writing books and book chapters.',
  },
  {
    key: 'presentation',
    name: 'Presentations',
    description: 'Templates for creating slide decks and presentations.',
  },
  {
    key: 'poster',
    name: 'Posters',
    description: 'Templates for conference and research posters.',
  },
  {
    key: 'cv',
    name: 'CVs',
    description: 'Templates for writing curricula vitae and résumés.',
  },
  {
    key: 'homework',
    name: 'Homework',
    description: 'Templates for student assignments and homework.',
  },
  {
    key: 'bibliography',
    name: 'Bibliographies',
    description: 'Templates for managing and formatting bibliography.',
  },
  {
    key: 'calendar',
    name: 'Calendars',
    description: 'Templates for printable and digital calendars.',
  },
  {
    key: 'formal-letter',
    name: 'Formal letters',
    description: 'Templates for writing formal and business letters.',
  },
  {
    key: 'report',
    name: 'Reports',
    description: 'Templates for business, lab and project reports.',
  },
  {
    key: 'thesis',
    name: 'Theses',
    description:
      'Templates for writing theses and dissertations, following institutional formatting and citation guidelines.',
  },
  {
    key: 'newsletter',
    name: 'Newsletters',
    description: 'Templates for creating newsletters and bulletins.',
  },
]

function boolFromEnv(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}


function seedTemplateCategories(env, stored) {
  // Union (user round 4, 2026-08-28): the table must list ALL categories
  // the template extension supports — the 12 manual defaults, whatever
  // OVERLEAF_TEMPLATE_CATEGORIES adds, custom stored keys (merged in by
  // getSection), and 'all'. Env still wins for per-key name/description.
  const keysRaw = env.OVERLEAF_TEMPLATE_CATEGORIES
  const envKeys = keysRaw ? keysRaw.split(/\s+/).filter(Boolean) : []
  const keys = []
  const push = (k) => { if (k && !keys.includes(k)) keys.push(k) }
  for (const key of [...DEFAULT_TEMPLATE_CATEGORIES.map(c => c.key), ...envKeys]) push(key)
  push('all')

  return keys.map((key) => {
    const envKeyBase = key.toUpperCase().replace(/-/g, '_')
    const def = DEFAULT_TEMPLATE_CATEGORIES.find(c => c.key === key)
    const s = (stored && stored.categories) || {}
    const storedCat = s[key] || {}
    return {
      key,
      enabled: storedCat.enabled !== false,
      name:
        env[`TEMPLATE_${envKeyBase}_NAME`] ||
        storedCat.name ||
        def?.name ||
        (key === 'all' ? 'All templates' : key),
      description:
        env[`TEMPLATE_${envKeyBase}_DESCRIPTION`] ||
        storedCat.description ||
        def?.description ||
        '',
      publishable: storedCat.publishable !== false,
    }
  })
}

/**
 * Per-section env seeds (evaluated per read; env is the fallback layer
 * under the stored document).
 */
function envSeeds(env, coreSettings, stored) {
  return {
    templates: {
      enabled:
        boolFromEnv(env.OVERLEAF_TEMPLATE_GALLERY) ??
        coreSettings?.templates?.enabled === true,
      categories: seedTemplateCategories(env, stored),
      // R6 (2026-08-29): "All users are template gallery admins" (site
      // setting, admin console). Stored true overrides this false seed.
      allUsersCanManageTemplates: false,
    },
    zotero: {
      enabled:
        boolFromEnv(env.OVERLEAF_ZOTERO) ??
        coreSettings?.enabledLinkedFileTypes?.includes('zotero'),
      clientKey: env.ZOTERO_CLIENT_KEY || '',
      hasEnvSecret: Boolean(env.ZOTERO_CLIENT_SECRET),
    },
    externalUrl: {
      enabled:
        boolFromEnv(env.OVERLEAF_EXTERNAL_URLS) ??
        coreSettings?.enabledLinkedFileTypes?.includes('url'),
      blockedNetworks: [
        '127.0.0.0/8',
        '169.254.0.0/16',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '::1/128',
        'fe80::/10',
        'fc00::/7',
      ],
      allowedResourcesRegex: env.OVERLEAF_LINKED_URL_ALLOWED_RESOURCES || '',
    },
    signup: {
      enabled:
        boolFromEnv(env.OVERLEAF_ENABLE_REGISTRATION_PAGE) ??
        !(coreSettings?.ldap?.enable ||
          coreSettings?.saml?.enable ||
          coreSettings?.oidc?.enable),
      allowedEmailDomains: (env.OVERLEAF_ALLOWED_REGISTRATION_EMAIL_DOMAINS || '')
        .split(/[,\s]+/)
        .filter(Boolean),
      // New 1: where /register sends visitors when the sign-up page is
      // disabled; empty/'' → the default /login.
      disabledRedirectUrl: env.OVERLEAF_REGISTRATION_DISABLED_REDIRECT || '',
    },
    // SSO providers are admin-managed and stored-only (D7: no env
    // fallback — an unset section means the provider is disabled).
    'sso-saml': { enabled: false },
    'sso-oidc': { enabled: false },
    'sso-ldap': { enabled: false },
  }
}

/**
 * Read one section: stored value with env seeds merged underneath.
 * `coreSettings` = resolved core settings (for env-seed defaults);
 * when omitted, env vars alone provide the seeds.
 */
export async function getSection(name, coreSettings) {
  const doc = await loadDoc()
  const env = globalThis.process.env
  const stored = (doc && doc[name]) || {}
  const seeds = envSeeds(env, coreSettings || {}, stored)[name] || {}
  const merged = { ...cloneDeep(seeds), ...cloneDeep(stored) }

  if (name === 'templates') {
    // Per-key merge: stored wins; stored-only keys are included.
    const seedById = {}
    for (const c of seeds.categories || []) seedById[c.key] = c
    const storedList = stored.categories || []
    const storedById = {}
    for (const c of storedList) storedById[c.key] = c
    const keys = (seeds.categories || []).map(c => c.key)
    for (const c of storedList) {
      if (!keys.includes(c.key)) keys.push(c.key)
    }
    merged.categories = keys.map(
      k => ({ ...(seedById[k] || {}), ...(storedById[k] || {}), key: k })
    )
    delete merged.publishable
  }

  if (name === 'zotero') {
    // Resolve the secret: stored (encrypted) wins, env second.
    let secret = ''
    if (stored.clientSecret) {
      try {
        secret = await decryptText(stored.clientSecret)
      } catch (err) {
        logger.warn(
          { err },
          'SiteSettings: zotero clientSecret decrypt failed; env value used if set'
        )
      }
      if (!secret && seeds.hasEnvSecret) secret = env.ZOTERO_CLIENT_SECRET
    } else if (seeds.hasEnvSecret) {
      secret = env.ZOTERO_CLIENT_SECRET
    }
    merged.clientSecret = secret
    delete merged.hasEnvSecret
  }

  // SSO provider sections: stored (encrypted) secret wins, env seed
  // second. Mirrors the zotero resolution above, generalized over the
  // section's SECRET_FIELDS list.
  const ssoSecrets = SECRET_FIELDS[name]
  if (ssoSecrets && name !== 'zotero') {
    for (const field of ssoSecrets) {
      const storedVal = stored[field]
      let resolved = ''
      if (typeof storedVal === 'string' && storedVal.length > 0) {
        try {
          resolved = await decryptText(storedVal)
        } catch (err) {
          logger.warn(
            { err, section: name, field },
            `SiteSettings: ${name} ${field} decrypt failed; env value used if set`
          )
        }
        if (!resolved) resolved = seeds[field] || ''
      } else {
        resolved = seeds[field] || ''
      }
      merged[field] = resolved
    }
  }

  return merged
}

/**
 * Replace a section (admin-only — the router enforces the admin guard
 * and runs the per-section validator first). A secret field in the
 * payload is the PLAINTEXT new value; an empty string means "keep the
 * previously stored value" (the masked placeholder from the UI).
 */
export async function setSection(name, value) {
  const siteSettings = await getCollection()
  if (!siteSettings) {
    throw new Error('SiteSettings: database unavailable')
  }
  const doc = await loadDoc()
  const existing = (doc && doc[name]) ? cloneDeep(doc[name]) : {}
  const next = cloneDeep(value || {})

  for (const field of SECRET_FIELDS[name] || []) {
    const incoming = next[field]
    if (typeof incoming !== 'string' || incoming === '') {
      next[field] = existing[field] || ''
    } else {
      next[field] = await encryptText(incoming)
    }
    delete next[`${field}Set`]
  }

  const result = await siteSettings.updateOne(
    { _id: SECTION_ID },
    {
      $set: {
        [name]: next,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  )
  invalidateCache()
  return {
    upserted: result.upsertedCount === 1,
    modified: result.modifiedCount === 1,
  }
}

// ---------------------------------------------------------------------------
// Validators (run by the router before setSection)
// ---------------------------------------------------------------------------

export function validateTemplatesSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories)) {
      errors.push('categories must be an array')
    } else {
      const seen = new Set()
      for (const cat of value.categories) {
        if (
          !cat ||
          typeof cat.key !== 'string' ||
          !/^[a-z0-9-]{1,64}$/.test(cat.key)
        ) {
          errors.push('each category needs a key matching ^[a-z0-9-]{1,64}$')
          break
        }
        if (seen.has(cat.key)) {
          errors.push(`duplicate category key: ${cat.key}`)
          break
        }
        seen.add(cat.key)
        if (typeof cat.name !== 'string' || cat.name.length === 0 || cat.name.length > 120) {
          errors.push(`category ${cat.key}: name required (<=120 chars)`)
          break
        }
        if (typeof cat.description !== 'string' || cat.description.length > 500) {
          errors.push(`category ${cat.key}: description must be a string (<=500 chars)`)
          break
        }
      }
    }
  }
  return errors
}

export function validateZoteroSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (
    value.clientKey !== undefined &&
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.clientKey || '')
  ) {
    errors.push('clientKey may only contain letters, digits, _ and -')
  }
  return errors
}

export function validateExternalUrlSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.blockedNetworks !== undefined) {
    if (!Array.isArray(value.blockedNetworks)) {
      errors.push('blockedNetworks must be an array')
    } else {
      for (const cidr of value.blockedNetworks) {
        const ok =
          typeof cidr === 'string' &&
          (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(cidr) ||
            /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}\/\d{1,4}$/.test(cidr) ||
            /^(\d{1,3}\.){3}\d{1,3}$/.test(cidr))
        if (!ok) errors.push(`blockedNetworks: invalid IP/CIDR "${cidr}"`)
      }
    }
  }
  if (value.allowedResourcesRegex !== undefined) {
    if (typeof value.allowedResourcesRegex !== 'string') {
      errors.push('allowedResourcesRegex must be a string ("" to clear)')
    } else if (value.allowedResourcesRegex.length > 0) {
      try {
        // eslint-disable-next-line no-new
        new RegExp(value.allowedResourcesRegex)
      } catch {
        errors.push('allowedResourcesRegex is not a valid regular expression')
      }
    }
  }
  return errors
}

export function validateSignupSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.disabledRedirectUrl !== undefined && typeof value.disabledRedirectUrl !== 'string') {
    errors.push('disabledRedirectUrl must be a string')
  }
  if (value.allowedEmailDomains !== undefined) {
    if (!Array.isArray(value.allowedEmailDomains)) {
      errors.push('allowedEmailDomains must be an array')
    } else {
      for (const d of value.allowedEmailDomains) {
        const okDomain =
          typeof d === 'string' &&
          (d === '*' ||
            /^\*\.[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(d) ||
            /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(d))
        if (!okDomain) errors.push(`allowedEmailDomains: invalid domain "${d}"`)
      }
    }
  }
  return errors
}

export function validateSsoSamlSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.issuer !== 'string' || value.issuer.length === 0) {
      errors.push('issuer is required to enable SAML')
    }
    // A secret (stored or env) is required to verify IdP signatures.
    const hasStored = typeof value.idpCert === 'string' && value.idpCert.length > 0
    if (!hasStored && !process.env.OVERLEAF_SAML_IDP_CERT) {
      errors.push('IdP certificate is required to enable SAML (stored or via OVERLEAF_SAML_IDP_CERT env)')
    }
  }
  return errors
}

export function validateSsoOidcSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    const hasIssuer = typeof value.issuer === 'string' && value.issuer.length > 0
    const hasUrls = typeof value.authorizationURL === 'string' && value.authorizationURL.length > 0
      && typeof value.tokenURL === 'string' && value.tokenURL.length > 0
    if (!hasIssuer && !hasUrls) {
      errors.push('either the issuer URL or the authorization/token URLs are required to enable OIDC')
    }
    if (typeof value.clientID !== 'string' || value.clientID.length === 0) {
      errors.push('clientID is required to enable OIDC')
    }
  }
  if (value.allowedOIDCEmailDomains !== undefined && !Array.isArray(value.allowedOIDCEmailDomains)) {
    errors.push('allowedOIDCEmailDomains must be an array')
  }
  return errors
}

export function validateSsoLdapSection(value) {
  const errors = []
  if (typeof value !== 'object' || value === null) return ['body must be a JSON object']
  if (typeof value.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (value.enabled) {
    if (typeof value.url !== 'string' || !/^ldaps?:\/\//.test(value.url)) {
      errors.push('url must be an ldapi(s)://… server URL to enable LDAP')
    }
    if (typeof value.searchBase !== 'string' || value.searchBase.length === 0) {
      errors.push('searchBase (base DN) is required to enable LDAP')
    }
  }
  if (value.searchAttributes !== undefined && typeof value.searchAttributes === 'string' && value.searchAttributes.length > 0) {
    try { JSON.parse(value.searchAttributes) } catch { errors.push('searchAttributes must be a JSON array string') }
  }
  return errors
}

export const SECTION_VALIDATORS = {
  templates: validateTemplatesSection,
  zotero: validateZoteroSection,
  externalUrl: validateExternalUrlSection,
  signup: validateSignupSection,
  'sso-saml': validateSsoSamlSection,
  'sso-oidc': validateSsoOidcSection,
  'sso-ldap': validateSsoLdapSection,
}
