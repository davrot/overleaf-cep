#!/usr/bin/env node

import express from 'express'
import cors from 'cors'
import logger from '@overleaf/logger'
import * as git from 'isomorphic-git'
import fs from 'fs'

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

/**
 * Helper to extract credentials from request
 */
function getCredentials(req) {
  const { server_url, username, token, password } = req.body || {}
  
  const authPassword = token || password
  
  return {
    serverUrl: server_url?.replace(/\/$/, ''),
    username,
    password: authPassword
  }
}

/**
 * POST /check - Verify credentials work with the Git server
 */
app.post('/check', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    
    if (!serverUrl || !username) {
      return res.status(400).json({ 
        error: 'Missing required fields: server_url and username' 
      })
    }

    // Try to list remote refs - proves connectivity
    try {
      await git.listRemoteRefs({
        url: serverUrl,
        username,
        password
      })
      
      logger.debug({ 
        serverUrl, 
      }, 'Git server check completed')
      
      res.json({ status: 'ok', message: 'Connection successful' })
    } catch (err) {
      logger.error({ err, serverUrl }, 'Git server check failed')
      throw err
    }
  } catch (err) {
    res.status(500).json({ error: err.message || 'Connection failed' })
  }
})

/**
 * POST /clone - Clone a repository
 */
app.post('/clone', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { repo_url, ref = 'HEAD', target_dir } = req.body
    
    if (!repo_url || !target_dir) {
      return res.status(400).json({ 
        error: 'Missing required fields: repo_url and target_dir' 
      })
    }

    await git.clone({
      fs,
      dir: target_dir,
      url: repo_url,
      ref,
      username,
      password
    })
    
    logger.debug({ 
      repo_url, 
      target_dir, 
      ref 
    }, 'Repository cloned successfully')
    
    res.json({ success: true, message: 'Repository cloned successfully' })
  } catch (err) {
    logger.error({ err, repo_url, ref, target_dir }, 'Git clone failed')
    res.status(500).json({ error: err.message || 'Clone failed' })
  }
})

/**
 * POST /push - Push local commits to remote
 */
app.post('/push', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { dir, remote = 'origin', ref = 'HEAD' } = req.body
    
    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }

    await git.push({
      fs,
      dir,
      remote,
      ref,
      username,
      password
    })
    
    logger.debug({ 
      dir, 
      remote, 
      ref 
    }, 'Git push completed')
    
    res.json({ success: true, message: 'Push completed successfully' })
  } catch (err) {
    logger.error({ err, dir, remote, ref }, 'Git push failed')
    res.status(500).json({ error: err.message || 'Push failed' })
  }
})

/**
 * POST /pull - Pull from remote to local
 */
app.post('/pull', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { dir, remote = 'origin', ref = 'HEAD' } = req.body
    
    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }

    await git.pull({
      fs,
      dir,
      remote,
      ref,
      username,
      password
    })
    
    logger.debug({ 
      dir, 
      remote, 
      ref 
    }, 'Git pull completed')
    
    res.json({ success: true, message: 'Pull completed successfully' })
  } catch (err) {
    logger.error({ err, dir, remote, ref }, 'Git pull failed')
    res.status(500).json({ error: err.message || 'Pull failed' })
  }
})

/**
 * POST /commit - Create a new commit
 */
app.post('/commit', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { dir, files, message, author } = req.body
    
    if (!dir || !files || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields: dir, files, and message' 
      })
    }

    // Add files to index
    await git.add({
      fs,
      dir,
      filepath: files.map(f => f.path)
    })
    
    // Get current HEAD
    const head = await git.resolveRef({ fs, dir, ref: 'HEAD' })
    
    // Create tree from staged changes
    const tree = await git.writeTree({ fs, dir })
    
    // Create commit
    const commitSha = await git.commit({
      fs,
      dir,
      message,
      author: author || { name: username },
      parents: [head]
    })
    
    logger.debug({ 
      dir, 
      commitSha,
      fileCount: files.length 
    }, 'Git commit created')
    
    res.json({ success: true, commit_sha: commitSha })
  } catch (err) {
    logger.error({ err, dir, message, fileCount: files?.length || 0 }, 'Git commit failed')
    res.status(500).json({ error: err.message || 'Commit failed' })
  }
})

