#!/usr/bin/env node

import express from 'express'
import { WebDAVClient } from './WebDAVClient.mjs'

const app = express()
app.use(express.json({ limit: '10mb' }))

/**
 * POST /check - Verify credentials work with the WebDAV server
 */
app.post('/check', async (req, res) => {
  try {
    const { server_url, username, password } = req.body
    
    if (!server_url || !username || !password) {
      return res.status(400).json({ error: 'Missing required fields: server_url, username, password' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.check()
    res.json({ status: 'ok', message: 'Connection successful' })
  } catch (err) {
    console.error('WebDAV check failed:', err)
    res.status(500).json({ error: err.message || 'Connection failed' })
  }
})

/**
 * POST /list - List directory contents
 */
app.post('/list', async (req, res) => {
  try {
    const { server_url, username, password, path } = req.body
    
    if (!server_url || !username || !password || !path) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    const entries = await client.list(path)
    res.json({ entries })
  } catch (err) {
    console.error('WebDAV list failed:', err)
    res.status(500).json({ error: err.message || 'List failed' })
  }
})

/**
 * POST /mkdir - Create directory
 */
app.post('/mkdir', async (req, res) => {
  try {
    const { server_url, username, password, path } = req.body
    
    if (!server_url || !username || !password || !path) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.createDirectory(path)
    res.json({ status: 'ok', created: true })
  } catch (err) {
    console.error('WebDAV mkdir failed:', err)
    if (err.status === 405 || err.message?.includes('already exists')) {
      return res.status(200).json({ status: 'ok', created: false, message: 'Directory already exists' })
    }
    res.status(500).json({ error: err.message || 'Create directory failed' })
  }
})

/**
 * GET /file - Get file content (params in query)
 */
app.get('/file', async (req, res) => {
  try {
    const path = req.query.path
    const serverUrl = req.headers['x-server-url']
    const username = req.headers['x-username']

    if (!path || !serverUrl) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    // Extract password from Authorization header or body
    const authHeader = req.headers.authorization
    let password
    if (authHeader && authHeader.startsWith('Basic ')) {
      const base64Auth = authHeader.split(' ')[1]
      const [, pass] = Buffer.from(base64Auth, 'base64').toString().split(':')
      password = pass
    }

    // Fall back to body for POST/PUT requests
    if (!password && req.body?.password) {
      password = req.body.password
    }

    if (!password) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const client = new WebDAVClient({
      baseUrl: serverUrl,
      username,
      password
    })

    const contentBuffer = await client.get(path)
    res.json({
      path,
      content_base64: contentBuffer.toString('base64')
    })
  } catch (err) {
    console.error('WebDAV get file failed:', err)
    res.status(500).json({ error: err.message || 'Get file failed' })
  }
})

/**
 * POST /file - Upload/create file
 */
app.post('/file', async (req, res) => {
  try {
    const { server_url, username, password, path, content_base64, etag } = req.body
    
    if (!server_url || !username || !password || !path || content_base64 === undefined) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.upload(path, content_base64, { etag })
    res.json({ status: 'ok', uploaded: true })
  } catch (err) {
    console.error('WebDAV upload failed:', err)
    if (err.message?.includes('Precondition') || err.message?.includes('conflict')) {
      return res.status(412).json({ error: 'ETag mismatch - file modified', status: 412 })
    }
    res.status(500).json({ error: err.message || 'Upload failed' })
  }
})

/**
 * DELETE /file - Delete file
 */
app.delete('/file', async (req, res) => {
  try {
    const path = req.query.path
    const serverUrl = req.headers['x-server-url']
    const username = req.headers['x-username']

    if (!path || !serverUrl) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    // Extract password from Authorization header or body
    const authHeader = req.headers.authorization
    let password
    if (authHeader && authHeader.startsWith('Basic ')) {
      const base64Auth = authHeader.split(' ')[1]
      const [, pass] = Buffer.from(base64Auth, 'base64').toString().split(':')
      password = pass
    }

    if (!password) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const client = new WebDAVClient({
      baseUrl: serverUrl,
      username,
      password
    })

    await client.delete(path)
    res.json({ status: 'ok', deleted: true })
  } catch (err) {
    console.error('WebDAV delete failed:', err)
    if (err.status === 404 || err.message?.includes('not found')) {
      return res.status(200).json({ status: 'ok', notFound: true, message: 'File not found' })
    }
    res.status(500).json({ error: err.message || 'Delete failed' })
  }
})

/**
 * POST /move - Move/rename file
 */
app.post('/move', async (req, res) => {
  try {
    const { server_url, username, password, src, dst } = req.body
    
    if (!server_url || !username || !password || !src || !dst) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const client = new WebDAVClient({
      baseUrl: server_url,
      username,
      password
    })

    await client.move(src, dst)
    res.json({ status: 'ok', moved: true })
  } catch (err) {
    console.error('WebDAV move failed:', err)
    res.status(500).json({ error: err.message || 'Move failed' })
  }
})

// Start server
const PORT = process.env.WEBDAVINTERFACE_PORT || 4002

app.listen(PORT, () => {
  console.log(`WebDAVInterface service running on port ${PORT}`)
})

export default app
