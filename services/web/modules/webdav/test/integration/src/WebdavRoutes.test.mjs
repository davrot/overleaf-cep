// Integration tests for WebDAV routes
// These tests verify the route handlers are properly configured

import { expect } from 'vitest'

describe('WebDAV Routes', function () {
  it('should export route paths correctly', async function () {
    const webdavPaths = await import('./../../app/src/WebdavPaths.mjs')

    // Verify all path constants exist
    expect(webdavPaths).to.include.keys([
      'webdavRoot',
      'configPath',
      'credentialsPath',
      'syncStatePath',
      'rootDirectoryPath',
    ])
  })

  it('should have correct route configuration', async function () {
    const { webdavRoot } = await import('./../../app/src/WebdavPaths.mjs')

    // The root path should start with a slash
    expect(webdavRoot).to.match(/^\/webdav/)

    // Verify the path is properly formatted
    expect(webdavRoot.length).to.be.greaterThan(0)
  })
})