/**
 * GET /log - Get commit history
 */
app.get('/log', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { dir, ref = 'HEAD', limit = 50, page = 1 } = req.query
    
    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }

    const commits = []
    let skipCount = (page - 1) * limit
    
    for await (const commit of git.log({
      fs,
      dir,
      ref,
      maxCount: limit + skipCount
    })) {
      if (skipCount > 0) {
        skipCount--
        continue
      }
      
      commits.push({
        sha: commit.oid,
        message: commit.commit.message,
        author: {
          name: commit.commit.author.name,
          email: commit.commit.author.email,
          date: new Date(commit.commit.author.timestamp * 1000).toISOString()
        },
        parents: commit.parents
      })
    }
    
    logger.debug({ 
      dir, 
      ref,
      page,
      limit,
      commitsCount: commits.length 
    }, 'Git log retrieved')
    
    res.json({
      commits,
      has_more: commits.length >= limit,
      current_page: page
    })
  } catch (err) {
    logger.error({ err, dir, ref }, 'Git log failed')
    res.status(500).json({ error: err.message || 'Log fetch failed' })
  }
})

/**
 * GET /status - Get git status
 */
app.get('/status', async (req, res) => {
  try {
    const { serverUrl, username, password } = getCredentials(req)
    const { dir } = req.query
    
    if (!dir) {
      return res.status(400).json({ error: 'Missing required field: dir' })
    }

    const statusMatrix = await git.statusMatrix({
      fs,
      dir
    })
    
    // Convert status matrix to human-readable format
    const uncommittedFiles = []
    for (const [filepath, [, stagedStatus, workingTreeStatus]] of statusMatrix.entries()) {
      if (stagedStatus !== 0 || workingTreeStatus !== 0) {
        let combinedStatus = ''
        if (workingTreeStatus === 1) combinedStatus += 'M' // modified
        else if (workingTreeStatus === 2) combinedStatus += '?' // untracked
        else if (workingTreeStatus === 3) combinedStatus += 'D' // deleted
        
        if (stagedStatus === 1) combinedStatus = combinedStatus.replace('M', 'A') // staged modified
        else if (stagedStatus === 2 && !combinedStatus.includes('?')) combinedStatus = 'A' // added
        else if (stagedStatus === 3) combinedStatus = 'D' // deleted
        
        uncommittedFiles.push({
          path: filepath,
          status: combinedStatus || '?'
        })
      }
    }
    
    logger.debug({ 
      dir, 
      uncommittedCount: uncommittedFiles.length 
    }, 'Git status retrieved')
    
    // Get current branch
    let currentBranch = '(unknown)'
    try {
      const headRef = await git.resolveRef({ fs, dir, ref: 'HEAD' })
      if (headRef.startsWith('refs/heads/')) {
        currentBranch = headRef.substring('refs/heads/'.length)
      }
    } catch (err) {
      // Ignore - will use default
    }
    
    res.json({
      branch: currentBranch,
      ahead: 0,
      behind: 0,
      uncommitted_files: uncommittedFiles
    })
  } catch (err) {
    logger.error({ err, dir }, 'Git status failed')
    res.status(500).json({ error: err.message || 'Status fetch failed' })
  }
})

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'githubinterface' })
})

// Start server when this is the main module (works in both CJS and ESM)
const isMain = import.meta.url.startsWith('file:');
if (isMain) {
  const PORT = process.env.GITHUBINTERFACE_PORT || 4013

  app.listen(PORT, () => {
    console.log(`GitHubInterface service running on port ${PORT}`)
  })
}

export default app
