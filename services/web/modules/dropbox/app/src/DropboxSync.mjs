import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { Readable } from 'node:stream'
import Settings from '@overleaf/settings'
import TpdsUpdateHandler from '../../../../app/src/Features/ThirdPartyDataStore/TpdsUpdateHandler.mjs'
import DropboxClient from './DropboxClient.mjs'
import DropboxCredentials from './DropboxCredentials.mjs'

const ROOT = '/Apps/Overleaf'
const syncingProjects = new Set()
const pollingUsers = new Set()
const recentlyInboundProjects = new Map()
const recentlyInboundProjectNames = new Map()

function inboundProjectKey(userId, projectId) {
    return `${userId.toString()}:${projectId.toString()}`
}

function markInboundProject(userId, projectId) {
    recentlyInboundProjects.set(
        inboundProjectKey(userId, projectId),
        Date.now() + 10_000
    )
}

function markInboundProjectName(userId, projectName) {
    recentlyInboundProjectNames.set(
        `${userId.toString()}:${projectName}`,
        Date.now() + 10_000
    )
}

function isRecentlyInbound(userId, projectId) {
    const key = inboundProjectKey(userId, projectId)
    const expiresAt = recentlyInboundProjects.get(key)
    if (!expiresAt) return false
    if (expiresAt > Date.now()) return true
    recentlyInboundProjects.delete(key)
    return false
}

function isRecentlyInboundName(userId, projectName) {
    const key = `${userId.toString()}:${projectName}`
    const expiresAt = recentlyInboundProjectNames.get(key)
    if (!expiresAt) return false
    if (expiresAt > Date.now()) return true
    recentlyInboundProjectNames.delete(key)
    return false
}

function pathPart(value) {
    return String(value).replace(/^\/+|\/+$/g, '').replaceAll('/', '_')
}

function remotePath(projectName, filePath = '') {
    const relative = filePath.replace(/^\/+/, '')
    return `${ROOT}/${pathPart(projectName)}${relative ? `/${relative}` : ''}`
}

async function projectFiles(project) {
    await DocumentUpdaterHandler.promises.flushProjectToMongo(project._id)
    const [docs, files, entities] = await Promise.all([
        ProjectEntityHandler.promises.getAllDocs(project._id),
        ProjectEntityHandler.promises.getAllFiles(project._id),
        ProjectEntityHandler.promises.getAllEntities(project._id),
    ])
    return { docs, files, entities }
}

async function getHistoryFile(project, file) {
    const historyId = project.overleaf?.history?.id
    if (!historyId) throw new Error('project has no history id')
    const response = await fetch(
        `${Settings.apis.project_history.url}/project/${historyId}/blob/${file.hash}`
    )
    if (!response.ok) throw new Error(`failed to fetch project file: ${response.status}`)
    return response.arrayBuffer()
}

async function listAllEntries(credentials, path) {
    const entries = []
    let result = await DropboxClient.listFolder(credentials, path)
    entries.push(...(result.entries || []))
    while (result.has_more) {
        result = await DropboxClient.listFolderContinue(credentials, result.cursor)
        entries.push(...(result.entries || []))
    }
    return entries
}

async function uploadProjectFile(credentials, project, userId, filePath, body, rev, force) {
    try {
        await DropboxClient.upload(
            credentials,
            remotePath(project.name, filePath),
            body,
            !force && rev ? { '.tag': 'update', update: rev } : 'overwrite'
        )
    } catch (error) {
        if (error.status !== 409) throw error
        await DropboxCredentials.update(userId, {
            conflicts: {
                ...(credentials.conflicts || {}),
                [`${project.name}:${filePath}`]: {
                    projectId: project._id.toString(),
                    projectName: project.name,
                    filePath,
                    detectedAt: new Date().toISOString(),
                },
            },
        })
        throw error
    }
}

