import Settings from '@overleaf/settings'
import ZoteroRouter from './app/src/ZoteroRouter.mjs'

/**
 * The Zotero module is ALWAYS registered (de-bootgated): runtime
 * on/off is the admin-managed SiteSetting (Manage Site → Zotero,
 * per-request checks in ZoteroRouter + LinkedFilesController; the
 * `ENABLED_LINKED_FILE_TYPES` env membership remains the deployment
 * seed for whether the connector ships at all).
 *
 * Secrets: the env values (ZOTERO_CLIENT_KEY/SECRET) are SEEDS; the
 * admin-stored (encrypted) values win per request — see 3c for the
 * per-request accessor in the OAuth flow.
 */
const { default: ZoteroLinkedFileAgent } = await import('./app/src/ZoteroLinkedFileAgent.mjs')

const siteUrl = Settings.siteUrl.replace(/\/+$/, '') || 'http://localhost'
Settings.zotero = {
  clientKey: process.env.ZOTERO_CLIENT_KEY,
  clientSecret: process.env.ZOTERO_CLIENT_SECRET,
  callbackURL: `${siteUrl}/user/zotero/oauth/callback`,
}

const ZoteroModule = {
  router: ZoteroRouter,
  linkedFileAgents: {
    zotero: () => ZoteroLinkedFileAgent,
  },
}

export default ZoteroModule
