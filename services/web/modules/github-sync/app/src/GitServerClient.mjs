import logger from '@overleaf/logger'

/**
 * Client for GitHubInterface microservice
 */
export class GitServerClient {
  constructor() {
    this.apiUrl = process.env.GITHUBINTERFACE_API_URL || 'http://localhost:4003'
  }

  /**
   * Check connection to a git server
   */
  async check(serverUrl, username, token) {
    try {
      const response = await fetch(`${this.apiUrl}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server_url: serverUrl,
          username,
          token // Use token directly, not password
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to connect to git server: ${errorText}`)
      }

      logger.debug({ serverUrl }, 'Git server check completed')
      return true
    } catch (err) {
      logger.error({ err, serverUrl }, 'Git server check failed')
      throw err
    }
  }

  /**
   * Clone a repository
   */
  async clone(repoUrl, ref, targetDir, username, token) {
    try {
      const response = await fetch(`${this.apiUrl}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_url: repoUrl,
          ref,
          target_dir: targetDir,
          username,
          token
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to clone repository: ${errorText}`)
      }

      logger.debug({ repoUrl, targetDir }, 'Repository cloned successfully')
      return true
    } catch (err) {
      logger.error({ err, repoUrl, ref, targetDir }, 'Git clone failed')
      throw err
    }
  }

  /**
   * Push to remote repository
   */
  async push(dir, remote = 'origin', ref = 'HEAD', serverUrl, username, token) {
    try {
      const response = await fetch(`${this.apiUrl}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dir,
          remote,
          ref,
          server_url: serverUrl,
          username,
          token
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to push: ${errorText}`)
      }

      logger.debug({ dir, remote }, 'Git push completed')
      return true
    } catch (err) {
      logger.error({ err, dir, remote }, 'Git push failed')
      throw err
    }
  }

  /**
   * Pull from remote repository
   */
  async pull(dir, remote = 'origin', ref = 'HEAD', serverUrl, username, token) {
    try {
      const response = await fetch(`${this.apiUrl}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dir,
          remote,
          ref,
          server_url: serverUrl,
          username,
          token
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to pull: ${errorText}`)
      }

      logger.debug({ dir, remote }, 'Git pull completed')
      return true
    } catch (err) {
      logger.error({ err, dir, remote }, 'Git pull failed')
      throw err
    }
  }

  /**
   * Create a commit
   */
  async commit(dir, files, message, author = null, serverUrl, username, token) {
    try {
      const response = await fetch(`${this.apiUrl}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dir,
          files,
          message,
          author,
          server_url: serverUrl,
          username,
          token
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to create commit: ${errorText}`)
      }

      const data = await response.json()
      logger.debug({ dir, commit_sha: data.commit_sha }, 'Git commit created')
      return data
    } catch (err) {
      logger.error({ err, dir, message, fileCount: files?.length || 0 }, 'Git commit failed')
      throw err
    }
  }

  /**
   * Get commit history
   */
  async log(dir, ref = 'HEAD', { limit = 50, page = 1 } = {}, serverUrl, username, token) {
    try {
      const url = `${this.apiUrl}/log?dir=${encodeURIComponent(dir)}&ref=${encodeURIComponent(ref)}&limit=${limit}&page=${page}`
      
      const headers = new Headers()
      if (serverUrl && username && token) {
        headers.set('X-Server-Url', serverUrl)
        headers.set('X-Username', username)
        // Token in Authorization header
        headers.set('Authorization', `Bearer ${token}`)
      }

      const response = await fetch(url, { headers })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get log: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      logger.error({ err, dir, ref }, 'Git log failed')
      throw err
    }
  }

  /**
   * Get git status
   */
  async status(dir, serverUrl, username, token) {
    try {
      const url = `${this.apiUrl}/status?dir=${encodeURIComponent(dir)}`
      
      const headers = new Headers()
      if (serverUrl && username && token) {
        headers.set('X-Server-Url', serverUrl)
        headers.set('X-Username', username)
        headers.set('Authorization', `Bearer ${token}`)
      }

      const response = await fetch(url, { headers })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to get status: ${errorText}`)
      }

      return await response.json()
    } catch (err) {
      logger.error({ err, dir }, 'Git status failed')
      throw err
    }
  }
}

export default GitServerClient
