// @ts-check
const Settings = require('@overleaf/settings')
const { fetchNothing } = require('@overleaf/fetch-utils')

const MAX_HTTP_REQUEST_LENGTH = 5000

/**
 * @param {string} projectId
 * @param {string} docId
 * @param {string[]} rejectedChangeIds
 * @param {string | undefined} userId
 */
async function notifyTrackChangesRejected(
  projectId,
  docId,
  rejectedChangeIds,
  userId
) {
  const url = new URL(
    `/project/${projectId}/doc/${docId}/changes/reject`,
    Settings.apis.web.url
  )

  await fetchNothing(url, {
    method: 'POST',
    json: { rejectedChangeIds, userId },
    basicAuth: {
      user: Settings.apis.web.user,
      password: Settings.apis.web.pass,
    },
    signal: AbortSignal.timeout(MAX_HTTP_REQUEST_LENGTH),
  })
}

module.exports = {
  promises: {
    notifyTrackChangesRejected,
  },
}
