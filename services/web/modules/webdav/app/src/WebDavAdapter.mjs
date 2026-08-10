import { WebDAVServiceClient } from './WebDAVServiceClient.mjs'

/**
 * Adapter to provide backward compatibility with old WebdavClient interface
 */
export class WebDavAdapter {
  constructor(credentials) {
    this.client = new WebDAVServiceClient()
  }

  async createDirectory(path) {
    await this.client.createFolder(path)
  }

  async list(path) {
    return await this.client.listFiles(path)
  }

  async get(path) {
    const response = await this.client.downloadFile(path)
    if (!response.success) throw new Error(response.error || 'Download failed')
    return response.buffer
  }

  async put(path, body, options = {}) {
    try {
      const response = await this.client.uploadFile(path, body, options.etag)
      if (!response.success) {
        throw new Error(response.error || 'Upload failed')
      }
    } catch (error) {
      // Preserve old behavior - add projectPath to error
      if (options && typeof options === 'object') {
        error.projectPath = options.projectPath
      }
      throw error
    }
  }

  async remove(path) {
    await this.client.deleteFile(path)
  }

  async move(from, to) {
    await this.client.moveFile(from, to)
  }
}

export default WebDavAdapter
