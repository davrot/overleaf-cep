import { expect } from 'chai'
import {
  DEFAULT_TEMPLATE_CATEGORIES,
  validateTemplatesSection,
  validateZoteroSection,
  validateExternalUrlSection,
  validateSignupSection,
  SECTION_VALIDATORS,
  maskSecrets,
  getSection,
} from '../../../app/src/Features/SiteSettings/SiteSettingsManager.mjs'
import {
  encryptText,
  decryptText,
} from '../../../app/src/Features/SiteSettings/SecretCipher.mjs'

describe('SiteSettings', () => {
  describe('DEFAULT_TEMPLATE_CATEGORIES', () => {
    it('carries the manual’s 12 example categories with names/descriptions', () => {
      const cats = DEFAULT_TEMPLATE_CATEGORIES
      expect(cats).to.have.length(12)
      expect(
        cats.map(c => c.key)
      ).to.members([
        'academic-journal',
        'book',
        'presentation',
        'poster',
        'cv',
        'homework',
        'bibliography',
        'calendar',
        'formal-letter',
        'report',
        'thesis',
        'newsletter',
      ])
      for (const c of cats) {
        expect(c.name, c.key).to.be.a('string').that.is.not.empty
        expect(c.description, c.key).to.be.a('string').that.is.not.empty
      }
    })
  })

  describe('validators', () => {
    it('accepts a valid templates section', () => {
      const errors = validateTemplatesSection({
        enabled: true,
        categories: [
          { key: 'thesis', enabled: true, name: 'Theses', description: 'd', publishable: true },
        ],
      })
      expect(errors).to.deep.equal([])
    })

    it('rejects bad templates sections', () => {
      expect(validateTemplatesSection('x').length).to.be.greaterThan(0)
      expect(
        validateTemplatesSection({ enabled: 'yes' }).length
      ).to.be.greaterThan(0)
      expect(
        validateTemplatesSection({
          enabled: true,
          categories: [{ key: 'UPPER', name: 'x', description: '' }],
        }).length
      ).to.be.greaterThan(0)
      expect(
        validateTemplatesSection({
          enabled: true,
          categories: [
            { key: 'a', name: 'A', description: '' },
            { key: 'a', name: 'A2', description: '' },
          ],
        }).length
      ).to.be.greaterThan(0)
    })

    it('validates blocked network CIDRs and the allowed-resources regex', () => {
      expect(
        validateExternalUrlSection({
          enabled: true,
          blockedNetworks: ['10.0.0.0/8', '192.168.0.0/16', '::1/128', '2001:db8::/32'],
          allowedResourcesRegex: '.*\\.uni-bremen\\.de/.*',
        })
      ).to.deep.equal([])
      expect(
        validateExternalUrlSection({
          enabled: false,
          blockedNetworks: ['not-a-cidr'],
        }).length
      ).to.be.greaterThan(0)
      expect(
        validateExternalUrlSection({
          enabled: false,
          allowedResourcesRegex: '(',
        }).length
      ).to.be.greaterThan(0)
    })

    it('validates the signup and zotero sections', () => {
      expect(
        validateSignupSection({
          enabled: true,
          allowedEmailDomains: ['example.org', '*.uni-bremen.de'],
        })
      ).to.deep.equal([])
      expect(
        validateSignupSection({
          enabled: false,
          allowedEmailDomains: ['no spaces or dots..'],
        }).length
      ).to.be.greaterThan(0)
      expect(
        validateZoteroSection({
          enabled: true,
          clientKey: 'abc-123',
        })
      ).to.deep.equal([])
      expect(
        validateZoteroSection({ enabled: true, clientKey: 'bad key!' }).length
      ).to.be.greaterThan(0)
    })

    it('keeps per-section validators registered', () => {
      expect(Object.keys(SECTION_VALIDATORS).sort()).to.deep.equal([
        'externalUrl',
        'signup',
        'templates',
        'zotero',
      ])
    })
  })

  describe('maskSecrets', () => {
    it('masks zotero.clientSecret and reports clientSecretSet', () => {
      const masked = maskSecrets('zotero', {
        enabled: true,
        clientKey: 'k',
        clientSecret: 'ss::whatever',
        extra: 1,
      })
      expect(masked.clientSecret).to.equal('')
      expect(masked.clientSecretSet).to.equal(true)
      expect(masked.clientKey).to.equal('k')
      expect(masked.extra).to.equal(1)

      const maskedEmpty = maskSecrets('zotero', {
        enabled: true,
        clientKey: 'k',
      })
      expect(maskedEmpty.clientSecret).to.equal('')
      expect(maskedEmpty.clientSecretSet).to.equal(false)
    })
  })

  describe('env seeds (stored doc missing → env wins)', () => {
    const savedEnv = {}
    const KEYS = [
      'OVERLEAF_TEMPLATE_GALLERY',
      'OVERLEAF_TEMPLATE_CATEGORIES',
      'TEMPLATE_THESIS_NAME',
      'TEMPLATE_THESIS_DESCRIPTION',
      'OVERLEAF_ZOTERO',
      'ZOTERO_CLIENT_KEY',
      'ZOTERO_CLIENT_SECRET',
      'OVERLEAF_ENABLE_REGISTRATION_PAGE',
    ]
    const setEnv = () => {
      for (const k of KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]
      }
      process.env.OVERLEAF_TEMPLATE_GALLERY = 'true'
      process.env.OVERLEAF_TEMPLATE_CATEGORIES = 'thesis'
      process.env.TEMPLATE_THESIS_NAME = 'Theses (env)'
      process.env.TEMPLATE_THESIS_DESCRIPTION = 'thesis description (env)'
      process.env.OVERLEAF_ZOTERO = 'true'
      process.env.ZOTERO_CLIENT_KEY = 'env-ckey'
      process.env.OVERLEAF_ENABLE_REGISTRATION_PAGE = 'true'
    }
    const capture = () => {
      for (const k of KEYS) {
        if (process.env[k] !== undefined) savedEnv[k] = process.env[k]
        delete process.env[k]
      }
    }

    it('seeds templates from env with the manual defaults for other categories', async () => {
      setEnv()
      const section = await getSection('templates')
      const keys = section.categories.map(c => c.key)
      // env categories (thesis) + implicit 'all'; other manual keys are
      // NOT seeded while OVERLEAF_TEMPLATE_CATEGORIES is set
      expect(keys).to.members(['thesis', 'all'])
      const thesis = section.categories.find(c => c.key === 'thesis')
      expect(thesis.name).to.equal('Theses (env)')
      expect(thesis.description).to.equal('thesis description (env)')
      expect(section.enabled).to.equal(true)
      capture()

      // no env categories → all 12 manual defaults + 'all'
      delete process.env.OVERLEAF_TEMPLATE_CATEGORIES
      const section2 = await getSection('templates')
      expect(section2.categories).to.have.length(13)
      const book = section2.categories.find(c => c.key === 'book')
      expect(book.name).to.equal('Books')
      expect(book.description).to.include('book')
      capture()
    })

    it('seeds zotero from env including the plaintext secret (never stored)', async () => {
      setEnv()
      process.env.ZOTERO_CLIENT_SECRET = 'env-secret'
      const section = await getSection('zotero')
      expect(section.enabled).to.equal(true)
      expect(section.clientKey).to.equal('env-ckey')
      expect(section.clientSecret).to.equal('env-secret')
      // masked view hides the secret
      const masked = maskSecrets('zotero', section)
      expect(masked.clientSecret).to.equal('')
      expect(masked.clientSecretSet).to.equal(true)
      capture()
    })

    it('seeds signup from env', async () => {
      setEnv()
      const section = await getSection('signup')
      expect(section.enabled).to.equal(true)
      capture()
    })

    it('provides the default private ranges for external URLs', async () => {
      setEnv()
      const section = await getSection('externalUrl')
      expect(section.blockedNetworks).to.include('127.0.0.0/8')
      expect(section.blockedNetworks).to.include('10.0.0.0/8')
      capture()
    })
  })

  describe('SecretCipher', () => {
    it('round-trips text values (empty stays empty)', async () => {
      const enc = await encryptText('hello zotero')
      expect(enc).to.include('ss::')
      expect(enc).to.not.include('hello zotero')
      expect(await decryptText(enc)).to.equal('hello zotero')
      expect(await encryptText('')).to.equal('')
      expect(await decryptText('')).to.equal('')
    })
  })
})
