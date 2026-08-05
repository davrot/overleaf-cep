import { expressify } from '@overleaf/promise-utils'
import crypto from 'node:crypto'
import Settings from '@overleaf/settings'
import DropboxCredentials from './DropboxCredentials.mjs'
import DropboxSync from './DropboxSync.mjs'

async function verify(req, res) {
    res.send(req.query.challenge)
}

async function webhook(req, res) {
    const secret = Settings.dropbox?.appSecret || process.env.DROPBOX_APP_SECRET
    const signature = req.get('x-dropbox-signature')
    const rawBody = req.rawBody
    if (!secret || !signature || !rawBody) return res.sendStatus(403)
    const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex')
    const valid = signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    if (!valid) return res.sendStatus(403)
    const dropboxUids = req.body?.delta?.users
    if (!Array.isArray(dropboxUids)) return res.sendStatus(400)
    res.sendStatus(200)

    const linkedUserIds = await DropboxCredentials.getLinkedUserIds()
    const users = await Promise.all(
        linkedUserIds.map(async userId => {
            const credentials = await DropboxCredentials.get(userId)
            return credentials && dropboxUids.includes(String(credentials.uid))
                ? { _id: userId }
                : null
        })
    )
    await Promise.all(users.filter(Boolean).map(user => DropboxSync.poll(user._id)))
}

export default { verify: expressify(verify), webhook: expressify(webhook) }