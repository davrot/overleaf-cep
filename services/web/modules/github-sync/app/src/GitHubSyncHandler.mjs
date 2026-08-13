import Path from 'path'
import fs from 'fs'
import { pipeline } from 'node:stream/promises'
import crypto from 'crypto'
import pLimit from 'p-limit'
import Settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import ProjectUploadManager from '../../../../app/src/Features/Uploads/ProjectUploadManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import GitServerClient from './GitServerClient.mjs'
import SyncStateManager from './SyncStateManager.mjs'
import HistoryManager from './HistoryManager.mjs'
import TokenManager from './TokenManager.mjs'
import { InvalidTokenError, NotFoundError } from './GitSyncErrors.mjs'

const gitClient = new GitServerClient()

async function getGitConnState(userId) {
  try {
    const token = await TokenManager.getUserToken(userId)
    // Check connection using git interface
    const repoUrl = 'https://github.com' // Use GitHub as placeholder for server detection
    return await gitClient.check(repoUrl, githubUsernameFromToken(token), token)
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      logger.debug({ err, userId }, 'token invalid, treating as not connected')
      return false
    }
    throw OError.tag(err, 'failed to validate token', { userId })
  }
}

async function getProjectState(userId, projectId) {
  let pss = null
  const projection = { _id: 0, mergeStatus: 1, repoFullName: 1, unmergedBranchName: 1 }
  pss = await SyncStateManager.getProjectState(projectId, projection)
  if (!pss) {
    pss = { mergeStatus: 'need-export' }
    try {
      const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
      if (owner_ref.toString() !== userId) {
        pss.ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
      }
    } catch (err) {
      pss.ownerEmail = 'nobody@nowhere'
      logger.error({ err }, "failed get user email")
    }
    return pss
  }
  
  // Get server URL and credentials from project state
  const { repoFullName, syncServerUrl, syncUsername } = pss
  const token = await TokenManager.getUserToken(userId)
  
  try {
    const canPush = await gitClient.canPush(repoFullName, syncServerUrl, syncUsername, token)
    if (!canPush) {
      pss.mergeStatus = 'need-permission'
      try {
        const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
        if (owner_ref.toString() !== userId) {
          pss.ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
        }
      } catch (err) {
        logger.error({ err, userId }, "failed get user email")
        pss.ownerEmail = 'nobody@nowhere'
      }
    }
  } catch (err) {
    logger.error({ err }, "failed to check push permission")
  }
  
  return pss
}

async function unlinkRepo(userId, projectId) {
  const { owner_ref } = await ProjectGetter.promises.getProject(projectId, { owner_ref: 1 })
  if (owner_ref.toString() !== userId) {
    let ownerEmail
    try {
      ownerEmail = await UserGetter.promises.getUserEmail(owner_ref)
    } catch (err) {
      logger.error({ err, userId }, "failed get user email")
      ownerEmail = 'nobody@nowhere'
    }
    return ownerEmail
  }
  await SyncStateManager.removeProjectState(projectId)
  return null
}

async function listUserRepos(userId) {
  const token = await TokenManager.getUserToken(userId)
  
  // Get server URL from settings or default to GitHub
  const repoUrl = process.env.GITHUB_SYNC_SERVER_URL || 'https://github.com'
  const username = githubUsernameFromToken(token)
  
  return await gitClient.listRepos(repoUrl, username, token)
}

async function getUserAndOrgs(userId) {
  const token = await TokenManager.getUserToken(userId)
  const repoUrl = process.env.GITHUB_SYNC_SERVER_URL || 'https://github.com'
  const username = githubUsernameFromToken(token)
  
  return await gitClient.listUserAndOrgs(repoUrl, username, token)
}

async function getMergeOverview(userId, projectId) {
  const projectSyncState = await SyncStateManager.getProjectState(projectId)
  if (!projectSyncState) throw new GitNotLinkedError(projectId)
  const { repoFullName, defaultBranchName, lastSyncCommit, lastSyncVersion, mergeStatus } = projectSyncState

  if (mergeStatus === 'conflict') return null

  const token = await TokenManager.getUserToken(userId)
  const currentVersion = await HistoryManager.latestVersion(projectId.toString())
  const isProjectUpdated = currentVersion !== lastSyncVersion
  
  try {
    // Get commits from git interface
    const commmitsAndStatus = await gitClient.getCommitsWithStatus(
      repoFullName,
      defaultBranchName,
      lastSyncCommit,
      token
    )
    
    if(commmitsAndStatus.diverged) {
      await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' } )
    }
    return { ...commmitsAndStatus, isProjectUpdated }
  } catch (err) {
    if (err instanceof NotFoundError) {
      let canPush
      try {
        const { syncServerUrl, syncUsername } = projectSyncState
        canPush = await gitClient.canPush(repoFullName, syncServerUrl, syncUsername, token)
      } catch (e) {
        logger.error({ error: e }, "failed to check push permission")
        canPush = false
      }
      if (!canPush) throw err
      await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'diverged' } )
      return { commits: [], diverged: true, isProjectUpdated }
    } else {
      throw err
    }
  }
}

