import { expressify } from '@overleaf/promise-utils'
import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import DropboxCredentials from './DropboxCredentials.mjs'
import DropboxSync from './DropboxSync.mjs'

function userId(req) {
    return SessionManager.getLoggedInUserId(req.session)
}

async function beginAuth(req, res) {
    const callbackUrl = new URL('/dropbox/completeRegistration', Settings.siteUrl)
    const state = crypto.randomBytes(32).toString('hex')
    req.session.dropboxOAuthState = state
    res.redirect(await DropboxSync.connect(callbackUrl.toString(), state))
}

async function completeRegistration(req, res) {
    const callbackUrl = new URL('/dropbox/completeRegistration', Settings.siteUrl)
    const expectedState = req.session.dropboxOAuthState
    delete req.session.dropboxOAuthState
    if (!expectedState || req.query.state !== expectedState) {
        throw new Error('Invalid Dropbox OAuth state')
    }
    if (!req.query.code) throw new Error('Dropbox authorization code is missing')
    await DropboxSync.completeRegistration(
        userId(req),
        req.query.code,
        callbackUrl.toString()
    )
    res.redirect('/user/settings#dropbox')
}

async function status(req, res) {
    const credentials = await DropboxCredentials.get(userId(req))
    res.json({
        linked: Boolean(credentials),
        displayName: credentials?.displayName || null,
        lastCursor: Boolean(credentials?.cursor),
        lastSyncAt: credentials?.lastSyncAt || null,
        lastSyncError: credentials?.lastSyncError || null,
        conflicts: Object.values(credentials?.conflicts || {}),
    })
}

async function unlink(req, res) {
    await DropboxSync.unlink(userId(req))
    res.redirect('/user/settings#dropbox')
}

async function poll(req, res) {
    await DropboxSync.poll(userId(req))
    res.sendStatus(204)
}

async function sync(req, res) {
    await DropboxSync.syncUser(userId(req))
    res.sendStatus(204)
}

async function projectStatus(req, res) {
    const credentials = await DropboxCredentials.get(userId(req))
    res.json({ linked: Boolean(credentials) })
}

async function syncProject(req, res) {
    await DropboxSync.flushProject(userId(req), req.params.project_id)
    res.sendStatus(204)
}

async function resolveConflict(req, res) {
    await DropboxSync.resolveConflict(
        userId(req),
        req.params.project_id,
        req.body.filePath,
        req.body.resolution
    )
    res.sendStatus(204)
}

export default {
    beginAuth: expressify(beginAuth),
    completeRegistration: expressify(completeRegistration),
    status: expressify(status),
    unlink: expressify(unlink),
    poll: expressify(poll),
    sync: expressify(sync),
    projectStatus: expressify(projectStatus),
    syncProject: expressify(syncProject),
    resolveConflict: expressify(resolveConflict),
}