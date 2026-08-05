import DropboxSync from './DropboxSync.mjs'

function unlinkAccount(userId, _options, callback) {
    DropboxSync.unlink(userId).then(
        () => callback(),
        error => callback(error)
    )
}

export default { unlinkAccount }