async function importRepo(userId, projectName, repoFullName, defaultBranchName) {
  const token = await TokenManager.getUserToken(userId)
  
  // Get server URL from project config or use default
  const serverUrl = process.env.GITHUB_SYNC_SERVER_URL || 'https://github.com'
  
  // Get default branch head via git client
  const defaultBranchHead = await gitClient.getBranchHead(repoFullName, defaultBranchName, token)
  const fsPath = Path.join(Settings.path.dumpFolder, `github_import_${crypto.randomUUID()}`)

  let project_id

  try {
    // Clone the repo to a temp directory
    await gitClient.clone(repoFullName, defaultBranchHead, fsPath, serverUrl, githubUsernameFromToken(token), token)
    
    const { project } = await ProjectUploadManager.promises.createProjectFromZipArchiveWithName(
      userId,
      projectName,
      fsPath
    )

    project_id = project?._id
  } catch (err) {
    throw OError.tag(
      err,
      'failed importing git repo',
      { userId, projectName, repoFullName, defaultBranchName, fsPath }
    )
  } finally {
    fs.promises.rm(fsPath, { force: true }).catch(() => {})
  }

  try {
    const projectVersion = await HistoryManager.latestVersion(project_id.toString())
    
    // Store sync configuration in state
    const serverUrlFromConfig = process.env.GITHUB_SYNC_SERVER_URL || 'https://github.com'
    await SyncStateManager.createProjectState(project_id, {
      repoFullName,
      mergeStatus: 'clean',
      lastSyncCommit: defaultBranchHead,
      defaultBranchName,
      lastSyncVersion: projectVersion,
      syncServerUrl: serverUrlFromConfig,
      syncUsername: githubUsernameFromToken(token)
    })
  } catch (err) {
    logger.error(
      { err, userId, projectId: project_id.toString(), repoFullName },
      'Failed to create state of imported repo'
    )
  }

  return project_id
}

async function exportProject(userId, projectId, repoOptions) {
  const isLinked = await SyncStateManager.getProjectState(projectId)
  if (isLinked) {
    throw new OError('Project is already linked to Git server', { projectId })
  }

  const token = await TokenManager.getUserToken(userId)
  
  // Get server URL from config or use default
  const repoUrl = process.env.GITHUB_SYNC_SERVER_URL || 'https://github.com'
  
  // Create repository via git interface
  const result = await gitClient.createRepo(repoOptions, repoUrl, githubUsernameFromToken(token), token)
  const { full_name: repoFullName, default_branch: defaultBranchName } = result

  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

  const currentVersion = await HistoryManager.latestVersion(projectId)
  const currentPaths = await HistoryManager.getPathsAtVersion(projectId, currentVersion)

  // Clone to temp directory for import
  const fsPath = Path.join(Settings.path.dumpFolder, `github_export_${crypto.randomUUID()}`)
  
  try {
    await gitClient.clone(repoFullName, 'HEAD', fsPath, repoUrl, githubUsernameFromToken(token), token)
    
    // Create initial commit with all project files
    const fileDataList = currentPaths.paths.map(path => ({
      path,
      content_base64: HistoryManager.getProjectFileBase64(projectId, currentVersion, path)
    }))

    await gitClient.commit(fsPath, fileDataList, 'Initial Overleaf import', repoUrl, githubUsernameFromToken(token), token)

    // Push to remote
    await gitClient.push(fsPath, 'origin', defaultBranchName, repoUrl, githubUsernameFromToken(token), token)
    
    return SyncStateManager.createProjectState(projectId, {
      mergeStatus: 'clean',
      defaultBranchName,
      lastSyncCommit: 'initial-commit-sha-placeholder',
      lastSyncVersion: currentVersion,
      repoFullName,
      syncServerUrl: repoUrl,
      syncUsername: githubUsernameFromToken(token)
    })
  } finally {
    fs.promises.rm(fsPath, { force: true }).catch(() => {})
  }
}

// Helper function to get username from token
function githubUsernameFromToken(token) {
  // This would normally call GitHub's /user endpoint or extract from JWT
  // For now, return a placeholder - real implementation would parse the token
  return 'github-user'
}

export default {
  exportProject,
  getProjectState,
  unlinkRepo,
  importRepo,
  getGitConnState,
  listUserRepos,
  getUserAndOrgs,
  getMergeOverview,
}