async function syncProjectWithCredentials(credentials, project, userId, force = false) {
    const { docs, files, entities } = await projectFiles(project)
    const previousState = credentials.remoteState?.[project.name] || {}
    await DropboxClient.createFolder(credentials, ROOT)
        .catch(error => { if (error.status !== 409) throw error })
    await DropboxClient.createFolder(credentials, remotePath(project.name))
        .catch(error => { if (error.status !== 409) throw error })
    for (const folder of entities.folders
        .filter(folder => folder.path !== '/')
        .sort((left, right) => left.path.length - right.path.length)) {
        await DropboxClient.createFolder(
            credentials,
            remotePath(project.name, folder.path)
        ).catch(error => { if (error.status !== 409) throw error })
    }
    const localPaths = new Set([...Object.keys(docs), ...Object.keys(files)])
    const listing = await listAllEntries(credentials, remotePath(project.name))
    for (const entry of listing) {
        if (entry['.tag'] !== 'file') continue
        const filePath = entry.path_display.slice(remotePath(project.name).length) || '/'
        if (!localPaths.has(filePath) && previousState[filePath]?.rev) {
            if (entry.rev === previousState[filePath].rev) {
                await DropboxClient.deletePath(credentials, entry.path_display)
            } else {
                await DropboxCredentials.update(userId, {
                    conflicts: {
                        ...(credentials.conflicts || {}),
                        [`${project.name}:${filePath}`]: {
                            projectId: project._id.toString(),
                            projectName: project.name,
                            filePath,
                            detectedAt: new Date().toISOString(),
                            reason: 'remote-file-changed-before-local-delete',
                        },
                    },
                })
            }
        }
    }
    for (const [filePath, doc] of Object.entries(docs)) {
        await uploadProjectFile(
            credentials, project, userId, filePath,
            Buffer.from(doc.lines.join('\n')),
            previousState[filePath]?.rev,
            force
        )
    }
    for (const [filePath, file] of Object.entries(files)) {
        await uploadProjectFile(
            credentials, project, userId, filePath,
            await getHistoryFile(project, file),
            previousState[filePath]?.rev,
            force
        )
    }
    const syncedListing = await listAllEntries(
        credentials,
        remotePath(project.name)
    )
    const remoteState = {}
    for (const entry of syncedListing) {
        if (entry['.tag'] === 'file') {
            remoteState[entry.path_display.slice(remotePath(project.name).length) || '/'] = {
                rev: entry.rev,
            }
        }
    }
    await DropboxCredentials.update(userId, {
        remoteState: {
            ...(credentials.remoteState || {}),
            [project.name]: remoteState,
        },
        accessToken: credentials.accessToken,
        expiresAt: credentials.expiresAt,
    })
}

async function syncProjectWithStatus(credentials, project, userId, force = false) {
    try {
        await syncProjectWithCredentials(credentials, project, userId, force)
        await DropboxCredentials.update(userId, {
            lastSyncAt: new Date().toISOString(),
            lastSyncError: null,
        })
    } catch (error) {
        await DropboxCredentials.update(userId, {
            lastSyncAt: new Date().toISOString(),
            lastSyncError: {
                message: error.message,
                status: error.status,
                projectId: project._id.toString(),
                projectName: project.name,
            },
        })
        throw error
    }
}

async function flushProjects(userId) {
    const credentials = await DropboxCredentials.get(userId)
    if (!credentials) throw new Error('Dropbox is not connected')
    const projects = await ProjectGetter.promises.findAllUsersProjects(
        userId,
        '_id archived trashed'
    )
    const writableProjects = [
        ...projects.owned,
        ...projects.readAndWrite,
    ].filter(project => !project.archived && !project.trashed)
    await Promise.all(
        writableProjects.map(project =>
            syncProjectWithStatus(credentials, project, userId)
        )
    )
}

async function syncProjectForLinkedUsers(projectId) {
    const projectKey = projectId.toString()
    if (syncingProjects.has(projectKey)) return
    syncingProjects.add(projectKey)
    try {
        const users = await DropboxCredentials.getLinkedUserIds()
        await Promise.allSettled(users.map(async userId => {
            if (isRecentlyInbound(userId, projectId)) return
            const projects = await ProjectGetter.promises.findAllUsersProjects(
                userId,
                '_id archived trashed'
            )
            const writableProjects = [...projects.owned, ...projects.readAndWrite]
                .filter(project => !ProjectHelper.isArchivedOrTrashed(project, userId))
            const project = writableProjects.find(
                project => project._id.toString() === projectKey
            )
            if (project && !isRecentlyInboundName(userId, project.name)) {
                await flushProject(userId, projectId)
            }
        }))
    } finally {
        syncingProjects.delete(projectKey)
    }
}

async function flushProject(userId, projectId) {
    const project = await ProjectGetter.promises.getProject(projectId, {
        name: 1, archived: 1, trashed: 1, overleaf: 1, owner_ref: 1,
    })
    if (!project || project.archived || project.trashed) return
    const credentials = await DropboxCredentials.get(userId)
    if (!credentials) throw new Error('Dropbox is not connected')
    await syncProjectWithStatus(credentials, project, userId)
}

