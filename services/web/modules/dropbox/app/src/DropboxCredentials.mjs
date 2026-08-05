import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import DropboxUserCredentials from './models/dropboxUserCredentials.mjs'
import { decrypt, encrypt } from './DropboxTokenEncryption.mjs'

const { normalizeQuery } = Mongo
const locks = new Map()

async function withUserLock(userId, operation) {
    const key = userId.toString()
    const previous = locks.get(key) || Promise.resolve()
    let release
    const current = new Promise(resolve => { release = resolve })
    locks.set(key, current)
    await previous
    try {
        return await operation()
    } finally {
        release()
        if (locks.get(key) === current) locks.delete(key)
    }
}

async function get(userId) {
    const record = await DropboxUserCredentials.findOne(normalizeQuery({ userId })).lean()
    return record ? decrypt(record.credentials) : null
}

async function saveUnlocked(userId, credentials) {
    await DropboxUserCredentials.findOneAndUpdate(
        normalizeQuery({ userId }),
        { $set: { credentials: await encrypt(credentials) } },
        { upsert: true }
    )
}

async function save(userId, credentials) {
    return withUserLock(userId, () => saveUnlocked(userId, credentials))
}

async function update(userId, changes) {
    return withUserLock(userId, async () => {
        const credentials = await get(userId)
        if (credentials) await saveUnlocked(userId, { ...credentials, ...changes })
    })
}

async function remove(userId) {
    return withUserLock(userId, () =>
        DropboxUserCredentials.deleteOne(normalizeQuery({ userId }))
    )
}

async function getLinkedUserIds() {
    const records = await DropboxUserCredentials.find({}, { userId: 1 }).lean()
    return records.map(record => record.userId.toString())
}

export default { get, save, update, remove, getLinkedUserIds }