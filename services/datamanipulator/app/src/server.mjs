#!/usr/bin/env node

import express from 'express'
import * as fileOperations from './fileOperations.mjs'
import * as syncService from './sync.mjs'
import { FileNotFoundError, DirectoryNotFoundError } from './errors.mjs'

const app = express()
app.use(express.json({ limit: '10mb' }))

// Helper to get project directory
function getProjectDir(projectId) {
  const projectsRoot = process.env.DATAMANIPULATOR_PROJECTS_ROOT || '/projects'
  return `${projectsRoot}/${projectId}`
}

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'datamanipulator' })
})

/**
 * GET /tree?project_id={id} - Get full project tree
 */
app.get('/tree', async (req, res) => {
  try {
    if (!req.query.project_id) {
      return res.status(400).json({ error: 'Missing project_id parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    const tree = await fileOperations.walkTree(projectDir)
    res.json(tree)
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError || err instanceof DirectoryNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /files?project_id={id}&path={relative_path} - List directory contents
 */
app.get('/files', async (req, res) => {
  try {
    if (!req.query.project_id) {
      return res.status(400).json({ error: 'Missing project_id parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    const tree = await fileOperations.walkTree(projectDir, req.query.path || '')
    
    // Filter to only the requested path's contents
    if (req.query.path) {
      const entries = tree.entries.filter(e => 
        e.relative_path === req.query.path ||
        e.relative_path.startsWith(req.query.path + '/')
      ).map(e => ({
        ...e,
        relative_path: e.relative_path.replace(req.query.path + '/', '')
      }))
      
      res.json({
        path: req.query.path,
        entries
      })
    } else {
      res.json(tree)
    }
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError || err instanceof DirectoryNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * GET /file?project_id={id}&path={relative_path} - Get file content and metadata
 */
app.get('/file', async (req, res) => {
  try {
    if (!req.query.project_id || !req.query.path) {
      return res.status(400).json({ error: 'Missing project_id or path parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    const fileData = await fileOperations.readFile(projectDir, req.query.path)
    
    // Return content as base64
    res.json({
      ...fileData,
      content_base64: fileData.content_base64 || ''
    })
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    if (err instanceof DirectoryNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /file?project_id={id}&path={relative_path} - Create/update file
 */
app.post('/file', async (req, res) => {
  try {
    if (!req.query.project_id || !req.query.path) {
      return res.status(400).json({ error: 'Missing project_id or path parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    
    // Handle both raw content and base64
    let contentBuffer
    if (req.body.content_base64) {
      contentBuffer = Buffer.from(req.body.content_base64, 'base64')
    } else if (typeof req.body === 'string') {
      contentBuffer = Buffer.from(req.body, 'utf8')
    } else {
      return res.status(400).json({ error: 'Missing content in request body' })
    }

    const fileData = await fileOperations.writeFile(projectDir, req.query.path, contentBuffer)
    
    // Return metadata without the full buffer
    res.json({
      ...fileData,
      content_base64: ''
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * DELETE /file?project_id={id}&path={relative_path} - Delete file
 */
app.delete('/file', async (req, res) => {
  try {
    if (!req.query.project_id || !req.query.path) {
      return res.status(400).json({ error: 'Missing project_id or path parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    await fileOperations.deletePath(projectDir, req.query.path)
    
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    if (err instanceof FileNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /pull?project_id={id} - Pull files from remote to local
 */
app.post('/pull', async (req, res) => {
  try {
    if (!req.query.project_id) {
      return res.status(400).json({ error: 'Missing project_id parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    const result = await syncService.pullFiles(projectDir, req.body.remote_files || [])
    
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /push?project_id={id} - Push files from local to remote
 */
app.post('/push', async (req, res) => {
  try {
    if (!req.query.project_id) {
      return res.status(400).json({ error: 'Missing project_id parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    const result = await syncService.pushFiles(projectDir, req.body.remote_files || [])
    
    // Return updated tree after push
    const tree = await fileOperations.walkTree(projectDir)
    
    res.json({
      ...result,
      tree
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /compare - Compare two trees and identify differences
 */
app.post('/compare', async (req, res) => {
  try {
    if (!req.body.left_tree || !req.body.right_tree) {
      return res.status(400).json({ error: 'Missing left_tree or right_tree' })
    }

    const comparison = syncService.compareTrees(req.body.left_tree, req.body.right_tree)
    
    res.json(comparison)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * POST /sync/full?project_id={id} - Full sync with conflict detection
 */
app.post('/sync/full', async (req, res) => {
  try {
    if (!req.query.project_id) {
      return res.status(400).json({ error: 'Missing project_id parameter' })
    }

    const projectDir = getProjectDir(req.query.project_id)
    const result = await syncService.fullSync(projectDir, req.body.remote_files || [])
    
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Start server
const PORT = process.env.DATAMANIPULATOR_PORT || 4001

app.listen(PORT, () => {
  console.log(`DataManipulator service running on port ${PORT}`)
})

export default app