async function moveEntityForLinkedUsers(params) {
    const users = await DropboxCredentials.getLinkedUserIds()
    await Promise.allSettled(users.map(async userId => {
        const projects = await ProjectGetter.promises.findAllUsersProjects(
            userId,
            '_id archived trashed'
        )
        const writable = [...projects.owned, ...projects.readAndWrite]
            .some(project => project._id.toString() === params.projectId.toString() &&
                !ProjectHelper.isArchivedOrTrashed(project, userId))
        if (!writable) return
        const credentials = await DropboxCredentials.get(userId)
        if (!credentials) return
        if (params.newProjectName) {
            try {
                await DropboxClient.movePath(
                    credentials,
                    remotePath(params.projectName),
                    remotePath(params.newProjectName)
                )
            } catch (error) {
                if (error.status !== 409 && error.status !== 404) throw error
            }
            const remoteState = { ...(credentials.remoteState || {}) }
            remoteState[params.newProjectName] = remoteState[params.projectName] || {}
            delete remoteState[params.projectName]
            await DropboxCredentials.update(userId, {
                remoteState,
                accessToken: credentials.accessToken,
                expiresAt: credentials.expiresAt,
            })
        }
        await flushProject(userId, params.projectId)
    }))
}

async function deleteProjectForUsers({ projectName, userIds }) {
    await Promise.allSettled(userIds.map(async userId => {
        const credentials = await DropboxCredentials.get(userId)
        if (!credentials) return
        try {
            await DropboxClient.deletePath(credentials, remotePath(projectName))
        } catch (error) {
            if (error.status !== 404) throw error
        } finally {
            const remoteState = { ...(credentials.remoteState || {}) }
            delete remoteState[projectName]
            await DropboxCredentials.update(userId, { remoteState })
        }
    }))
}

async function resolveConflict(userId, projectId, filePath, resolution) {
    if (!['keep-local', 'keep-remote'].includes(resolution)) {
        throw new Error('invalid Dropbox conflict resolution')
    }
    const credentials = await DropboxCredentials.get(userId)
    if (!credentials) throw new Error('Dropbox is not connected')
    const project = await ProjectGetter.promises.getProject(projectId, {
        name: 1, overleaf: 1,
    })
    if (!project) throw new Error('project not found')
    if (resolution === 'keep-local') {
        await syncProjectWithStatus(credentials, project, userId, true)
    } else {
        const body = await DropboxClient.download(
            credentials, remotePath(project.name, filePath)
        )
        await TpdsUpdateHandler.promises.newUpdate(
            userId, project._id, project.name, filePath,
            Readable.from([Buffer.from(body)]), 'dropbox'
        )
        const remoteEntry = (await listAllEntries(
            credentials,
            remotePath(project.name)
        )).find(entry => entry.path_display === remotePath(project.name, filePath))
        if (remoteEntry) {
            await DropboxCredentials.update(userId, {
                remoteState: {
                    ...(credentials.remoteState || {}),
                    [project.name]: {
                        ...(credentials.remoteState?.[project.name] || {}),
                        [filePath]: { rev: remoteEntry.rev },
                    },
                },
                accessToken: credentials.accessToken,
                expiresAt: credentials.expiresAt,
            })
        }
    }
    const conflicts = { ...(credentials.conflicts || {}) }
    delete conflicts[`${project.name}:${filePath}`]
    await DropboxCredentials.update(userId, { conflicts })
}

async function connect(callbackUrl, state) {
    return DropboxClient.getAuthorizeUrl(callbackUrl, state)
}

async function completeRegistration(userId, code, callbackUrl) {
    const token = await DropboxClient.exchangeCode(code, callbackUrl)
    const temporaryCredentials = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
    }
    const account = await DropboxClient.getCurrentAccount(temporaryCredentials)
    await DropboxCredentials.save(userId, {
        ...temporaryCredentials,
        uid: account.account_id,
        displayName: account.name?.display_name,
        cursor: null,
    })
    await DropboxClient.createFolder(temporaryCredentials, ROOT)
        .catch(error => { if (error.status !== 409) throw error })
    await flushProjects(userId)
    const cursor = await DropboxClient.getLatestCursor(temporaryCredentials, ROOT)
    await DropboxCredentials.update(userId, { cursor: cursor.cursor })
    return account
}

async function unlink(userId) {
    const credentials = await DropboxCredentials.get(userId)
    if (credentials) {
        await DropboxClient.revokeToken(credentials).catch(() => { })
    }
    await DropboxCredentials.remove(userId)
}

