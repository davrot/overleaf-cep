import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import AccessTokenEncryptorClass from '@overleaf/access-token-encryptor'

const defaultFile = '/var/lib/overleaf/data/.dropbox-token-cipher.json'
let encryptor

function getEncryptor() {
    if (encryptor) return encryptor
    const file = process.env.DROPBOX_TOKEN_CIPHER_FILE || defaultFile
    const label = process.env.DROPBOX_TOKEN_CIPHER_LABEL || 'OL_DROPBOX-v1'
    const password = process.env.DROPBOX_TOKEN_CIPHER_PASSWORD
    let data
    if (password) {
        data = { cipherLabel: label, cipherPasswords: { [label]: password } }
    } else {
        try {
            data = JSON.parse(fs.readFileSync(file, 'utf8'))
        } catch (error) {
            if (error.code !== 'ENOENT') throw error
            data = {
                cipherLabel: label,
                cipherPasswords: { [label]: crypto.randomBytes(32).toString('base64') },
            }
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 })
        }
    }
    encryptor = new AccessTokenEncryptorClass(data)
    return encryptor
}

export function encrypt(credentials) {
    return getEncryptor().promises.encryptJson(credentials)
}

export function decrypt(credentials) {
    return getEncryptor().promises.decryptToJson(credentials)
}