async function pollUser(userId) {
    const credentials = await DropboxCredentials.get(userId)
    if (!credentials) throw new Error('Dropbox is not connected')
    let result
    try {
        result = credentials.cursor
            ? await DropboxClient.listFolderContinue(credentials, credentials.cursor)
            : await DropboxClient.listFolder(credentials, ROOT)
    } catch (error) {
        if (error.body?.error?.['.tag'] !== 'reset') throw error
        await DropboxCredentials.update(userId, { cursor: null, remoteState: {} })
        result = await DropboxClient.listFolder(credentials, ROOT)
    }
    await DropboxCredentials.update(userId, {
        cursor: result.cursor,
        accessToken: credentials.accessToken,
        expiresAt: credentials.expiresAt,
    })
    const remoteState = { ...(credentials.remoteState || {}) }
    while (true) {
        for (const entry of result.entries || []) {
            const match = entry.path_display.match(/^\/Apps\/Overleaf\/([^/]+)(?:\/(.*))?$/)
            if (!match) continue
            const projectName = match[1]
            const projectPath = match[2] ? `/${match[2]}` : '/'
            if (entry.deleted) {
                if (remoteState[projectName]) {
                    if (projectPath === '/') delete remoteState[projectName]
                    else delete remoteState[projectName][projectPath]
                }
                markInboundProjectName(userId, projectName)
                const projects = await ProjectGetter.promises.findUsersProjectsByName(userId, projectName)
                for (const project of projects) {
                    if (projectPath === '/') {
                        const [docs, files] = await Promise.all([
                            ProjectEntityHandler.promises.getAllDocs(project._id),
                            ProjectEntityHandler.promises.getAllFiles(project._id),
                        ])
                        for (const path of [...Object.keys(docs), ...Object.keys(files)]) {
                            await TpdsUpdateHandler.promises.deleteUpdate(
                                userId, project._id, project.name, path, 'dropbox'
                            )
                        }
                    } else {
                        await TpdsUpdateHandler.promises.deleteUpdate(
                            userId, project._id, project.name, projectPath, 'dropbox'
                        )
                    }
                }
                continue
            }
            if (entry['.tag'] === 'folder' && projectPath === '/') {
                const projects = await ProjectGetter.promises.findUsersProjectsByName(
                    userId,
                    projectName
                )
                if (projects.length === 0) {
                    markInboundProjectName(userId, projectName)
                    await ProjectCreationHandler.promises.createBlankProject(
                        userId,
                        projectName
                    )
                }
                continue
            }
            if (entry['.tag'] !== 'file') continue
            const body = await DropboxClient.download(credentials, entry.path_lower)
            markInboundProjectName(userId, projectName)
            const projects = await ProjectGetter.promises.findUsersProjectsByName(
                userId,
                projectName
            )
            const existingProject = projects.length === 1 ? projects[0] : null
            if (existingProject) markInboundProject(userId, existingProject._id)
            await TpdsUpdateHandler.promises.newUpdate(
                userId, null, projectName, projectPath,
                Readable.from([Buffer.from(body)]), 'dropbox'
            )
            if (!existingProject) {
                const createdProjects = await ProjectGetter.promises.findUsersProjectsByName(
                    userId,
                    projectName
                )
                if (createdProjects.length === 1) {
                    markInboundProject(userId, createdProjects[0]._id)
                }
            }
            remoteState[projectName] = {
                ...(remoteState[projectName] || {}),
                [projectPath]: { rev: entry.rev },
            }
        }
        if (!result.has_more) break
        result = await DropboxClient.listFolderContinue(credentials, result.cursor)
        await DropboxCredentials.update(userId, {
            cursor: result.cursor,
            accessToken: credentials.accessToken,
            expiresAt: credentials.expiresAt,
        })
    }
    await DropboxCredentials.update(userId, {
        remoteState,
        accessToken: credentials.accessToken,
        expiresAt: credentials.expiresAt,
        lastSyncAt: new Date().toISOString(),
        lastSyncError: null,
    })
    return result
}

async function poll(userId) {
    const key = userId.toString()
    if (pollingUsers.has(key)) return
    pollingUsers.add(key)
    try {
        return await pollUser(userId)
    } finally {
        pollingUsers.delete(key)
    }
}

export default {
    connect,
    completeRegistration,
    unlink,
    poll,
    flushProjects,
    flushProject,
    syncProjectForLinkedUsers,
    moveEntityForLinkedUsers,
    deleteProjectForUsers,
    getLinkedUserIds: DropboxCredentials.getLinkedUserIds,
    resolveConflict,
}